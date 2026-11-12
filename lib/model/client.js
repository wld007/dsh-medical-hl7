/**
 * OpenAI 兼容的模型客户端（与 dsh-medical-anonymizer 同一约定）。
 *
 * - 只发往用户在设置里配置的端点；Agent 工具不能指定端点、模型、Key。
 * - chatJson：要求 JSON，形状不对重试一次；端点不认识可选字段（400）时去掉重发。
 * - 回放缓存：每个回复按提示的哈希写入 _records/runs/<批次>/model-cache.jsonl，
 *   取消或失败后继续处理时，同样的提示直接取缓存，只把没问过的发给模型。批次结束后删除。
 * - 调用记录只记大小、耗时、token，不记提示和回复正文。
 */
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

export class LlmError extends Error {
  constructor(message, code = 'llm-error', status) { super(message); this.name = 'LlmError'; this.code = code; this.status = status }
}

export function createLlm({ baseURL, model, apiKey = '', timeoutMs = 120000, temperature = 0, disableThinking = true }) {
  const base = String(baseURL ?? '').replace(/\/+$/, '')
  const headers = () => ({ 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) })
  async function request(path, body, signal) {
    if (!base) throw new LlmError('未配置模型端点（baseURL）', 'no-base-url')
    if (!model) throw new LlmError('未配置模型名称（model）', 'no-model')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, signal].filter(Boolean)) })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { /* raw */ }
      if (!res.ok) throw new LlmError(`模型端点返回 ${res.status}: ${data?.error?.message ?? data?.message ?? text.slice(0, 300)}`, 'http-error', res.status)
      return data
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (signal?.aborted) throw new LlmError('模型请求已取消', 'aborted')
      if (controller.signal.aborted) throw new LlmError(`模型请求超时（${Math.round(timeoutMs / 1000)} 秒）`, 'timeout')
      throw new LlmError(`无法连接模型端点: ${error?.message ?? error}`, 'network')
    } finally {
      clearTimeout(timer)
    }
  }
  async function chat(messages, { signal, maxTokens = 4000, forceJson = false } = {}) {
    const body = { model, messages, temperature, max_tokens: maxTokens, stream: false }
    if (forceJson) body.response_format = { type: 'json_object' }
    if (disableThinking) body.chat_template_kwargs = { enable_thinking: false }
    const t0 = Date.now()
    let data
    try {
      data = await request('/chat/completions', body, signal)
    } catch (error) {
      // 有的本地服务不认识 response_format / chat_template_kwargs：去掉再试一次
      if (error?.status === 400 && (body.response_format || body.chat_template_kwargs)) {
        delete body.response_format; delete body.chat_template_kwargs
        data = await request('/chat/completions', body, signal)
      } else throw error
    }
    const c = data?.choices?.[0]?.message?.content
    const text = typeof c === 'string' ? c.trim() : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('').trim() : ''
    if (!text) throw new LlmError('模型返回了空内容', 'empty-response')
    return { text, usage: data?.usage ?? null, ms: Date.now() - t0 }
  }
  async function listModels(signal) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000))
    try {
      const res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined, signal: AbortSignal.any([controller.signal, signal].filter(Boolean)) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        const hint = res.status === 401 || res.status === 403 ? '（API Key 无效或无权访问）' : res.status === 404 ? '（该地址没有 /models 接口，请检查端点是否以 /v1 结尾）' : ''
        throw new LlmError(`无法读取模型列表: 模型端点返回 ${res.status}${hint}`, 'http-error', res.status)
      }
      const data = await res.json().catch(() => { throw new LlmError('无法读取模型列表: 端点返回的不是 JSON', 'bad-json') })
      return (Array.isArray(data?.data) ? data.data : []).map((x) => x?.id).filter(Boolean)
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (controller.signal.aborted && !signal?.aborted) throw new LlmError('无法读取模型列表: 请求超时', 'timeout')
      throw new LlmError(`无法读取模型列表: ${error?.message ?? error}`, 'network')
    } finally {
      clearTimeout(timer)
    }
  }
  return { chat, listModels, model, baseURL: base }
}

/** First balanced JSON value in a possibly chatty reply. */
export function extractJson(text) {
  if (typeof text !== 'string') return null
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(cleaned) } catch { /* scan */ }
  const start = cleaned.search(/[[{]/)
  if (start === -1) return null
  const open = cleaned[start]; const close = open === '{' ? '}' : ']'
  let depth = 0; let inString = false; let escaped = false
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i]
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue }
    if (ch === '"') { inString = true; continue }
    if (ch === open) depth += 1
    else if (ch === close) { depth -= 1; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)) } catch { return null } } }
  }
  return null
}

const hashOf = (messages) => createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 32)

/**
 * Suggest model + optional independent verify model, a concurrency limit per model,
 * a replay cache and a call log.
 * @param chatImpl optional { suggest:{chat,model}, verify:{chat,model} } (tests)
 */
