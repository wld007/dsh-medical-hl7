/**
 * 模型阶段的编排（在正式转换之前）：
 *   A. Schema 同构：找出没有映射规格的表 → 模型起草（draftSpecs）→ 存 <vocabDir>/specs/
 *   B. 扫描：按新规格把全部记录过一遍同构 / 归一 / 术语对照（不输出），收集“无对照”的取值和概念
 *   C. 值域归一：无对照的取值 → 模型（suggestValues）→ 存 <vocabDir>/domains/
 *   D. 术语对照：没有对照的概念 → 模型（suggestTerms）→ 存 <vocabDir>/terminology/
 * 模型结果都持久化在本机对照目录里：下一批直接复用，不再问；人工复核的条目永远不会被模型覆盖。
 */
import { basename, relative, sep } from 'node:path'
import { readRows, matchSpec, readUnit } from '../source.js'
import { inferSpec } from '../mapping/infer.js'
import { harmonize } from '../stages/harmonize.js'
import { createNormalizer } from '../stages/normalize.js'
import { createTerminology } from '../stages/terminology.js'
import { draftSpecs, saveDraft } from './schema.js'
import { suggestValues } from './values.js'
import { suggestTerms } from './terms.js'
import { saveModelDomainEntries, saveModelTermMappings } from '../stages/vocab.js'
import { createLinkStats } from './links.js'

/** Tables (by file name) that no profile matches and that have no draft record yet. */
export async function discoverTables(units, profiles, records) {
  const known = new Map(records.map((r) => [r.file, r]))
  const byFile = new Map()
  for (const u of units) {
    for (const f of u.files) {
      const name = basename(f)
      let t = byFile.get(name)
      if (t?.done) continue
      let rows
      try { rows = await readRows(f) } catch { continue }
      if (!rows.length) continue
      if (!t) {
        if (matchSpec(profiles, f, rows[0])) { byFile.set(name, { done: true }); continue }
        const prev = known.get(name)
        if (prev && prev.status !== 'failed') { byFile.set(name, { done: true }); continue }
        const rel = relative(u.dir, f).split(sep)
        t = { file: name, path: [...rel.slice(0, -1).filter((x) => !/^\d{6}$/.test(x)), name].join('/'), rows: [], rowFiles: [], files: 0 }
        byFile.set(name, t)
      }
      // 样本：最多 4 个文件（尽量来自不同病人）、共 60 行
      if (t.files < 4 && t.rows.length < 60) { const add = rows.slice(0, Math.max(5, Math.floor((60 - t.rows.length) / Math.max(1, 4 - t.files)))); t.rows.push(...add); t.rowFiles.push(...add.map(() => t.files)); t.files++ }
      if (t.files >= 4 || t.rows.length >= 60) t.full = true
    }
  }
  return [...byFile.values()].filter((t) => !t.done).map((t) => ({ file: t.file, path: t.path, rows: t.rows, rowFiles: t.rowFiles, inferred: inferSpec(t.file, t.rows) }))
}

/** Pass over all records without output: value-domain and terminology statistics under the current vocab. */
export async function scanStats(units, profiles, inputRoot, vocab, { timezone, resolveSystem, onUnit, signal }) {
  const normalizer = createNormalizer({ vocab, timezone })
  const terminology = createTerminology({ vocab, resolveSystem })
  const inferred = new Map()
  let i = 0
  for (const u of units) {
    if (signal?.aborted) throw new Error('已取消')
    const r = await readUnit(u, profiles, inputRoot, inferred)
    for (const [, p] of r.patients) {
      for (const rec of p.records) {
        const N = normalizer.normalize(harmonize(rec), rec.spec)
        Object.defineProperty(N, '_spec', { value: rec.spec, enumerable: false })
        terminology.apply(N)
      }
    }
    onUnit?.(++i, units.length)
  }
  return { domains: normalizer.summary(), terminology: terminology.summary() }
}

const count = (list, f) => list.filter(f).length

/**
 * Run phases A–D. Mutates nothing but the vocab dir; returns per-phase summaries.
 * @param ctx { units, profiles, loadProfiles(), vocabDir, loadVocab(), runner, settings, inputRoot, resolveSystem, signal, progress(step) , loinc }
 */
