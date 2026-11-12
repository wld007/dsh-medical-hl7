/**
 * 对照表（vocab）：值域定义与术语对照，都是带版本的数据文件。
 *
 *   内置：<插件>/vocab/domains/**.json、<插件>/vocab/terminology/*.json
 *   本机复核：<vocabDir>/domains/<值域>.json（{ entries: [...] }）、<vocabDir>/terminology/<绑定>.json（{ mappings: [...] }）
 *
 * 本机复核的条目按键覆盖内置条目：值域按（代码, 名称）；术语按源概念键。
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const BUILTIN_VOCAB_DIR = fileURLToPath(new URL('../../vocab/', import.meta.url))

async function walkJson(dir, out = []) {
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walkJson(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out
}
async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')) }
const idFromPath = (root, p) => relative(root, p).replace(/\\/g, '/').replace(/\.json$/, '')

/** 术语源概念键：scope|code|display（有代码时不含名称）。按名称对照的绑定只用名称。 */
export function termKey(binding, from) {
  const x = binding.extract ?? {}
  const scope = x.scope === 'org' ? from.scope ?? '' : ''
  const code = x.code || x.domain || x.item ? from.code ?? '' : ''
  return [scope, code, code ? '' : from.display ?? ''].join('|')
}

export const entryKey = (e) => `${e.code ?? ''}\u0001${e.display ?? ''}`

/** Load built-in vocab merged with local review overrides. */
export async function loadVocab(vocabDir) {
  const domains = new Map(); const terminology = new Map()
  const hash = createHash('sha256')
  const builtinD = join(BUILTIN_VOCAB_DIR, 'domains')
  for (const p of (await walkJson(builtinD)).sort()) {
    const d = await readJson(p)
    d.id ??= idFromPath(builtinD, p)
    d.entries = (d.entries ?? []).map((e) => ({ ...e, source: 'builtin' }))
    domains.set(d.id, d)
    hash.update(JSON.stringify(d))
  }
  const builtinT = join(BUILTIN_VOCAB_DIR, 'terminology')
  for (const p of (await walkJson(builtinT)).sort()) {
    const t = await readJson(p)
    t.id ??= idFromPath(builtinT, p)
    t.mappings = (t.mappings ?? []).map((m) => ({ ...m, source: 'builtin' }))
    terminology.set(t.id, t)
    hash.update(JSON.stringify(t))
  }
  if (vocabDir) {
    const localD = join(vocabDir, 'domains')
    for (const p of (await walkJson(localD)).sort()) {
      const id = idFromPath(localD, p)
      const d = domains.get(id)
      if (!d) continue
      const o = await readJson(p)
      const byKey = new Map(d.entries.map((e) => [entryKey(e), e]))
      for (const e of o.entries ?? []) byKey.set(entryKey(e), { ...e, source: e.origin === 'model' ? 'model' : 'review' })
      d.entries = [...byKey.values()]
      d.reviewed = (o.entries ?? []).filter((e) => e.origin !== 'model').length
      d.modelEntries = (o.entries ?? []).filter((e) => e.origin === 'model').length
      hash.update(JSON.stringify(o))
    }
    const localT = join(vocabDir, 'terminology')
    for (const p of (await walkJson(localT)).sort()) {
      const id = idFromPath(localT, p)
      const t = terminology.get(id)
      if (!t) continue
      const o = await readJson(p)
      const byKey = new Map(t.mappings.map((m) => [m.key, m]))
      for (const m of o.mappings ?? []) byKey.set(m.key, { ...m, source: m.origin === 'model' ? 'model' : 'review' })
      t.mappings = [...byKey.values()]
      t.reviewed = (o.mappings ?? []).filter((m) => m.origin !== 'model').length
      t.modelMappings = (o.mappings ?? []).filter((m) => m.origin === 'model').length
      hash.update(JSON.stringify(o))
    }
  }
  for (const d of domains.values()) indexDomain(d)
  // 键统一由源概念计算（机构|代码|名称），手写的 key 只作兜底
  for (const t of terminology.values()) {
    for (const m of t.mappings) if (m.from) m.key = termKey(t, m.from)
    t.index = new Map(t.mappings.map((m) => [m.key, m]))
  }
  return { domains, terminology, version: hash.digest('hex').slice(0, 12) }
}

function indexDomain(d) {
  d.byBoth = new Map(); d.byCode = new Map(); d.byDisplay = new Map()
  for (const e of d.entries) {
    if (e.code !== undefined && e.display !== undefined) d.byBoth.set(entryKey(e), e)
    else if (e.code !== undefined) d.byCode.set(String(e.code), e)
    else if (e.display !== undefined) d.byDisplay.set(String(e.display), e)
  }
}

/** Find the entry for a (code, display) pair: exact pair, then code alone, then display alone. */
export function lookupEntry(d, code, display) {
  const c = code === undefined ? undefined : String(code); const n = display === undefined ? undefined : String(display)
  if (d.match === 'display') {
    const v = n ?? c
    return v === undefined ? undefined : d.byDisplay.get(v)
  }
  if (c !== undefined && n !== undefined) { const e = d.byBoth.get(`${c}\u0001${n}`); if (e) return e }
  if (c !== undefined) { const e = d.byCode.get(c); if (e) return e }
  if (n !== undefined) { const e = d.byDisplay.get(n); if (e) return e }
  // 只有一个值时，代码和名称互相兜底（如检查类型字段只填了 “CT”）
  if (n === undefined && c !== undefined) { const e = d.byDisplay.get(c); if (e) return e }
  if (c === undefined && n !== undefined) { const e = d.byCode.get(n); if (e) return e }
  return undefined
}

