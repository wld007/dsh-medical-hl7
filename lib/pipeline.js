/**
 * 一位病人走完四个阶段：① Schema 同构 → ② 值域归一 → ③ 术语对照 → ④ FHIR 组装。
 * 每个阶段的产物都返回，便于落盘审计（中间结果）和统计。
 */
import { harmonize } from './stages/harmonize.js'
import { convertPatient } from './convert.js'

/**
 * @param records [{ spec, profileId, row, file }]
 * @param stages  { schemaStats, normalizer, terminology }
 */
export function processPatient(key, records, ctx, stages) {
  const harmonized = []
  const normalized = []
  for (const rec of records) {
    const h = harmonize(rec)
    stages.schemaStats.add(h, rec.spec)
    harmonized.push(h)
    const N = stages.normalizer.normalize(h, rec.spec)
    Object.defineProperty(N, '_spec', { value: rec.spec, enumerable: false })
    stages.terminology.apply(N)
    normalized.push({ spec: rec.spec, N })
  }
  const out = convertPatient(key, normalized, ctx)
  return { ...out, harmonized, normalized: normalized.map((x) => x.N) }
}

/** Merge terminology summaries (per-unit → batch). */
export function mergeTermSummaries(a = {}, b = {}) {
  const out = structuredClone(a)
  for (const [id, s] of Object.entries(b)) {
    const t = out[id]
    if (!t) { out[id] = structuredClone(s); continue }
    const byKey = new Map(t.list.map((c) => [c.key, c]))
    for (const c of s.list) { const x = byKey.get(c.key); if (x) x.count += c.count; else byKey.set(c.key, structuredClone(c)) }
    t.list = [...byKey.values()].sort((x, y) => y.count - x.count)
    const ok = (c) => c.mapping && c.mapping.status === 'confirmed' && c.mapping.to
    t.concepts = t.list.length; t.mappedConcepts = t.list.filter(ok).length
    t.occurrences = t.list.reduce((n, c) => n + c.count, 0); t.mappedOccurrences = t.list.filter(ok).reduce((n, c) => n + c.count, 0)
    t.coverage = t.occurrences ? t.mappedOccurrences / t.occurrences : null
  }
  return out
}