export async function runModelPhases(ctx) {
  const { units, vocabDir, runner, settings, signal, progress } = ctx
  const maxRounds = Math.min(6, Math.max(1, Number(settings.maxRounds) || 3))
  const phases = {}

  // A. Schema 同构：起草
  let { profiles, records } = await ctx.loadProfiles()
  progress('① Schema 同构：找没有映射规格的表')
  const tables = await discoverTables(units, profiles, records)
  if (tables.length) {
    progress(`① Schema 同构：模型起草 ${tables.length} 张表的映射规格`)
    const { records: drafted, cross } = await draftSpecs({ tables, runner, vocab: await ctx.loadVocab(), maxRounds, signal, onProgress: (n, total) => progress(`① Schema 同构：模型起草 ${n}/${total}`) })
    for (const r of drafted) if (r.status !== 'failed') await saveDraft(vocabDir, r)
    phases.schema = { tables: tables.length, applied: count(drafted, (r) => r.status === 'applied'), agreed: count(drafted, (r) => r.agreement === 'agreed'), disputed: count(drafted, (r) => r.agreement === 'disputed'), review: count(drafted, (r) => r.status === 'review'), failed: count(drafted, (r) => r.status === 'failed'), cross, list: drafted.map((r) => ({ file: r.file, status: r.status, kind: r.spec?.kind ?? null, roles: r.spec ? Object.keys(r.spec.roles).length : 0, rounds: r.rounds ?? 0, disputed: r.disputed ?? [] })) }
    ;({ profiles } = await ctx.loadProfiles())
  } else phases.schema = { tables: 0, applied: 0, review: 0, failed: 0, cross: null, list: [] }

  // A2. 就诊号关联：由数据核对（不靠模型）
  if ((await ctx.loadProfiles()).records.some((r) => r.spec && r.status !== 'rejected' && !r.reviewedBy)) {
    progress('① Schema 同构：核对就诊号关联')
    const links = createLinkStats()
    const inferredCache = new Map()
    for (const u of units) {
      if (signal?.aborted) throw new Error('已取消')
      const r = await readUnit(u, profiles, ctx.inputRoot, inferredCache)
      for (const [, p] of r.patients) links.add(p.records)
    }
    const { records: recs } = await ctx.loadProfiles()
    const byId = new Map(recs.filter((r) => r.spec && !r.reviewedBy && r.status !== 'rejected').map((r) => [r.spec.id, r]))
    const fixes = links.decide(new Map([...byId].map(([id, r]) => [id, { ...r.spec, drafted: true }])))
    const touched = new Set()
    for (const f of fixes) {
      const r = byId.get(f.table)
      if (!r) continue
      if (f.field) r.spec.roles[f.role] = f.field; else delete r.spec.roles[f.role]
      r.links = [...(r.links ?? []).filter((x) => x.role !== f.role), { role: f.role, field: f.field, previous: f.previous, evidence: f.evidence }]
      touched.add(r)
    }
    for (const r of touched) await saveDraft(vocabDir, r)
    phases.schema.links = fixes.map((f) => ({ table: f.table, role: f.role, field: f.field, previous: f.previous, evidence: f.evidence }))
    ;({ profiles } = await ctx.loadProfiles())
  }

  // B. 扫描
  progress('② ③ 扫描全部记录：找无对照的取值和概念')
  const stats = await scanStats(units, profiles, ctx.inputRoot, await ctx.loadVocab(), { timezone: settings.timezone, resolveSystem: ctx.resolveSystem, signal, onUnit: (i, n) => progress(`② ③ 扫描 ${i}/${n} 个目录`) })

  // C. 值域归一
  const vocab = await ctx.loadVocab()
  const limit = Math.max(1, Number(settings.valueLimit) || 300)
  // 只交给模型：目标值集封闭的值域，以及 UCUM 单位（开放但有规范写法）
  const vwork = Object.values(stats.domains).filter((d) => d.kind === 'enum' && vocab.domains.has(d.id) && (!vocab.domains.get(d.id).target?.open || d.id === 'ucum-unit'))
    .map((d) => ({ domain: vocab.domains.get(d.id), values: d.values.filter((v) => v.status === 'unmapped').slice(0, limit) })).filter((w) => w.values.length)
  const vtotal = vwork.reduce((n, w) => n + w.values.length, 0)
  if (vtotal) {
    progress(`② 值域归一：模型处理 ${vtotal} 个无对照的取值`)
    const { decisions, cross } = await suggestValues({ work: vwork, runner, maxRounds, signal, onProgress: (n, t) => progress(`② 值域归一：模型 ${n}/${t}`) })
    const byDomain = new Map()
    for (const x of decisions) byDomain.set(x.domain, [...(byDomain.get(x.domain) ?? []), { ...(x.code !== undefined ? { code: x.code } : {}), ...(x.display !== undefined ? { display: x.display } : {}), ...x.entry }])
    for (const [id, list] of byDomain) await saveModelDomainEntries(vocabDir, id, list)
    const st = (s) => count(decisions, (x) => x.entry.status === s)
    phases.values = { asked: vtotal, confirmed: st('confirmed'), text: st('text'), invalid: st('invalid'), pending: st('pending'), failed: vtotal - decisions.length, cross }
  } else phases.values = { asked: 0, confirmed: 0, text: 0, invalid: 0, pending: 0, failed: 0, cross: null }

  // D. 术语对照
  const tlimit = Math.max(1, Number(settings.termLimit) || 500)
  const twork = Object.values(stats.terminology).filter((t) => vocab.terminology.has(t.id))
    .map((t) => ({ binding: vocab.terminology.get(t.id), concepts: t.list.filter((c) => !c.mapping).slice(0, tlimit) })).filter((w) => w.concepts.length)
  const ttotal = twork.reduce((n, w) => n + w.concepts.length, 0)
  if (ttotal) {
    progress(`③ 术语对照：模型处理 ${ttotal} 个未对照的概念`)
    const { decisions, cross, skipped } = await suggestTerms({ work: twork, runner, maxRounds, tables: ctx.tables, signal, onProgress: (n, t) => progress(`③ 术语对照：模型 ${n}/${t}`) })
    const byBinding = new Map()
    for (const x of decisions) byBinding.set(x.binding, [...(byBinding.get(x.binding) ?? []), x.mapping])
    for (const [id, list] of byBinding) await saveModelTermMappings(vocabDir, id, list)
    const asked = ttotal - skipped.reduce((n, x) => n + x.concepts, 0)
    phases.terms = { asked, confirmed: count(decisions, (x) => x.mapping.status === 'confirmed'), abstain: count(decisions, (x) => x.mapping.status === 'pending' && !/分歧/.test(x.mapping.note ?? '')), review: count(decisions, (x) => /分歧/.test(x.mapping.note ?? '')), failed: asked - decisions.length, cross, skipped, tables: [...(ctx.tables?.values() ?? [])].map((t) => ({ name: t.name, size: t.size, zh: Boolean(t.hasZh) })) }
  } else phases.terms = { asked: 0, confirmed: 0, abstain: 0, review: 0, failed: 0, cross: null, skipped: [], tables: [...(ctx.tables?.values() ?? [])].map((t) => ({ name: t.name, size: t.size, zh: Boolean(t.hasZh) })) }
  return phases
}
