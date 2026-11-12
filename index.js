/**
 * Host half of dsh-medical-hl7: agent tools and the /hl7 command over one shared batch service.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createService } from './lib/service.js'

export const name = 'medical-hl7'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const workingDirectory = ctx.get('workingDirectory')
  const defaultDirectory = workingDirectory?.defaultDirectory ?? process.cwd()
  const stateDir = process.env.DSH_PROFILE_DIR
    ? join(process.env.DSH_PROFILE_DIR, 'plugin-data', 'medical-hl7')
    : join(homedir(), '.dsh', 'plugin-data', 'medical-hl7')
  const service = createService({ config, defaultDirectory, stateDir })
  if (typeof ctx.effect === 'function') ctx.effect(() => () => service.dispose(), 'medical-hl7: cancel running batch')

  // ctx.tools.register is scoped to this plugin's fiber (same as the sibling medical plugins)
  const register = (def) => ctx.tools.register(tool(def))

  register({
    name: 'hl7_start',
    description: 'dsh-medical-hl7 插件：把医疗数据（通常是 dsh-medical-anonymizer 的交付目录；json/ndjson/csv，字段命名不限）转换成 HL7 FHIR R4，用于存储和交换。每位病人一个 transaction Bundle（PUT、编号稳定，可直接导入 FHIR 服务器），另出整批 Bulk Data NDJSON 和 manifest。按“语义角色→固定构建器”映射：已知数据源用内置规格（区域平台 p_doc_*），未知的表自动推断病人/机构/医生/就诊号并以 Basic 保留；没有对应的字段原样挂扩展，不丢数据；值不变（时间只做格式转换）。每位病人过结构校验、引用完整性和残留身份证号/手机号检查，未过的暂扣不交付。只在本机按规则处理，不调用模型；绝不修改源文件。立即返回批次 id。',
    parameters: {
      inputDir: { type: 'string', description: '输入目录（一位病人或多位病人的上级目录）或单个文件，绝对路径或相对工作区。' },
      outputRoot: { type: 'string', description: '输出根目录，不能与输入相同、不能包含输入或放在输入里；省略时用设置里的默认值，再缺省为输入旁的 _medical-hl7。' },
      resumeFrom: { type: 'string', description: '继续一个已取消或失败的批次（填批次 id），沿用原输入和输出根目录；填写时可省略 inputDir。' },
    },
    execute: async (args, exec) => service.start({ inputDir: args.inputDir, outputRoot: args.outputRoot, resumeFrom: args.resumeFrom, source: { kind: 'agent', sessionId: sessionIdOf(exec?.agent) } }),
    render: (args, v) => [{ type: 'text', text: `已启动批次 ${v.runId}，输出到 ${v.outputRoot}。${v.provenance?.note ?? ''}。用 hl7_status 查看进度。` }],
  })

  register({
    name: 'hl7_status',
    description: '查看 HL7 FHIR 转换批次的状态、进度、资源数、验收门结果。省略 runId 时看最近一批。',
    parameters: { runId: { type: 'string', description: '批次 id；省略则取最近一批。' } },
    execute: async (args) => service.status(args.runId),
    render: (args, value) => {
      const run = value.run
      if (!run) return [{ type: 'text', text: '还没有 HL7 转换批次。' }]
      const t = run.totals
      const lines = [
        `批次 ${run.id}: ${run.status}${run.current ? `（${run.current.unit} · ${run.current.step}）` : ''}`,
        `目录 ${run.units.length}/${t.units}，病人 ${t.patients}（交付 ${t.done}，暂扣 ${t.held}），资源 ${t.resources}，结构错误 ${t.errors}，登记缺失的就诊 ${t.unresolvedEncounters ?? 0}`,
      ]
      for (const p of run.patients.slice(0, 30)) lines.push(`- ${p.name}: ${p.status === 'held' ? '暂扣' : '交付'}，资源 ${p.resources}`)
      if (run.patients.length > 30) lines.push(`…另有 ${run.patients.length - 30} 位`)
      if (run.output) lines.push(`交付：${run.output}`)
      if (run.warnings?.length) lines.push(`注意 ${run.warnings.length} 条，见 hl7_report`)
      if (run.error) lines.push(`错误：${String(run.error).split('\n')[0]}`)
      return [{ type: 'text', text: lines.join('\n') }]
    },
  })

  register({
    name: 'hl7_report',
    description: '读取 HL7 FHIR 转换批次的 Markdown 报告（资源统计、映射覆盖、原样保留的字段、自动推断的表、验收门、官方校验器抽检）。报告不含病历原文。',
    parameters: { runId: { type: 'string', description: '批次 id；省略则取最近一批。' } },
    execute: async (args) => service.report(args.runId),
    render: (args, v) => [{ type: 'text', text: v.markdown.length > 8000 ? `${v.markdown.slice(0, 8000)}\n…（完整内容见 ${v.path}）` : v.markdown }],
  })

  register({
    name: 'hl7_runs',
    description: '列出最近的 HL7 FHIR 转换批次（时间、状态、病人数、资源数、暂扣数）。',
    parameters: {},
    execute: async () => service.list(),
    render: (args, v) => [{ type: 'text', text: v.runs.length ? v.runs.slice(0, 20).map((r) => `${r.id}  ${r.status}  病人 ${r.patients}  资源 ${r.resources}  暂扣 ${r.held}  ${r.input}`).join('\n') : '还没有批次。' }],
  })

  register({
    name: 'hl7_cancel',
    description: '取消正在运行的 HL7 FHIR 转换批次。已完成的病人保留在 _records/runs/<批次>/output，可用 hl7_start 的 resumeFrom 继续。',
    parameters: { runId: { type: 'string', description: '批次 id；省略则取消当前批次。' } },
    execute: async (args) => service.cancel(args.runId),
    render: (args, v) => [{ type: 'text', text: v.cancelled ? `已请求取消批次 ${v.runId}。` : `没有取消：${v.reason}` }],
  })

  ctx.inject(['commands'], (cmdCtx) => {
    const usage = '用法：/hl7 <输入目录或文件> [--out 输出根目录]（路径含空格时用引号）'
    const dispose = cmdCtx.commands.register({
      name: 'hl7',
      description: 'HL7 FHIR 转换：/hl7 <输入目录或文件> [--out 输出根目录]',
      input: { hint: '输入目录或文件 [--out 输出根目录]' },
      handler: async (invocation) => {
        const args = String(invocation.rawInput ?? '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) ?? []
        const i = args.indexOf('--out'); const outputRoot = i >= 0 ? args.splice(i, 2)[1] : undefined
        if (!args[0]) return { kind: 'error', text: usage }
        try {
          const v = await service.start({ inputDir: args[0], outputRoot, source: { kind: 'command', sessionId: sessionIdOf(invocation.agent) } })
          return { kind: 'success', text: `已启动批次 ${v.runId}，输出到 ${v.outputRoot}。${v.provenance?.note ?? ''}。用 hl7_status 查看进度。` }
        } catch (error) {
          return { kind: 'error', text: String(error?.message ?? error) }
        }
      },
    })
    cmdCtx.effect(() => dispose, 'medical-hl7: /hl7 command')
  })

  /* ---------------------------------------------- browser RPC (page) */
  ctx.inject(['connection', 'webServer'], (rpcCtx) => {
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const admission = rpcCtx.connection.admit(req)
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden'); return }
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const endpoint = new URL(req.url ?? '/', 'http://x').pathname.slice(CHANNEL.length + 1)
        if (!endpoint) { res.writeHead(404); res.end(); return }
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') { res.writeHead(415); res.end(); return }
        let body
        try {
          const chunks = []; let size = 0
          for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw new Error('request body too large'); chunks.push(chunk) }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(error?.message ?? error) })); return
        }
        const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
        if (body?.type !== 'client-request' || body?.method !== endpoint) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'bad-request', message: 'invalid client-request envelope', details: {} } } }))
          return
        }
        const result = await dispatch(endpoint, body.payload)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
      },
    }
    rpcCtx.effect(() => rpcCtx.webServer.register(route), 'medical-hl7: rpc route')
  })

  /** User-only (page): persists settings into the profile's patch layer. */
  async function saveDefaults(patch) {
    if (service.isRunning()) throw new Error('有批次在运行，保存设置会重新加载插件并中断批次；请等它结束')
    const editor = ctx.get('configEditor')
    if (!editor?.edit || !editor?.entries) throw new Error('当前 DSH 不支持从页面保存配置；请在 profile 的 cordis.patch.yml 中修改 medical-hl7 的 config')
    let entry = ctx.fiber?.entry
    if (!entry) {
      const entries = editor.entries()
      try { entry = entries.find((item) => item.fiber === ctx.fiber) } catch { /* fall back */ }
      entry ??= entries.find((item) => item.options?.id === ENTRY_ID)
    }
    if (!entry) throw new Error(`找不到插件配置行 ${ENTRY_ID}`)
    const allowed = ['outputRoot', 'namespace', 'timezone', 'profilesDir', 'residualGate', 'validatorJar', 'validatorSample', 'javaPath']
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)))
    await editor.edit(entry, (current) => ({ ...current, ...clean }))
    return { saved: true }
  }

  async function dispatch(endpoint, payload) {
    try {
      const r = payload && typeof payload === 'object' ? payload : {}
      const value = await (async () => {
        switch (endpoint) {
          case 'config': return service.configInfo()
          case 'list': return service.list()
          case 'status': return service.status(r.runId)
          case 'report': return service.report(r.runId)
          case 'start': return service.start({ inputDir: r.inputDir, outputRoot: r.outputRoot || undefined, resumeFrom: r.resumeFrom || undefined, source: { kind: 'panel' } })
          case 'cancel': return service.cancel(r.runId)
          case 'patient': return service.patientDetail(r.runId, r.patient)
          case 'resources': return service.resources(r.runId, r.patient, r.type)
          case 'resource': return service.resource(r.runId, r.patient, r.type, r.id)
          case 'mapping': return service.mapping(r.runId)
          case 'pickFolder': {
            const ws = ctx.get('uiWorkspace')
            return { path: ws?.pickDirectory ? await ws.pickDirectory() : null }
          }
          case 'saveDefaults': return saveDefaults(r)
          default: throw Object.assign(new Error(`未知方法: ${endpoint}`), { code: 'unknown-endpoint' })
        }
      })()
      return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) }
    } catch (error) {
      return { ok: false, error: { code: error?.code ?? 'medical-hl7', message: String(error?.message ?? error), details: {} } }
    }
  }
}

const CHANNEL = '/medical-hl7'
const ENTRY_ID = 'medical-hl7'

function sessionIdOf(agent) {
  try { const id = agent?.session?.id; return typeof id === 'string' ? id : undefined } catch { return undefined }
}

function tool(def) {
  const properties = {}; const required = []
  for (const [key, spec] of Object.entries(def.parameters ?? {})) {
    properties[key] = { type: spec.type, ...(spec.description ? { description: spec.description } : {}) }
    if (spec.required) required.push(key)
  }
  return {
    name: def.name,
    description: def.description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: def.render },
    // 工具输出必须是无损 JSON（不能有 undefined 等）：统一做一次 JSON 往返
    execute: async (...a) => JSON.parse(JSON.stringify(await def.execute(...a) ?? null)),
  }
}
