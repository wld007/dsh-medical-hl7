/**
 * 批次服务：Agent 工具、/hl7 命令共用。
 *
 * 输出布局：
 *   <outputRoot>/<输入名>/                交付（批次结束后才出现；验收门未过的病人不在里面）
 *     bundles/<病人>.json  ndjson/<类型>.ndjson  manifest.json
 *   <outputRoot>/_records/
 *     records.sqlite                      过程记录库：批次、统计文档、模型调用与缓存（见 records.js）
 *     runs/<runId>/report.md report.json  报告（给人和其他工具看）
 *                  stages/                 中间结果（同构记录、归一记录，gz）
 *                  output/                 暂存（完成后整体移到根目录）
 *                  held/<病人>.json        验收门未过的病人（不交付）
 *                  validator/              官方 HL7 Validator 抽检结果
 */
import { mkdir, readFile, writeFile, readdir, rename, stat, realpath, rm } from 'node:fs/promises'
import { join, resolve, relative, basename, dirname, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { loadProfiles, findUnits, readUnit, matchSpec } from './source.js'
import { createContext } from './convert.js'
import { processPatient, mergeTermSummaries } from './pipeline.js'
import { slotCounts, mergeFlow } from './flow.js'
import { createSchemaStats } from './stages/harmonize.js'
import { createNormalizer, mergeDomainSummaries } from './stages/normalize.js'
import { createTerminology, conceptMaps } from './stages/terminology.js'
import { loadVocab, saveDomainEntry, saveTermMapping, confirmModelResult } from './stages/vocab.js'
import { createModelRunner, createLlm } from './model/client.js'
import { runModelPhases } from './model/phases.js'
import { loadDraftedProfile, saveDraft } from './model/schema.js'
import { loadCodeTables } from './model/codetable.js'
import { createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { validateResources } from './fhir/validate.js'
import { scanResidual } from './gates.js'
import { transactionBundle, writeBundle, createBulkWriter, writeManifest, safeName } from './output.js'
import { renderReport } from './report.js'
import { createDefinitionCollector } from './definitions.js'
import { openRecords, loadSqlite } from './records.js'
import { closeVocabStores } from './stages/vocabstore.js'

const RECORDS = '_records'
let VERSION = null
try { VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version } catch { /* unknown */ }

export const DEFAULTS = {
  outputRoot: '',
  namespace: 'http://dsh.local/fhir',
  timezone: '+08:00',
  profilesDir: '',
  residualGate: 'block',
  outputFormat: 'both',
  vocabDir: '',
  keepIntermediate: true,
  domainCoverageWarn: 0.9,
  // 模型（可选）：只发往这里配置的端点；Agent 不能更改
  modelEnabled: true,
  baseURL: '',
  model: '',
  apiKey: '',
  verifyBaseURL: '',
  verifyModel: '',
  disableThinking: true,
  timeoutMs: 120000,
  temperature: 0,
  modelConcurrency: 4,
  maxRounds: 3,
  valueLimit: 300,
  termLimit: 500,
  loincTable: '',
  loincZhTable: '',
  snomedTable: '',
  validatorJar: '',
  validatorSample: 2,
  javaPath: 'java',
}

async function exists(p) { try { await stat(p); return true } catch { return false } }
async function realish(p) {
  let cur = resolve(p); const rest = []
  for (;;) {
    try { return join(await realpath(cur), ...rest) } catch { /* climb */ }
    const up = dirname(cur)
    if (up === cur) return resolve(p)
    rest.unshift(basename(cur)); cur = up
  }
}
const newRunId = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(3).toString('hex')}`
}

async function snapshot(files) {
  const snap = {}
  for (const f of files) { try { const s = await stat(f); snap[f] = `${s.size}:${s.mtimeMs}` } catch { snap[f] = 'missing' } }
  return snap
}

/** Where did the input come from? (anonymizer delivery / withheld output / unknown) */
export async function provenanceOf(input) {
  const m = /[\\/]_records[\\/]runs[\\/]([^\\/]+)[\\/]output(?:[\\/]|$)/.exec(input)
  if (m) return { kind: 'withheld', anonymizerRun: m[1], note: `输入是匿名化批次 ${m[1]} 暂扣中的结果（还有待复核项未处理）` }
  for (let d = dirname(input), i = 0; i < 3 && d !== dirname(d); d = dirname(d), i++) {
    if (await exists(join(d, RECORDS, 'vault.json')) || await exists(join(d, RECORDS, 'vault.sqlite')) || await exists(join(d, RECORDS, 'records.sqlite')) || await exists(join(d, RECORDS, 'runs'))) {
      let runId = null
      try { runId = JSON.parse(await readFile(join(d, RECORDS, 'index.json'), 'utf8'))?.[0]?.id ?? null } catch { /* none */ }
      if (!runId && await exists(join(d, RECORDS, 'records.sqlite'))) {
        try {
          const { DatabaseSync } = (await loadSqlite()) ?? {}
          if (DatabaseSync) { const db = new DatabaseSync(join(d, RECORDS, 'records.sqlite'), { readOnly: true }); try { runId = db.prepare('SELECT id FROM runs ORDER BY started_at DESC LIMIT 1').get()?.id ?? null } finally { db.close() } }
        } catch { /* other layout */ }
      }
      return { kind: 'delivered', anonymizerRoot: d, anonymizerRun: runId, note: '输入是匿名化插件的正式交付' }
    }
  }
  return { kind: 'unknown', note: '输入不像匿名化插件的输出：如果含真实身份信息，转换结果同样含真实身份信息' }
}

/** One-line summary of a resource for list views. */
export function briefOf(r) {
  const cc = (x) => x?.text ?? x?.coding?.[0]?.display ?? x?.coding?.[0]?.code
  const label = cc(r.code) ?? cc(r.type?.[0] ?? r.type) ?? cc(r.medicationCodeableConcept) ?? r.name?.[0]?.text ?? (typeof r.name === 'string' ? r.name : undefined) ?? r.description ?? r.identifier?.[0]?.value ?? r.id
  const date = r.effectiveDateTime ?? r.period?.start ?? r.performedPeriod?.start ?? r.performedDateTime ?? r.recordedDate ?? r.date ?? r.authoredOn ?? r.occurrenceDateTime ?? r.issued ?? r.created ?? r.birthDate ?? null
  const q = r.valueQuantity
  const value = q ? `${q.comparator ?? ''}${q.value}${q.unit ? ` ${q.unit}` : ''}` : r.valueString ?? cc(r.valueCodeableConcept) ?? r.conclusion ?? (r.component ? r.component.map((c) => c.valueQuantity?.value ?? c.valueString).join('/') : undefined) ?? (r.result ? `${r.result.length} 项结果` : undefined)
  const extra = (r.extension ?? []).filter((e) => e.url.endsWith('/source-field')).length
  return { id: r.id, type: r.resourceType, label: String(label).slice(0, 120), date, value: value === undefined ? null : String(value).slice(0, 120), status: r.status ?? null, extra, tag: r.meta?.tag?.[0]?.code ?? null }
}

async function writeNdjsonGz(path, rows) {
  await mkdir(dirname(path), { recursive: true })
  await streamPipeline(Readable.from((function* () { for (const r of rows) yield `${JSON.stringify(r)}\n` })()), createGzip(), createWriteStream(path))
}

/** Compact numbers for the run record / page pipeline. */
function stageSummary(m) {
  const schema = m.schema.toJSON()
  const tables = Object.values(schema)
  const extrasFields = new Set(); for (const t of tables) for (const f of Object.keys(t.extras)) extrasFields.add(`${t.table}.${f}`)
  const doms = Object.values(m.domains)
  const sum = (k) => doms.reduce((n, d) => n + (d.byStatus[k] ?? 0), 0)
  const total = doms.reduce((n, d) => n + d.total, 0)
  const terms = Object.values(m.terminology)
  const occ = terms.reduce((n, t) => n + t.occurrences, 0); const mocc = terms.reduce((n, t) => n + t.mappedOccurrences, 0)
  return {
    schema: { tables: tables.length, inferred: tables.filter((t) => t.inferred).length, rows: tables.reduce((n, t) => n + t.rows, 0), extrasFields: extrasFields.size },
    domains: { domains: doms.length, values: total, normalized: sum('normalized'), text: sum('text'), pending: sum('pending'), unmapped: sum('unmapped'), invalid: sum('invalid'), coverage: total ? (sum('normalized') + sum('text')) / total : 1, lowCoverage: doms.filter((d) => d.coverage < 0.9).length },
    terminology: { bindings: terms.length, concepts: terms.reduce((n, t) => n + t.concepts, 0), mappedConcepts: terms.reduce((n, t) => n + t.mappedConcepts, 0), occurrences: occ, mappedOccurrences: mocc, coverage: occ ? mocc / occ : null },
  }
}

export function createService({ config = {}, defaultDirectory = process.cwd(), stateDir = null, chatImpl = null } = {}) {
  const settings = { ...DEFAULTS, ...config }
  // 页面复核的对照存在本机（所有批次共用）
  const vocabDir = settings.vocabDir || (stateDir ? join(stateDir, 'vocab') : null)
  let active = null
  const runsCache = new Map()

  const rootsFile = () => (stateDir ? join(stateDir, 'roots.json') : null)
  async function rememberRoot(root) {
    const f = rootsFile(); if (!f) return
    let roots = []
    try { roots = JSON.parse(await readFile(f, 'utf8')) } catch { /* new */ }
    roots = [root, ...roots.filter((r) => r !== root)].slice(0, 20)
    await mkdir(dirname(f), { recursive: true })
    await writeFile(f, JSON.stringify(roots, null, 2))
  }
  async function knownRoots() { const f = rootsFile(); try { return f ? JSON.parse(await readFile(f, 'utf8')) : [] } catch { return [] } }

  // 每个输出根目录一个记录库（打开后缓存）
  const stores = new Map()
  async function recordsOf(root, create = true) {
    const k = resolve(root)
    if (stores.has(k)) return stores.get(k)
    const st = await openRecords(join(k, RECORDS), { sqlite: settings.recordsSqlite !== false, create })
    if (st) stores.set(k, st)
    return st
  }
  const storeOfRun = (run) => recordsOf(run.outputRoot)
  async function saveRun(run) {
    runsCache.set(run.id, run)
    await (await storeOfRun(run)).saveRun(run)
  }
  async function putDoc(run, name, value) { await (await storeOfRun(run)).putDoc(run.id, name, value) }

  // 代码表很大，加载一次后缓存（按文件路径）
  let tableCache = null
  async function codeTables(warn) {
    const key = [settings.loincTable, settings.loincZhTable, settings.snomedTable].join('|')
    if (!tableCache || tableCache.key !== key) tableCache = { key, tables: await loadCodeTables(settings, warn) }
    return tableCache.tables
  }

  let lastSave = 0
  function saveThrottled(run) { const now = Date.now(); if (now - lastSave > 1000) { lastSave = now; saveRun(run).catch(() => {}) } }

  async function resolveOutputRoot(input, requested) {
    const st = await stat(input)
    const beside = st.isFile() ? dirname(input) : dirname(input)
    const root = resolve(defaultDirectory, requested || settings.outputRoot || join(beside, '_medical-hl7'))
    const inReal = await realpath(input)
    const rootAbs = await realish(root)
    if (rootAbs === inReal) throw new Error('输出根目录不能与输入相同')
    if ((inReal + sep).startsWith(rootAbs + sep)) throw new Error('输出根目录不能包含输入')
    if (!st.isFile() && (rootAbs + sep).startsWith(inReal + sep)) throw new Error('输出根目录不能放在输入目录里面')
    return rootAbs
  }

  async function start(request = {}) {
    if (active) throw new Error(`已有批次 ${active.id} 在运行`)
    let prev = null
    if (request.resumeFrom) {
      prev = await loadRun(request.resumeFrom)
      if (!prev) throw new Error(`找不到批次 ${request.resumeFrom}`)
      if (['completed', 'review'].includes(prev.status)) throw new Error('该批次已完成，无需继续')
    }
    if (!prev && !request.inputDir) throw new Error('请给出输入目录或文件（inputDir）')
    const input = prev?.input ?? resolve(defaultDirectory, request.inputDir)
    if (!(await exists(input))) throw new Error(`输入不存在：${input}`)
    const outputRoot = prev?.outputRoot ?? await resolveOutputRoot(input, request.outputRoot)
    const id = prev?.id ?? newRunId()
    const provenance = prev?.provenance ?? await provenanceOf(input)
    // 匿名化插件暂扣目录叫 output，交付时改用匿名化批次号命名，免得目录名毫无意义
    const inputName = provenance.kind === 'withheld' && basename(input) === 'output' ? `anonymized-${provenance.anonymizerRun}` : (basename(input).replace(/\.[^.]+$/, '') || 'input')
    const run = prev ?? {
      id, status: 'running', input, inputName, outputRoot, runDir: join(outputRoot, RECORDS, 'runs', id),
      startedAt: new Date().toISOString(), source: request.source ?? null,
      namespace: settings.namespace, timezone: settings.timezone,
      outputFormat: ['both', 'bundles', 'ndjson'].includes(settings.outputFormat) ? settings.outputFormat : 'both',
      maxRounds: Math.min(6, Math.max(1, Number(request.maxRounds ?? settings.maxRounds) || 3)),
      provenance,
      patients: [], units: [], totals: { units: 0, patients: 0, done: 0, held: 0, resources: 0, errors: 0, warnings: 0 },
      warnings: [], current: null,
    }
    run.status = 'running'; run.finishedAt = null; delete run.error
    if (!prev && provenance.kind !== 'delivered') run.warnings.push(provenance.note)
    active = { id, cancel: false, run, controller: new AbortController() }
    await saveRun(run)
    await rememberRoot(outputRoot)
    execute(run).catch(async (error) => {
      if (error?.cancelled) { run.status = 'cancelled'; run.finishedAt = new Date().toISOString(); run.current = null; await saveRun(run).catch(() => {}); return }
      run.status = 'failed'; run.error = String(error?.stack ?? error); run.finishedAt = new Date().toISOString(); run.current = null
      await saveRun(run).catch(() => {})
    }).finally(() => { if (active?.id === id) active = null })
    return { runId: id, outputRoot, provenance: run.provenance, model: settings.modelEnabled !== false && settings.baseURL && settings.model ? settings.model : null, verifyModel: settings.modelEnabled !== false && settings.verifyModel ? settings.verifyModel : null }
  }

  async function execute(run) {
    const builtinProfiles = await loadProfiles([settings.profilesDir].filter(Boolean))
    const loadAllProfiles = async () => { const d = await loadDraftedProfile(vocabDir); return { profiles: [...builtinProfiles, d.profile], records: d.records } }
    let { profiles } = await loadAllProfiles()
    const skip = (p) => resolve(p) === resolve(run.outputRoot) || basename(p) === '_medical-hl7'
    const units = await findUnits(run.input, skip, profiles)
    if (!units.length) throw new Error('输入里没有找到数据文件（.json / .ndjson / .csv）')
    const allFiles = units.flatMap((u) => u.files)
    const before = await snapshot(allFiles)
    const staging = join(run.runDir, 'output', run.inputName)
    const bundlesDir = join(staging, 'bundles')
    const heldDir = join(run.runDir, 'held')
    const ctx = createContext({ namespace: settings.namespace, timezone: settings.timezone, profileId: profiles[0]?.id ?? 'source' })
    // 模型阶段（起草规格、补值域对照、找标准术语）：结果存本机对照目录，然后照常转换
    const store = await storeOfRun(run)
    const runner = settings.modelEnabled !== false && vocabDir ? await createModelRunner({ ...settings }, { chatImpl, cache: store.cache(run.id) }) : null
    run.model = { configured: Boolean(runner?.configured), models: runner?.models ?? null, maxRounds: run.maxRounds, disableThinking: settings.disableThinking !== false, concurrency: Number(settings.modelConcurrency) || 4, timeoutMs: settings.timeoutMs, endpoint: settings.baseURL || null, verifyEndpoint: settings.verifyModel ? (settings.verifyBaseURL || settings.baseURL) : null, phases: run.model?.phases ?? null }
    if (runner?.configured && !run.modelDone) {
      const progress = (step) => { run.current = { unit: '模型', step }; saveThrottled(run) }
      try {
        run.model.phases = await runModelPhases({
          units, vocabDir, runner, settings: { ...settings, maxRounds: run.maxRounds }, inputRoot: run.input, signal: active?.controller?.signal, progress,
          loadProfiles: loadAllProfiles, loadVocab: () => loadVocab(vocabDir), resolveSystem: ctx.resolve, tables: await codeTables((w) => run.warnings.push(w)),
        })
        run.modelDone = true
      } catch (error) {
        if (active?.cancel) { run.model.calls = runner.summary(); await store.putCalls(run.id, runner.calls); throw Object.assign(new Error('已取消'), { cancelled: true }) }
        run.warnings.push(`模型阶段出错，已跳过（按现有对照继续转换）：${error?.message ?? error}`)
      }
      run.model.calls = runner.summary()
      await store.putCalls(run.id, runner.calls)
      ;({ profiles } = await loadAllProfiles())
    } else if (!runner?.configured) {
      run.model.note = '未配置模型：只按内置规格和已有对照转换；没有规格的表按 Basic 原样保留'
    }
    const vocab = await loadVocab(vocabDir)
    run.vocab = { version: vocab.version, dir: vocabDir, domains: vocab.domains.size, terminology: vocab.terminology.size }
    const stagesDir = join(run.runDir, 'stages')
    const inferred = new Map()
    // 继续处理：整单元完成的跳过；做到一半的单元整体重做
    const finishedUnits = new Set(run.units.map((u) => u.name))
    run.patients = run.patients.filter((p) => finishedUnits.has(p.unit))
    // 去向统计按已完成的病人重算（做到一半的单元整体重做）
    if (run.flow) { const tables = run.flow.tables; run.flow = null; for (const p of run.patients) run.flow = mergeFlow(run.flow, { ...(p.flow ?? {}), tables }) }
    const seenKeys = new Map()
    for (const p of run.patients) seenKeys.set(p.key, p.unit)
    run.totals.units = units.length
    const profilesUsed = new Set(run.profilesUsed ?? [])
    const tables = run.tables ?? {}
    for (const unit of units) {
      if (active?.cancel) break
      if (finishedUnits.has(unit.name)) continue
      run.current = { unit: unit.name, step: '读取' }
      await saveRun(run)
      const t0 = Date.now()
      const r = await readUnit(unit, profiles, run.input, inferred)
      for (const p of r.profilesUsed) profilesUsed.add(p)
      for (const [k, n] of Object.entries(r.tablesUsed)) tables[k] = (tables[k] ?? 0) + n
      if (r.errors.length) run.warnings.push(...r.errors.map((e) => `读不了 ${e.file}：${e.error}`))
      if (r.orphaned) run.warnings.push(`${unit.name}：${r.orphaned} 条记录取不到病人编号，单元里有多位病人，无法归属，未转换`)
      const multi = r.patients.size > 1
      // 每个目录一组阶段统计（继续处理时已完成目录的统计从 stats/ 读回）
      const stages = { schemaStats: createSchemaStats(), normalizer: createNormalizer({ vocab, timezone: settings.timezone }), terminology: createTerminology({ vocab, resolveSystem: ctx.resolve }) }
      for (const [key, p] of r.patients) {
        if (active?.cancel) break
        run.current = { unit: unit.name, step: '转换' }
        if (seenKeys.has(key) && seenKeys.get(key) !== unit.name) run.warnings.push(`同一病人编号出现在 ${seenKeys.get(key)} 和 ${unit.name} 两个目录里，分别转换（导入服务器时后者覆盖前者的 Patient）`)
        seenKeys.set(key, unit.name)
        const name = multi ? `${unit.name}__${key}` : unit.name
        run.current = { unit: unit.name, step: 'Schema 同构 → 值域归一 → 术语对照 → FHIR 组装' }
        const out = processPatient(key, p.records, ctx, stages)
        if (settings.keepIntermediate) {
          await writeNdjsonGz(join(stagesDir, `${safeName(name)}.harmonized.ndjson.gz`), out.harmonized)
          await writeNdjsonGz(join(stagesDir, `${safeName(name)}.normalized.ndjson.gz`), out.normalized)
        }
        const v = validateResources(out.resources)
        const residual = scanResidual(out.resources)
        const gates = {
          structure: { pass: v.errors.length === 0, errors: v.errors.length },
          residual: { pass: residual.length === 0 || settings.residualGate !== 'block', hits: residual.length },
        }
        const pass = Object.values(gates).every((g) => g.pass)
        const bundle = transactionBundle(out.resources, { base: ctx.ns, id: out.patient.id, timestamp: new Date().toISOString() })
        const path = await writeBundle(pass ? bundlesDir : heldDir, name, bundle)
        run.patients.push({
          unit: unit.name, name, key, file: relative(run.runDir, path), status: pass ? 'done' : 'held', ms: Date.now() - t0,
          records: out.stats.records, resources: out.resources.length, byType: out.stats.byType, byKind: out.stats.byKind,
          unresolvedEncounters: out.stats.unresolvedEncounters, invalidRecords: out.stats.invalidRecords, timeUnparsed: out.stats.timeUnparsed,
          leftoverFields: out.stats.leftoverFields, issues: out.issues.slice(0, 50), gates,
          validation: { errors: v.errors.slice(0, 30), warnings: v.warnings.length, warningSample: v.warnings.slice(0, 10), counts: v.counts },
          residual,
        })
        const fs1 = { flows: out.stats.flows, tables: out.stats.tables, slots: slotCounts(out.resources) }
        run.patients.at(-1).flow = { flows: fs1.flows, slots: fs1.slots }
        run.flow = mergeFlow(run.flow, fs1)
        run.totals = totalsOf(run)
      }
      await putDoc(run, `stats:${unit.name}`, { schema: stages.schemaStats.toJSON(), domains: stages.normalizer.summary(), terminology: stages.terminology.summary() })
      run.units.push({ name: unit.name, files: unit.files.length, patients: r.patients.size })
      run.profilesUsed = [...profilesUsed]
      run.tables = tables
      await saveRun(run)
    }
    run.current = null
    // 本批用到的映射（含自动推断的规格），便于人改成正式规格
    await mkdir(run.runDir, { recursive: true })
    const used = profiles.filter((p) => profilesUsed.has(p.id)).map(({ path, ...p }) => ({ ...p, source: path }))
    await putDoc(run, 'mapping', { profiles: used, inferred: [...inferred.values()] })
    run.inferred = [...inferred.values()].map((s) => ({ id: s.id, file: s.match.file, suggestedKind: s.suggestedKind, roles: s.reasons.length, rows: tables[s.id] ?? 0 }))
    // 三个阶段的统计：按目录合并
    const merged = { schema: createSchemaStats(), domains: {}, terminology: {} }
    for (const u of run.units) {
      try {
        const x = await store.getDoc(run.id, `stats:${u.name}`) ?? await store.getDoc(run.id, `stats:${safeName(u.name)}`)
        if (!x) continue
        merged.schema.merge(x.schema); merged.domains = mergeDomainSummaries(merged.domains, x.domains); merged.terminology = mergeTermSummaries(merged.terminology, x.terminology)
      } catch { /* missing */ }
    }
    for (const t of Object.values(merged.terminology)) { const o = vocab.terminology.get(t.id); if (o) Object.assign(t, { name: o.name, description: o.description, target: o.target, lands: o.lands, extract: o.extract }) }
    await putDoc(run, 'schema', merged.schema.toJSON())
    await putDoc(run, 'domains', merged.domains)
    await putDoc(run, 'terminology', merged.terminology)
    run.stages = stageSummary(merged)
    for (const d of Object.values(merged.domains)) {
      if (d.coverage < (Number(settings.domainCoverageWarn) || 0)) run.warnings.push(`值域「${d.name}」归一覆盖率 ${(d.coverage * 100).toFixed(1)}%，低于 ${(settings.domainCoverageWarn * 100).toFixed(0)}%（不阻断交付；未归一的值保留原值，见「值域归一」）`)
    }

    if (active?.cancel) {
      run.status = 'cancelled'
    } else {
      // 交付格式：按人（bundles/）、按资源类型（ndjson/），或两种都要。按人的 Bundle 总是先生成（校验、NDJSON、定义都从它来）
      const fmt = run.outputFormat
      const wantBundles = fmt !== 'ndjson'
      const wantNdjson = fmt !== 'bundles'
      run.current = { unit: '全体', step: wantNdjson ? '生成 NDJSON 与定义' : '生成定义' }
      await saveRun(run)
      const { counts, definitions } = await buildNdjson(bundlesDir, wantNdjson ? join(staging, 'ndjson') : null, join(staging, 'definitions'))
      // 术语对照：本批用到的已确认对照，输出 FHIR ConceptMap
      const cms = conceptMaps(vocab, merged.terminology, { ns: ctx.ns, resolveSystem: ctx.resolve })
      for (const cm of cms) await writeFile(join(staging, 'definitions', `ConceptMap-${cm.id}.json`), JSON.stringify(cm, null, 1))
      definitions.ConceptMap = cms.length
      run.bulk = counts
      run.definitions = definitions
      if (settings.validatorJar) {
        run.current = { unit: '全体', step: '官方校验器抽检' }
        await saveRun(run)
        run.officialValidation = await officialValidate(run, bundlesDir, join(staging, 'definitions'))
      }
      let bundleFiles = []
      try { bundleFiles = (await readdir(bundlesDir)).filter((n) => n.endsWith('.json')).sort() } catch { /* none */ }
      if (!wantBundles) await rm(bundlesDir, { recursive: true, force: true })
      await writeManifest(staging, { counts: wantNdjson ? counts : {}, bundles: wantBundles ? bundleFiles : [], run: { ...run, finishedAt: new Date().toISOString() }, profiles: used })
      const after = await snapshot(allFiles)
      const changed = Object.keys(before).filter((k) => before[k] !== after[k])
      run.sourceCheck = { files: allFiles.length, changed: changed.length }
      if (changed.length) run.warnings.push(`运行期间有 ${changed.length} 个源文件被改动（不是本插件改的）`)
      let target = join(run.outputRoot, run.inputName)
      for (let n = 2; await exists(target); n++) target = join(run.outputRoot, `${run.inputName} (${n})`)
      await mkdir(dirname(target), { recursive: true })
      if (await exists(staging)) await rename(staging, target)
      run.output = target
      run.current = null
      run.status = run.totals.held || run.warnings.length ? 'review' : 'completed'
      await store.dropCache(run.id)
    }
    run.finishedAt = new Date().toISOString()
    const report = renderReport(run, { domains: await runJson(run, 'domains'), terminology: await runJson(run, 'terminology') })
    await writeFile(join(run.runDir, 'report.md'), report.markdown)
    await writeFile(join(run.runDir, 'report.json'), JSON.stringify(report.json, null, 2))
    await saveRun(run)
  }

  /** Stream all bundles into per-type NDJSON (shared resources deduplicated). */
  async function buildNdjson(bundlesDir, ndjsonDir, definitionsDir) {
    if (ndjsonDir) await rm(ndjsonDir, { recursive: true, force: true })
    await rm(definitionsDir, { recursive: true, force: true })
    // 不要 NDJSON 时只计数（Bulk 去重口径），不写文件
    const writer = ndjsonDir ? createBulkWriter(ndjsonDir) : (() => {
      const counts = {}; const seen = new Set()
      return { write: async (rs) => { for (const r of rs) { const k = `${r.resourceType}/${r.id}`; if (!seen.has(k)) { seen.add(k); counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1 } } }, close: async () => counts }
    })()
    const defs = createDefinitionCollector(settings.namespace.replace(/\/+$/, ''))
    let names = []
    try { names = (await readdir(bundlesDir)).filter((n) => n.endsWith('.json')).sort() } catch { /* none */ }
    for (const n of names) {
      const b = JSON.parse(await readFile(join(bundlesDir, n), 'utf8'))
      const resources = b.entry.map((e) => e.resource)
      await writer.write(resources)
      defs.add(resources)
    }
    const counts = await writer.close()
    const definitions = await defs.write(definitionsDir)
    return { counts, definitions }
  }

  async function officialValidate(run, bundlesDir, definitionsDir) {
    let names = []
    try { names = (await readdir(bundlesDir)).filter((n) => n.endsWith('.json')).sort() } catch { return { ok: false, error: '没有可抽检的 Bundle' } }
    const pick = names.slice(0, Math.max(1, Number(settings.validatorSample) || 1))
    const dir = join(run.runDir, 'validator')
    await mkdir(dir, { recursive: true })
    const results = []
    for (const n of pick) {
      const outFile = join(dir, `${n.replace(/\.json$/, '')}.outcome.json`)
      const res = await new Promise((resolveP) => {
        execFile(settings.javaPath || 'java', ['-Xmx6g', '-jar', settings.validatorJar, join(bundlesDir, n), '-version', '4.0.1', '-ig', definitionsDir, '-tx', 'n/a', '-level', 'warnings', '-output', outFile], { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => resolveP({ error, tail: `${stdout}\n${stderr}`.split('\n').slice(-20).join('\n') }))
      })
      try {
        const oo = JSON.parse(await readFile(outFile, 'utf8'))
        const issues = oo.issue ?? []
        const by = (s) => issues.filter((i) => i.severity === s).length
        const top = {}
        for (const i of issues.filter((x) => x.severity === 'error' || x.severity === 'fatal')) { const k = (i.details?.text ?? i.diagnostics ?? '').replace(/\d+/g, '#').slice(0, 160); top[k] = (top[k] ?? 0) + 1 }
        results.push({ bundle: n, errors: by('error') + by('fatal'), warnings: by('warning'), topErrors: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10) })
      } catch {
        results.push({ bundle: n, failed: true, tail: res.tail })
      }
    }
    return { ok: results.every((r) => !r.failed && r.errors === 0), results }
  }

  function totalsOf(run) {
    const t = { units: run.totals.units, patients: run.patients.length, done: 0, held: 0, resources: 0, errors: 0, warnings: 0, unresolvedEncounters: 0 }
    for (const p of run.patients) {
      if (p.status === 'held') t.held++; else t.done++
      t.resources += p.resources; t.errors += p.gates.structure.errors; t.warnings += p.validation.warnings; t.unresolvedEncounters += p.unresolvedEncounters
    }
    return t
  }

  async function loadRun(id) {
    if (active?.id === id) return active.run
    if (runsCache.has(id)) return runsCache.get(id)
    for (const root of await knownRoots()) {
      try {
        const st = await recordsOf(root, false)
        const run = st ? await st.loadRun(id) : null
        if (!run) continue
        runsCache.set(id, run)
        if (!run.flow && run.status !== 'running') await backfillFlow(run).catch(() => {})
        return run
      } catch { /* next */ }
    }
    return null
  }
  /**
   * 旧版本生成的批次没有去向统计：从交付（或暂扣）的 Bundle 补算一次，写回 run.json。
   * 来源表由资源的 meta.source（来源文件名）按映射规格认出。
   */
  async function backfillFlow(run) {
    const builtin = await loadProfiles([settings.profilesDir].filter(Boolean))
    const profiles = [...builtin, (await loadDraftedProfile(vocabDir)).profile]
    let flow = null
    let found = 0
    for (const p of run.patients) {
      let b = null
      for (const f of [join(run.runDir, p.file ?? ''), run.output ? join(run.output, 'bundles', `${safeName(p.name)}.json`) : null].filter(Boolean)) {
        try { b = JSON.parse(await readFile(f, 'utf8')); break } catch { /* next */ }
      }
      if (!b) continue
      found++
      const R = (b.entry ?? []).map((e) => e.resource)
      const flows = {}; const tables = {}
      const specOf = new Map()
      for (const r of R) {
        if (['Organization', 'Practitioner'].includes(r.resourceType)) continue
        const file = decodeURIComponent(String(r.meta?.source ?? '').split('#')[1] ?? '').split('/').pop()
        if (!file) continue
        if (!specOf.has(file)) specOf.set(file, matchSpec(profiles, file, null)?.spec ?? null)
        const sp = specOf.get(file)
        const id = sp?.id ?? `auto:${file}`
        tables[id] ??= { name: sp?.name ?? file, kind: sp?.kind ?? 'generic', drafted: Boolean(sp?.drafted) }
        const k = `${id}|${r.resourceType}`; flows[k] = (flows[k] ?? 0) + 1
      }
      // 标本、病人没有 meta.source：标本归到检验表，病人归到病人信息表
      const lab = Object.keys(tables).find((id) => tables[id].kind === 'lab')
      const nSpec = R.filter((r) => r.resourceType === 'Specimen').length
      if (lab && nSpec) flows[`${lab}|Specimen`] = (flows[`${lab}|Specimen`] ?? 0) + nSpec
      const person = Object.keys(tables).find((id) => tables[id].kind === 'patient')
      if (person) flows[`${person}|Patient`] = 1
      p.flow = { flows, slots: slotCounts(R) }
      flow = mergeFlow(flow, { flows, tables, slots: p.flow.slots })
    }
    if (!flow || !found) return
    run.flow = { ...flow, backfilled: true }
    await saveRun(run).catch(() => {})
  }
  async function list() {
    const out = []
    for (const root of await knownRoots()) {
      try { const st = await recordsOf(root, false); for (const r of st ? await st.listRuns() : []) out.push({ ...r, outputRoot: root }) } catch { /* gone */ }
    }
    out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    return { runs: out, active: active?.id ?? null }
  }
  async function latestId() { return active?.id ?? (await list()).runs[0]?.id ?? null }
  async function status(runId) {
    const id = runId || await latestId()
    const run = id ? await loadRun(id) : null
    return { run: run ? { ...run, patients: run.patients.map(({ leftoverFields, validation, residual, issues, timeUnparsed, byKind, flow, ...p }) => ({ ...p, leftover: Object.values(leftoverFields ?? {}).reduce((a, b) => a + b, 0) })) } : null, active: active?.id ?? null }
  }
  async function report(runId) {
    const id = runId || await latestId()
    const run = id ? await loadRun(id) : null
    if (!run) throw new Error('还没有批次')
    const path = join(run.runDir, 'report.md')
    try { return { runId: id, path, markdown: await readFile(path, 'utf8') } } catch { return { runId: id, path, markdown: renderReport(run, { domains: await runJson(run, 'domains'), terminology: await runJson(run, 'terminology') }).markdown } }
  }
  async function cancel(runId) {
    if (!active || (runId && runId !== active.id)) return { cancelled: false, reason: '没有运行中的批次' }
    active.cancel = true
    active.controller?.abort()
    return { cancelled: true, runId: active.id }
  }

  /* ------------------------------------------------------- page views */
  function configInfo() { const { apiKey, ...rest } = settings; return { ...rest, apiKeySet: Boolean(apiKey), vocabDirResolved: vocabDir, version: VERSION } }

  async function runOrThrow(runId) {
    const run = await loadRun(runId || await latestId())
    if (!run) throw new Error('找不到批次')
    return run
  }
  /** Where one patient's bundle lives now (delivered / staged / held). */
  async function bundlePath(run, p) {
    const file = `${safeName(p.name)}.json`
    const candidates = p.status === 'held'
      ? [join(run.runDir, 'held', file)]
      : [run.output && join(run.output, 'bundles', file), join(run.runDir, 'output', run.inputName, 'bundles', file)].filter(Boolean)
    for (const c of candidates) if (await exists(c)) return c
    return null
  }
  const bundleCache = new Map() // path → { mtime, bundle }
  async function readBundle(path) {
    const st = await stat(path)
    const hit = bundleCache.get(path)
    if (hit && hit.mtime === st.mtimeMs) return hit.bundle
    const bundle = JSON.parse(await readFile(path, 'utf8'))
    bundleCache.set(path, { mtime: st.mtimeMs, bundle })
    if (bundleCache.size > 4) bundleCache.delete(bundleCache.keys().next().value)
    return bundle
  }
  async function patientDetail(runId, name) {
    const run = await runOrThrow(runId)
    const p = run.patients.find((x) => x.name === name)
    if (!p) throw new Error(`找不到病人 ${name}`)
    return { runId: run.id, patient: p, bundle: await bundlePath(run, p) }
  }
  /** Brief list of a patient's resources (no full bodies). */
  async function resources(runId, name, type) {
    const { patient, bundle } = await patientDetail(runId, name)
    if (!bundle) throw new Error((await runOrThrow(runId)).outputFormat === 'ndjson' ? '本批设置为只保存按资源类型的 NDJSON，没有按人的 Bundle，无法按病人浏览资源' : '找不到这位病人的 Bundle')
    const b = await readBundle(bundle)
    const all = b.entry.map((e) => e.resource)
    const types = {}
    for (const r of all) types[r.resourceType] = (types[r.resourceType] ?? 0) + 1
    const pick = type || Object.keys(types).find((t) => t === 'Observation') || Object.keys(types)[0]
    const rows = all.filter((r) => r.resourceType === pick).map(briefOf)
    rows.sort((a, b2) => String(b2.date ?? '').localeCompare(String(a.date ?? '')))
    return { patient: patient.name, path: bundle, types, type: pick, total: rows.length, rows: rows.slice(0, 2000) }
  }
  async function resource(runId, name, type, id) {
    const { bundle } = await patientDetail(runId, name)
    const b = await readBundle(bundle)
    const r = b.entry.map((e) => e.resource).find((x) => x.resourceType === type && x.id === id)
    if (!r) throw new Error('找不到资源')
    // 附件正文解码，便于阅读
    const texts = []
    const visit = (n, path) => {
      if (Array.isArray(n)) { n.forEach((x, i) => visit(x, `${path}[${i}]`)); return }
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (k === 'data' && typeof v === 'string') texts.push({ path, title: n.title ?? null, text: Buffer.from(v, 'base64').toString('utf8') }); else visit(v, `${path}.${k}`) }
    }
    visit(r, type)
    return { resource: r, texts }
  }
  async function mapping(runId) {
    const run = await runOrThrow(runId)
    let m = { profiles: [], inferred: [] }
    m = await runJson(run, 'mapping')
    const leftovers = {}
    for (const p of run.patients) for (const [k, n] of Object.entries(p.leftoverFields ?? {})) leftovers[k] = (leftovers[k] ?? 0) + n
    return {
      runId: run.id, tables: run.tables ?? {}, definitions: run.definitions ?? null,
      profiles: (m.profiles ?? []).map((p) => ({ id: p.id, name: p.name, version: p.version, tables: (p.tables ?? []).map((t) => ({ id: t.id, kind: t.kind, file: t.match?.file ?? t.match?.fileRe ?? null, roles: Object.keys(t.roles ?? {}).length })) })),
      inferred: m.inferred ?? [],
      leftovers: Object.entries(leftovers).sort((a, b) => b[1] - a[1]).slice(0, 300),
    }
  }

  /* ------------------------------------------- stages: views & review */
  async function runJson(run, name) { try { return await (await storeOfRun(run)).getDoc(run.id, name.replace(/\.json$/, '')) } catch { return null } }

  /** ① Schema 同构：每张表的类别、角色填充、原样保留字段。 */
  async function schemaView(runId) {
    const run = await runOrThrow(runId)
    const schema = await runJson(run, 'schema') ?? {}
    const m = await runJson(run, 'mapping') ?? { profiles: [], inferred: [] }
    const specs = new Map()
    for (const p of m.profiles ?? []) for (const t of p.tables ?? []) specs.set(t.id, { profile: p.id, kind: t.kind, file: t.match?.file ?? t.match?.fileRe ?? null, roles: t.roles ?? {}, domains: t.domains ?? {}, items: (t.items ?? []).length, sections: (t.sections ?? []).length })
    const inferred = new Map((m.inferred ?? []).map((s) => [s.id, s]))
    const drafts = new Map((await loadDraftedProfile(vocabDir)).records.map((r) => [r.spec?.id ?? r.file, r]))
    const tables = Object.values(schema).map((t) => {
      const spec = specs.get(t.table); const inf = inferred.get(t.table)
      const declared = Object.keys(spec?.roles ?? inf?.roles ?? {})
      return {
        table: t.table, kind: t.kind, rows: t.rows, invalid: t.invalid, file: spec?.file ?? inf?.match?.file ?? null, profile: spec?.profile ?? (inf ? 'auto' : null),
        inferred: Boolean(inf), suggestedKind: inf?.suggestedKind ?? null, reasons: inf?.reasons ?? [], fields: inf?.fields ?? null,
        draft: drafts.get(t.table) ? (({ file, status, agreement, origin, reviewedBy, models, rounds, disputed, dropped, dismissed, links, issue, trail, at, spec: sp }) => ({ file, status, agreement, origin, reviewedBy: reviewedBy ?? null, models, rounds, disputed, dropped, dismissed, links, issue, trail, at, spec: sp }))(drafts.get(t.table)) : null,
        roles: declared.map((role) => ({ role, fields: [].concat((spec?.roles ?? inf?.roles)[role]), filled: t.roles[role]?.filled ?? 0, used: t.roles[role]?.fields ?? {}, domain: spec?.domains?.[role] ?? null })),
        items: t.items, extras: Object.entries(t.extras).sort((a, b) => b[1] - a[1]),
      }
    }).sort((a, b) => b.rows - a.rows)
    // 起草了但本批没有用上（被驳回、失败）的表也列出来
    const used = new Set(tables.map((t) => t.table))
    const others = [...drafts.values()].filter((r) => !used.has(r.spec?.id ?? r.file)).map((r) => ({ table: r.spec?.id ?? r.file, file: r.file, status: r.status, kind: r.spec?.kind ?? null, issue: r.issue ?? null }))
    return { runId: run.id, tables, others, summary: run.stages?.schema ?? null, model: run.model?.phases?.schema ?? null }
  }

  /** ② 值域归一：每个值域的覆盖率、出现过的取值、当前对照（含本机复核，标出与本批不同的）。 */
  async function domainsView(runId) {
    const run = await runOrThrow(runId)
    const doms = await runJson(run, 'domains') ?? {}
    const vocab = await loadVocab(vocabDir)
    const { lookupEntry } = await import('./stages/vocab.js')
    const list = Object.values(doms).map((d) => {
      const def = vocab.domains.get(d.id)
      const values = d.values.map((v) => {
        const e = def ? lookupEntry(def, v.code ?? undefined, v.display ?? undefined) : undefined
        const current = e ? { status: e.status, to: e.to ?? null, note: e.note ?? e.basis ?? null, source: e.source, by: e.by ?? null, at: e.at ?? null, candidate: e.candidate ?? null, trail: e.trail ?? null, models: e.models ?? null } : null
        const runStatus = v.status
        const nowStatus = d.kind === 'format' ? runStatus : !e ? 'unmapped' : e.status === 'confirmed' ? 'normalized' : e.status
        return { ...v, current, changed: d.kind === 'enum' && (nowStatus !== runStatus || (current?.to ?? null) !== (v.to ?? null)) }
      })
      return { ...d, target: def?.target ? { system: def.target.system, name: def.target.name, open: Boolean(def.target.open), values: def.target.values ?? [] } : d.target, reviewed: def?.reviewed ?? 0, values, changed: values.filter((v) => v.changed).length }
    }).sort((a, b) => (a.kind === b.kind ? b.total - a.total : a.kind === 'enum' ? -1 : 1))
    return { runId: run.id, vocabVersion: run.vocab?.version ?? null, currentVocabVersion: vocab.version, vocabDir, domains: list, summary: run.stages?.domains ?? null }
  }

  /** ③ 术语对照：每个绑定的源概念、对照情况（含本机复核）。 */
  async function terminologyView(runId) {
    const run = await runOrThrow(runId)
    const terms = await runJson(run, 'terminology') ?? {}
    const vocab = await loadVocab(vocabDir)
    const list = Object.values(terms).map((t) => {
      const def = vocab.terminology.get(t.id)
      const concepts = t.list.map((c) => {
        const m = def?.index.get(c.key)
        const current = m ? { to: m.to, equivalence: m.equivalence, status: m.status, note: m.note ?? null, source: m.source, by: m.by ?? null, at: m.at ?? null, candidates: m.candidates ?? null, trail: m.trail ?? null, verifiedBy: m.verifiedBy ?? null } : null
        return { ...c, current, changed: JSON.stringify(current?.to ?? null) !== JSON.stringify(c.mapping?.to ?? null) || (current?.status ?? null) !== (c.mapping?.status ?? null) }
      })
      return { ...t, list: undefined, concepts: undefined, conceptCount: t.concepts, items: concepts, reviewed: def?.reviewed ?? 0, changed: concepts.filter((c) => c.changed).length, target: def?.target ?? t.target }
    }).sort((a, b) => b.occurrences - a.occurrences)
    return { runId: run.id, bindings: list, summary: run.stages?.terminology ?? null, vocabDir }
  }

  async function reviewDomain(request) {
    if (!vocabDir) throw new Error('没有可写的对照目录（vocabDir）')
    return saveDomainEntry(vocabDir, request.domain, { code: request.code ?? undefined, display: request.display ?? undefined, to: request.to ?? null, status: request.status, note: request.note }, request.by ?? 'user')
  }
  async function reviewTerm(request) {
    if (!vocabDir) throw new Error('没有可写的对照目录（vocabDir）')
    return saveTermMapping(vocabDir, request.binding, { key: request.key, from: request.from, to: request.to, equivalence: request.equivalence, status: request.status, note: request.note }, request.by ?? 'user')
  }
  /** 模型起草的规格：确认 / 驳回（回到 Basic）/ 修改。 */
  async function reviewDraft(request) {
    if (!vocabDir) throw new Error('没有可写的对照目录（vocabDir）')
    const { records } = await loadDraftedProfile(vocabDir)
    const r = records.find((x) => x.file === request.file)
    if (!r) throw new Error('找不到这张表的起草规格')
    if (request.action === 'confirm') { r.status = 'confirmed'; r.reviewedBy = 'user'; r.reviewedAt = new Date().toISOString() }
    else if (request.action === 'reject') { r.status = 'rejected'; r.reviewedBy = 'user'; r.reviewedAt = new Date().toISOString() }
    else if (request.action === 'redraft') { r.status = 'failed'; r.note = '人工要求重新起草' }
    else if (request.action === 'edit') {
      const spec = typeof request.spec === 'string' ? JSON.parse(request.spec) : request.spec
      const { checkSpec } = await import('./mapping/roles.js')
      const problems = checkSpec({ ...spec, id: spec.id ?? r.spec?.id })
      if (problems.length) throw new Error(`规格有问题：${problems.join('；')}`)
      r.spec = { ...spec, id: r.spec?.id ?? spec.id, match: { file: r.file }, drafted: true }
      r.status = 'confirmed'; r.reviewedBy = 'user'; r.reviewedAt = new Date().toISOString()
    } else throw new Error('未知操作')
    await saveDraft(vocabDir, r)
    return { saved: true }
  }
  async function confirmModel(request) {
    if (!vocabDir) throw new Error('没有可写的对照目录（vocabDir）')
    return confirmModelResult(vocabDir, request.kind, request.id, request.key)
  }
  /** 模型调用：统计、交叉核验、最近的调用（只有大小与耗时，没有内容）。 */
  async function modelView(runId) {
    const run = await runOrThrow(runId)
    const calls = await (await storeOfRun(run)).calls(run.id)
    return { runId: run.id, model: run.model ?? null, calls: calls.slice(-300) }
  }
  /** 测试连接：读模型列表，确认配置的模型在端点上。 */
  async function testConnection(request = {}) {
    const out = {}
    for (const [role, base, model] of [['suggest', request.baseURL ?? settings.baseURL, request.model ?? settings.model], ['verify', request.verifyBaseURL || request.baseURL || settings.verifyBaseURL || settings.baseURL, request.verifyModel ?? settings.verifyModel]]) {
      if (!base || !model) { out[role] = { ok: false, skipped: true }; continue }
      try {
        const models = await createLlm({ baseURL: base, model, apiKey: request.apiKey || settings.apiKey, timeoutMs: 15000 }).listModels()
        out[role] = { ok: models.includes(model), models: models.slice(0, 20), message: models.includes(model) ? '连接正常' : `端点上没有模型 ${model}` }
      } catch (error) { out[role] = { ok: false, message: String(error?.message ?? error) } }
    }
    return out
  }

  /** 用当前对照重跑一批（同一输入、同一输出根目录，新批次）。 */
  async function rerun(runId) {
    const run = await runOrThrow(runId)
    return start({ inputDir: run.input, outputRoot: run.outputRoot, source: { kind: 'rerun', of: run.id } })
  }

  /**
   * 删除批次的过程记录：记录库里的批次、统计、模型调用和缓存，以及 _records/runs/<批次>/（报告、中间结果、暂扣、校验结果）。
   * 交付目录（<输出根目录>/<输入名>/）不删。
   */
  async function deleteRun(runId) {
    if (!runId) throw new Error('缺少批次 id')
    if (active?.id === runId) throw new Error('批次正在运行，先取消再删除')
    const run = await loadRun(runId)
    if (!run) throw new Error(`找不到批次 ${runId}`)
    const dir = resolve(run.runDir)
    if (basename(dirname(dir)) !== 'runs' || basename(dirname(dirname(dir))) !== RECORDS || basename(dir) !== runId) throw new Error('批次记录目录不在预期位置，未删除')
    await (await storeOfRun(run)).deleteRun(runId)
    await rm(dir, { recursive: true, force: true })
    runsCache.delete(runId)
    return { deleted: true, runId, kept: run.output ?? null }
  }
  /** 一条对照的修改历史（谁、什么时候、改成了什么）。 */
  async function history(request) {
    const { vocabHistory } = await import('./stages/vocab.js')
    return { history: await vocabHistory(vocabDir, request.kind, request.id, request.key ?? '') }
  }
  function dispose() {
    if (active) { active.cancel = true; active.controller?.abort() }
    for (const st of stores.values()) { try { st.close() } catch { /* closed */ } }
    stores.clear()
    closeVocabStores()
  }

  return { settings, start, cancel, status, list, report, loadRun, configInfo, patientDetail, resources, resource, mapping, schemaView, domainsView, terminologyView, reviewDomain, reviewTerm, rerun, reviewDraft, confirmModel, modelView, testConnection, deleteRun, history, isRunning: () => Boolean(active), dispose }
}
