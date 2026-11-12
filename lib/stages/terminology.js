/**
 * ③ 术语对照：把（已归一的）本地概念对照到外部标准术语（LOINC、SNOMED CT、国家标准代码表……）。
 *
 * 与值域归一不同：不改值、不判对错，只在已确认的对照上“另加”一个标准编码；没对照的概念照常交付。
 * 对照表：vocab/terminology/<绑定>.json（内置）+ 本机复核。每个绑定声明从哪里取源概念（extract）：
 *   { kind, code, display, scope }  按角色取（scope=org 时按机构区分）
 *   { item }                         按规格里逐项展开的观察项（local 名）
 *   { domain }                       按值域归一后的规范值
 *
 * 结果挂在归一记录上：N.terms[<绑定>] = { key, codings: [...] }。
 */
import { str } from '../fhir/datatypes.js'
import { termKey } from './vocab.js'

export function conceptKey(scope, code, display) {
  return [scope ?? '', code ?? '', code === undefined || code === '' ? display ?? '' : ''].join('|')
}

export function createTerminology({ vocab, resolveSystem = (s) => s }) {
  const stats = new Map() // binding → Map(key → concept)
  const MAX = 5000

  function sourceOf(t, N) {
    const x = t.extract ?? {}
    if (x.kind && x.kind !== N.kind) return null
    if (x.domain) {
      for (const v of Object.values(N.values ?? {})) if (v.domain === x.domain && v.status === 'normalized') return { code: v.to ?? v.value?.code, display: v.value?.display }
      for (const c of Object.values(N.concepts ?? {})) if (c.domain === x.domain && c.status === 'normalized') return { code: c.to, display: c.value?.display }
      return null
    }
    if (x.item) {
      const idx = (N._spec?.items ?? []).findIndex((it) => it.local === x.item)
      const it = idx >= 0 ? N.items.find((i) => i.index === idx) : undefined
      if (!it) return null
      return { code: str(it.raw), display: str(it.display) ?? str(it.raw) }
    }
    const code = x.code ? str(N.roles[x.code]?.raw) : undefined
    const display = x.display ? str(N.roles[x.display]?.raw) : undefined
    if (code === undefined && display === undefined) return null
    return { code: x.code ? code : undefined, display, scope: x.scope === 'org' ? str(N.roles['org.code']?.raw ?? N.roles['org.name']?.raw) : undefined }
  }

  function apply(N) {
    N.terms = {}
    for (const t of vocab.terminology.values()) {
      const src = sourceOf(t, N)
      if (!src) continue
      const key = termKey(t, src)
      const m = t.index.get(key)
      const mapped = m && m.status === 'confirmed' && m.to && m.equivalence !== 'unmatched'
      const s = stats.get(t.id) ?? new Map()
      stats.set(t.id, s)
      let c = s.get(key)
      if (!c && s.size < MAX) { c = { key, scope: src.scope ?? null, code: src.code ?? null, display: src.display ?? null, count: 0, mapping: m ? { to: m.to, equivalence: m.equivalence, status: m.status, note: m.note ?? null, source: m.source } : null }; s.set(key, c) }
      if (c) c.count++
      N.terms[t.id] = { key, codings: mapped ? [{ system: resolveSystem(t.target.system), code: m.to.code, display: m.to.display }] : [] }
    }
    return N
  }

  function summary() {
    const out = {}
    for (const t of vocab.terminology.values()) {
      const s = stats.get(t.id) ?? new Map()
      const concepts = [...s.values()].sort((a, b) => b.count - a.count)
      const total = concepts.reduce((n, c) => n + c.count, 0)
      const ok = (c) => c.mapping && c.mapping.status === 'confirmed' && c.mapping.to
      const mappedOcc = concepts.filter(ok).reduce((n, c) => n + c.count, 0)
      out[t.id] = {
        id: t.id, name: t.name, description: t.description ?? '', version: t.version ?? null, target: t.target, lands: t.lands ?? null, extract: t.extract,
        concepts: concepts.length, mappedConcepts: concepts.filter(ok).length, occurrences: total, mappedOccurrences: mappedOcc,
        coverage: total ? mappedOcc / total : null, list: concepts,
      }
    }
    return out
  }
  return { apply, summary }
}

/** FHIR ConceptMap resources for confirmed mappings actually used in this batch. */
export function conceptMaps(vocab, termSummary, { ns, resolveSystem = (s) => s }) {
  const out = []
  for (const t of vocab.terminology.values()) {
    const used = new Set((termSummary[t.id]?.list ?? []).map((c) => c.key))
    const ms = t.mappings.filter((m) => m.status === 'confirmed' && m.to && used.has(m.key))
    if (!ms.length) continue
    const byScope = new Map()
    for (const m of ms) { const scope = m.key.split('|')[0]; byScope.set(scope, [...(byScope.get(scope) ?? []), m]) }
    out.push({
      resourceType: 'ConceptMap', id: `term-${t.id}`.slice(0, 64), url: `${ns}/ConceptMap/${t.id}`, version: t.version ?? '1.0.0', name: t.id.replace(/(^|-)(\w)/g, (x, a, c) => c.toUpperCase()), title: t.name, status: 'active',
      description: t.description ?? undefined, targetUri: resolveSystem(t.target.system),
      group: [...byScope.entries()].map(([scope, list]) => ({
        source: `${ns}/CodeSystem/terminology-source/${t.id}${scope ? `/${encodeURIComponent(scope)}` : ''}`,
        target: resolveSystem(t.target.system),
        element: list.map((m) => ({ code: m.key.split('|')[1] || m.key.split('|')[2], display: m.from?.display ?? undefined, target: [{ code: m.to.code, display: m.to.display ?? undefined, equivalence: m.equivalence ?? 'equivalent' }] })),
      })),
    })
  }
  return JSON.parse(JSON.stringify(out))
}