export async function createModelRunner(settings, { chatImpl, cacheFile } = {}) {
  const mk = (baseURL, model) => createLlm({ baseURL, model, apiKey: settings.apiKey, timeoutMs: settings.timeoutMs, temperature: Number(settings.temperature ?? 0), disableThinking: settings.disableThinking !== false })
  const suggest = chatImpl?.suggest ?? (settings.baseURL && settings.model ? mk(settings.baseURL, settings.model) : null)
  const verify = chatImpl?.verify ?? (settings.verifyModel ? mk(settings.verifyBaseURL || settings.baseURL, settings.verifyModel) : null)
  const limit = Math.max(1, Number(settings.modelConcurrency) || 4)
  const limiters = { suggest: limiter(limit), verify: limiter(limit) }
  const calls = []
  const cache = new Map()
  if (cacheFile) {
    try {
      for (const line of (await readFile(cacheFile, 'utf8')).split('\n')) {
        if (!line.trim()) continue
        try { const e = JSON.parse(line); if (e.k && e.r) cache.set(e.k, e.r) } catch { /* cut-off line */ }
      }
    } catch { /* none */ }
  }
  const loaded = cache.size
  let writeQueue = Promise.resolve()
  const persist = (k, r) => {
    if (!cacheFile) return
    writeQueue = writeQueue.then(async () => { await mkdir(dirname(cacheFile), { recursive: true }); await appendFile(cacheFile, `${JSON.stringify({ k, r })}\n`, { mode: 0o600 }) }).catch(() => {})
  }

  /**
   * JSON call. validate(json) checks the agreed shape; bad JSON / bad shape retried once.
   * @returns { json, cached }
   */
  async function askJson(role, { phase, round = 1, items = 0 }, messages, { validate, signal, maxTokens = 4000 } = {}) {
    const client = role === 'verify' ? verify : suggest
    if (!client) throw new LlmError(`未配置${role === 'verify' ? '核验' : '识别'}模型`, 'no-model')
    const key = `${role}:${hashOf(messages)}`
    const hit = cache.get(key)
    if (hit) {
      const json = extractJson(hit)
      if (json !== null && (!validate || validate(json))) { calls.push({ role, phase, round, items, model: client.model, cached: true, ok: true, at: new Date().toISOString() }); return { json, cached: true } }
    }
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rec = { role, phase, round, items, model: client.model, at: new Date().toISOString(), promptChars: messages.reduce((n, m) => n + m.content.length, 0), attempt: attempt + 1 }
      await limiters[role].acquire()
      try {
        const r = await client.chat(messages, { signal, maxTokens, forceJson: true })
        Object.assign(rec, { ms: r.ms, replyChars: r.text.length, tokens: r.usage?.total_tokens ?? null })
        const json = extractJson(r.text)
        if (json === null) { rec.ok = false; rec.error = '不是有效 JSON'; lastError = new LlmError('模型输出不是有效 JSON', 'bad-json'); continue }
        if (validate && !validate(json)) { rec.ok = false; rec.error = '格式不符'; lastError = new LlmError('模型输出格式不符', 'bad-shape'); continue }
        rec.ok = true
        cache.set(key, r.text); persist(key, r.text)
        return { json, cached: false }
      } catch (error) {
        rec.ok = false; rec.error = String(error?.message ?? error).slice(0, 200)
        lastError = error
        if (error?.code === 'aborted' || signal?.aborted) break
        if (error?.code === 'timeout') break
        if (error?.status && error.status < 500 && error.status !== 408 && error.status !== 429) break
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      } finally {
        calls.push(rec)
        limiters[role].release()
      }
    }
    throw lastError ?? new LlmError('模型调用失败', 'llm-failed')
  }

  function summary() {
    const by = {}
    for (const c of calls) {
      const k = `${c.role}|${c.phase}`
      const x = by[k] ??= { role: c.role, phase: c.phase, model: c.model, calls: 0, cached: 0, failed: 0, ms: 0, tokens: 0, items: 0 }
      x.calls++; if (c.cached) x.cached++; if (!c.ok) x.failed++; x.ms += c.ms ?? 0; x.tokens += c.tokens ?? 0; x.items += c.ok ? c.items ?? 0 : 0
    }
    return { models: { suggest: suggest?.model ?? null, verify: verify?.model ?? null }, total: calls.length, live: calls.filter((c) => !c.cached).length, cached: calls.filter((c) => c.cached).length, failed: calls.filter((c) => !c.ok).length, tokens: calls.reduce((n, c) => n + (c.tokens ?? 0), 0), loadedFromCache: loaded, byPhase: Object.values(by) }
  }
  return {
    configured: Boolean(suggest), verifying: Boolean(verify), models: { suggest: suggest?.model ?? null, verify: verify?.model ?? null },
    askJson, calls, summary,
    async flush() { await writeQueue },
    async dropCache() { await writeQueue; if (cacheFile) await rm(cacheFile, { force: true }) },
  }
}

function limiter(n) {
  let running = 0; const queue = []
  return {
    acquire: () => new Promise((resolve) => { if (running < n) { running++; resolve() } else queue.push(resolve) }),
    release: () => { const next = queue.shift(); if (next) next(); else running-- },
  }
}

/** Split into chunks of n. */
export const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