async function readOr(p, fallback) { try { return await readJson(p) } catch { return fallback } }
async function exists(p) { try { await stat(p); return true } catch { return false } }

/** Save one reviewed value-domain entry (by its code/display key). */
export async function saveDomainEntry(vocabDir, domainId, entry, by = 'user') {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(domainId)) throw new Error('值域编号不合法')
  const p = join(vocabDir, 'domains', `${domainId}.json`)
  const o = await readOr(p, { entries: [] })
  const clean = {
    ...(entry.code !== undefined && entry.code !== null && entry.code !== '' ? { code: String(entry.code) } : {}),
    ...(entry.display !== undefined && entry.display !== null && entry.display !== '' ? { display: String(entry.display) } : {}),
    to: entry.to ?? null, status: entry.status, ...(entry.note ? { note: String(entry.note) } : {}), origin: 'user', by, at: new Date().toISOString(),
  }
  if (clean.code === undefined && clean.display === undefined) throw new Error('需要代码或名称')
  if (!['confirmed', 'pending', 'invalid', 'text'].includes(clean.status)) throw new Error('状态不合法')
  if (clean.status === 'confirmed' && (clean.to === null || clean.to === '')) throw new Error('已确认的条目需要目标值')
  o.entries = [...(o.entries ?? []).filter((e) => entryKey(e) !== entryKey(clean)), clean]
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(o, null, 2))
  return { saved: true, file: p }
}

/** Save one reviewed terminology mapping (by its source key). */
export async function saveTermMapping(vocabDir, bindingId, mapping, by = 'user') {
  if (!/^[a-z0-9-]+$/.test(bindingId)) throw new Error('对照编号不合法')
  if (!mapping?.key) throw new Error('缺少源概念')
  const p = join(vocabDir, 'terminology', `${bindingId}.json`)
  const o = await readOr(p, { mappings: [] })
  const clean = {
    key: String(mapping.key), source: undefined,
    from: { ...(mapping.from ?? {}) },
    to: mapping.to?.code ? { code: String(mapping.to.code), ...(mapping.to.display ? { display: String(mapping.to.display) } : {}) } : null,
    equivalence: mapping.equivalence ?? 'equivalent', status: mapping.status ?? 'confirmed', ...(mapping.note ? { note: String(mapping.note) } : {}), origin: 'user', by, at: new Date().toISOString(),
  }
  delete clean.source
  if (clean.status === 'confirmed' && !clean.to && clean.equivalence !== 'unmatched') throw new Error('已确认的对照需要目标代码')
  o.mappings = [...(o.mappings ?? []).filter((m) => m.key !== clean.key), clean]
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(o, null, 2))
  return { saved: true, file: p }
}

/** Model results: add entries / mappings, never replacing a human-reviewed one. */
export async function saveModelDomainEntries(vocabDir, domainId, list) {
  const p = join(vocabDir, 'domains', `${domainId}.json`)
  const o = await readOr(p, { entries: [] })
  const byKey = new Map((o.entries ?? []).map((e) => [entryKey(e), e]))
  let added = 0
  for (const e of list) {
    const k = entryKey(e)
    if (byKey.get(k)?.origin === 'user' || (byKey.get(k) && byKey.get(k).origin !== 'model')) continue
    byKey.set(k, { ...e, origin: 'model', at: new Date().toISOString() }); added++
  }
  o.entries = [...byKey.values()]
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(o, null, 2))
  return added
}
export async function saveModelTermMappings(vocabDir, bindingId, list) {
  const p = join(vocabDir, 'terminology', `${bindingId}.json`)
  const o = await readOr(p, { mappings: [] })
  const byKey = new Map((o.mappings ?? []).map((m) => [m.key, m]))
  let added = 0
  for (const m of list) {
    const cur = byKey.get(m.key)
    if (cur && cur.origin !== 'model') continue
    byKey.set(m.key, { ...m, origin: 'model', at: new Date().toISOString() }); added++
  }
  o.mappings = [...byKey.values()]
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(o, null, 2))
  return added
}
/** Mark a model result as reviewed by a human (keeps its content). */
export async function confirmModelResult(vocabDir, kind, id, key) {
  const p = join(vocabDir, kind === 'domain' ? 'domains' : 'terminology', `${id}.json`)
  const o = await readOr(p, null)
  if (!o) throw new Error('找不到对照文件')
  const list = kind === 'domain' ? o.entries : o.mappings
  const x = list.find((e) => (kind === 'domain' ? entryKey(e) === key : e.key === key))
  if (!x) throw new Error('找不到这条对照')
  x.origin = 'user'; x.reviewedFromModel = true; x.at = new Date().toISOString()
  await writeFile(p, JSON.stringify(o, null, 2))
  return { saved: true }
}

export { exists }
