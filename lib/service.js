/**
 * 批次服务：Agent 工具、/hl7 命令共用。
 *
 * 输出布局：
 *   <outputRoot>/<输入名>/                交付（批次结束后才出现；验收门未过的病人不在里面）
 *     bundles/<病人>.json  ndjson/<类型>.ndjson  manifest.json
 *   <outputRoot>/_records/
 *     index.json                          最近批次
 *     runs/<runId>/run.json report.md report.json mapping.json
 *                  output/                 暂存（完成后整体移到根目录）
 *                  held/<病人>.json        验收门未过的病人（不交付）
 *                  validator/              官方 HL7 Validator 抽检结果
 */
import { mkdir, readFile, writeFile, readdir, rename, stat, realpath, rm } from 'node:fs/promises'
import { join, resolve, relative, basename, dirname, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { loadProfiles, findUnits, readUnit } from './source.js'
import { convertPatient, createContext } from './convert.js'
import { validateResources } from './fhir/validate.js'
import { scanResidual } from './gates.js'
import { transactionBundle, writeBundle, createBulkWriter, writeManifest, safeName } from './output.js'
import { renderReport } from './report.js'
import { createDefinitionCollector } from './definitions.js'

const RECORDS = '_records'

export const DEFAULTS = {
  outputRoot: '',
  namespace: 'http://dsh.local/fhir',
  timezone: '+08:00',
  profilesDir: '',
  residualGate: 'block',
  outputFormat: 'both',
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
    if (await exists(join(d, RECORDS, 'vault.json')) || await exists(join(d, RECORDS, 'runs'))) {
      let runId = null
      try { runId = JSON.parse(await readFile(join(d, RECORDS, 'index.json'), 'utf8'))?.[0]?.id ?? null } catch { /* none */ }
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

export function createService({ config = {}, defaultDirectory = process.cwd(), stateDir = null } = {}) {
  const settings = { ...DEFAULTS, ...config }
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

  async function saveRun(run) {
    runsCache.set(run.id, run)
    await mkdir(run.runDir, { recursive: true })
    await writeFile(join(run.runDir, 'run.json'), JSON.stringify(run, null, 2))
    const idxPath = join(run.outputRoot, RECORDS, 'index.json')
    let idx = []
    try { idx = JSON.parse(await readFile(idxPath, 'utf8')) } catch { /* new */ }
    const brief = { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt ?? null, input: run.inputName, patients: run.totals.patients, resources: run.totals.resources, held: run.totals.held }
    idx = [brief, ...idx.filter((r) => r.id !== run.id)].slice(0, 100)
    await writeFile(idxPath, JSON.stringify(idx, null, 2))
  }

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
      provenance,
      patients: [], units: [], totals: { units: 0, patients: 0, done: 0, held: 0, resources: 0, errors: 0, warnings: 0 },
      warnings: [], current: null,
    }
    run.status = 'running'; run.finishedAt = null; delete run.error
    if (!prev && provenance.kind !== 'delivered') run.warnings.push(provenance.note)
    active = { id, cancel: false, run }
    await saveRun(run)
    await rememberRoot(outputRoot)
    execute(run).catch(async (error) => {
      run.status = 'failed'; run.error = String(error?.stack ?? error); run.finishedAt = new Date().toISOString(); run.current = null
      await saveRun(run).catch(() => {})
    }).finally(() => { if (active?.id === id) active = null })
    return { runId: id, outputRoot, provenance: run.provenance }
  }

  async function execute(run) {
    const profiles = await loadProfiles([settings.profilesDir].filter(Boolean))
    const skip = (p) => resolve(p) === resolve(run.outputRoot) || basename(p) === '_medical-hl7'
    const units = await findUnits(run.input, skip, profiles)
    if (!units.length) throw new Error('输入里没有找到数据文件（.json / .ndjson / .csv）')
    const allFiles = units.flatMap((u) => u.files)
    const before = await snapshot(allFiles)
    const staging = join(run.runDir, 'output', run.inputName)
    const bundlesDir = join(staging, 'bundles')
    const heldDir = join(run.runDir, 'held')
    const ctx = createContext({ namespace: settings.namespace, timezone: settings.timezone, profileId: profiles[0]?.id ?? 'source' })
    const inferred = new Map()
    // 继续处理：整单元完成的跳过；做到一半的单元整体重做
    const finishedUnits = new Set(run.units.map((u) => u.name))
    run.patients = run.patients.filter((p) => finishedUnits.has(p.unit))
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
      for (const [key, p] of r.patients) {
        if (active?.cancel) break
        run.current = { unit: unit.name, step: '转换' }
        if (seenKeys.has(key) && seenKeys.get(key) !== unit.name) run.warnings.push(`同一病人编号出现在 ${seenKeys.get(key)} 和 ${unit.name} 两个目录里，分别转换（导入服务器时后者覆盖前者的 Patient）`)
        seenKeys.set(key, unit.name)
        const name = multi ? `${unit.name}__${key}` : unit.name
        const out = convertPatient(key, p.records, ctx)
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
        run.totals = totalsOf(run)
      }
      run.units.push({ name: unit.name, files: unit.files.length, patients: r.patients.size })
      run.profilesUsed = [...profilesUsed]
      run.tables = tables
      await saveRun(run)
    }
    run.current = null
    // 本批用到的映射（含自动推断的规格），便于人改成正式规格
    await mkdir(run.runDir, { recursive: true })
    const used = profiles.filter((p) => profilesUsed.has(p.id)).map(({ path, ...p }) => ({ ...p, source: path }))
    await writeFile(join(run.runDir, 'mapping.json'), JSON.stringify({ profiles: used, inferred: [...inferred.values()] }, null, 2))
    run.inferred = [...inferred.values()].map((s) => ({ id: s.id, file: s.match.file, suggestedKind: s.suggestedKind, roles: s.reasons.length, rows: tables[s.id] ?? 0 }))

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
    }
    run.finishedAt = new Date().toISOString()
    const report = renderReport(run)
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
      try { const run = JSON.parse(await readFile(join(root, RECORDS, 'runs', id, 'run.json'), 'utf8')); runsCache.set(id, run); return run } catch { /* next */ }
    }
    return null
  }
  async function list() {
    const out = []
    for (const root of await knownRoots()) {
      try { for (const r of JSON.parse(await readFile(join(root, RECORDS, 'index.json'), 'utf8'))) out.push({ ...r, outputRoot: root }) } catch { /* gone */ }
    }
    out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    return { runs: out, active: active?.id ?? null }
  }
  async function latestId() { return active?.id ?? (await list()).runs[0]?.id ?? null }
  async function status(runId) {
    const id = runId || await latestId()
    const run = id ? await loadRun(id) : null
    return { run: run ? { ...run, patients: run.patients.map(({ leftoverFields, validation, residual, issues, timeUnparsed, byKind, ...p }) => p) } : null, active: active?.id ?? null }
  }
  async function report(runId) {
    const id = runId || await latestId()
    const run = id ? await loadRun(id) : null
    if (!run) throw new Error('还没有批次')
    const path = join(run.runDir, 'report.md')
    try { return { runId: id, path, markdown: await readFile(path, 'utf8') } } catch { return { runId: id, path, markdown: renderReport(run).markdown } }
  }
  async function cancel(runId) {
    if (!active || (runId && runId !== active.id)) return { cancelled: false, reason: '没有运行中的批次' }
    active.cancel = true
    return { cancelled: true, runId: active.id }
  }

  /* ------------------------------------------------------- page views */
  function configInfo() { return { ...settings } }

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
    try { m = JSON.parse(await readFile(join(run.runDir, 'mapping.json'), 'utf8')) } catch { /* running */ }
    const leftovers = {}
    for (const p of run.patients) for (const [k, n] of Object.entries(p.leftoverFields ?? {})) leftovers[k] = (leftovers[k] ?? 0) + n
    return {
      runId: run.id, tables: run.tables ?? {}, definitions: run.definitions ?? null,
      profiles: (m.profiles ?? []).map((p) => ({ id: p.id, name: p.name, version: p.version, tables: (p.tables ?? []).map((t) => ({ id: t.id, kind: t.kind, file: t.match?.file ?? t.match?.fileRe ?? null, roles: Object.keys(t.roles ?? {}).length })) })),
      inferred: m.inferred ?? [],
      leftovers: Object.entries(leftovers).sort((a, b) => b[1] - a[1]).slice(0, 300),
    }
  }

  return { settings, start, cancel, status, list, report, loadRun, configInfo, patientDetail, resources, resource, mapping, isRunning: () => Boolean(active), dispose: () => { if (active) active.cancel = true } }
}
