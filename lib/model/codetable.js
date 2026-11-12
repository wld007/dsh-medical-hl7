/**
 * 本地标准代码表：术语对照的候选只从这里来，模型只能在候选里选（闭集选择），不能凭记忆给代码。
 *
 *   LOINC：loinc.org 下载包里的 LoincTable/Loinc.csv；可选中文变体 LinguisticVariants/zhCN*LinguisticVariant.csv
 *   SNOMED CT：RF2 发布包里的 sct2_Description_Snapshot-*.txt（概念描述）
 *
 * 检索：先由模型把本地概念改写成检索要素（英文组分、标本系统、属性、标尺……），
 * 插件在代码表里按词项打分取前若干个候选（含中文名时用中文双字索引）。
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

/** Streaming CSV (RFC 4180, multi-line quoted cells). Yields objects keyed by header. */
export async function* readCsv(path, { delimiter = ',', quote = '"' } = {}) {
  let head = null; let row = []; let cell = ''; let q = false; let pendingQuote = false
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })
  const emit = function* () {
    row.push(cell); cell = ''
    if (!head) { head = row.map((h) => h.replace(/^\uFEFF/, '')) } else if (row.length > 1 || row[0] !== '') yield Object.fromEntries(head.map((h, i) => [h, row[i] ?? '']))
    row = []
  }
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (pendingQuote) { pendingQuote = false; if (ch === quote) { cell += quote; continue } q = false }
      if (q) { if (ch === quote) pendingQuote = true; else cell += ch; continue }
      if (ch === quote && quote) { q = true; continue }
      if (ch === delimiter) { row.push(cell); cell = ''; continue }
      if (ch === '\r') continue
      if (ch === '\n') { yield* emit(); continue }
      cell += ch
    }
  }
  if (cell !== '' || row.length) yield* emit()
}

const CJK = /[\u3400-\u9fff]/
const STOP = new Set(['in', 'of', 'by', 'or', 'and', 'the', 'a', 'an', 'to', 'for', 'with', 'on', 'at', 'per', 'xxx'])
export function tokens(text) {
  const out = []
  const s = String(text ?? '').toLowerCase()
  for (const w of s.split(/[^a-z0-9\u3400-\u9fff]+/)) {
    if (!w) continue
    if (CJK.test(w)) {
      const chars = [...w].filter((c) => CJK.test(c))
      if (chars.length === 1) out.push(chars[0])
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1])
    } else if (!STOP.has(w) && w.length > 1) out.push(w)
  }
  return out
}

function buildIndex(entries) {
  const index = new Map() // token → Set(i)
  entries.forEach((e, i) => {
    for (const t of new Set([...e.main, ...e.other])) { let s = index.get(t); if (!s) index.set(t, (s = [])); s.push(i) }
  })
  const N = entries.length
  const idf = (t) => Math.log(1 + N / (index.get(t)?.length ?? N))
  return { index, idf }
}

/** LOINC: main table + optional Chinese linguistic variant. */
export async function loadLoinc(mainPath, zhPath) {
  const zh = new Map()
  if (zhPath) for await (const r of readCsv(zhPath)) zh.set(r.LOINC_NUM, { component: r.COMPONENT ?? '', name: r.LONG_COMMON_NAME ?? r.LinguisticVariantDisplayName ?? '', related: r.RELATEDNAMES2 ?? '', system: r.SYSTEM ?? '' })
  const entries = []
  for await (const r of readCsv(mainPath)) {
    if (!r.LOINC_NUM) continue
    if (r.STATUS && r.STATUS !== 'ACTIVE') continue
    const z = zh.get(r.LOINC_NUM)
    entries.push({
      code: r.LOINC_NUM, display: r.LONG_COMMON_NAME || r.SHORTNAME || r.COMPONENT,
      component: r.COMPONENT, system: r.SYSTEM, property: r.PROPERTY, scale: r.SCALE_TYP, time: r.TIME_ASPCT, method: r.METHOD_TYP, cls: r.CLASS,
      units: r.EXAMPLE_UCUM_UNITS || r.EXAMPLE_UNITS || '', rank: Number(r.COMMON_TEST_RANK) || 0, zh: z?.name ?? '',
      main: tokens(`${r.COMPONENT} ${z?.component ?? ''}`), other: tokens(`${r.SHORTNAME} ${r.RELATEDNAMES2} ${r.LONG_COMMON_NAME} ${z?.name ?? ''} ${z?.related ?? ''}`),
    })
  }
  return { system: 'http://loinc.org', name: 'LOINC', size: entries.length, hasZh: zh.size > 0, entries, ...buildIndex(entries), byCode: new Map(entries.map((e) => [e.code, e])) }
}

/** SNOMED CT RF2 description snapshot (active concepts' descriptions). */
export async function loadSnomed(descPath) {
  const by = new Map()
  for await (const r of readCsv(descPath, { delimiter: '\t', quote: '' })) {
    if (r.active !== '1') continue
    const c = by.get(r.conceptId) ?? { code: r.conceptId, fsn: '', syn: [] }
    if (r.typeId === '900000000000003001') c.fsn = r.term
    else c.syn.push(r.term)
    by.set(r.conceptId, c)
  }
  const entries = [...by.values()].map((c) => {
    const tag = /\(([^()]+)\)\s*$/.exec(c.fsn)?.[1] ?? ''
    const display = c.syn[0] ?? c.fsn.replace(/\s*\([^()]+\)\s*$/, '')
    return { code: c.code, display, fsn: c.fsn, semantic: tag, main: tokens(c.fsn.replace(/\s*\([^()]+\)\s*$/, '')), other: tokens(c.syn.join(' ')) }
  })
  return { system: 'http://snomed.info/sct', name: 'SNOMED CT', size: entries.length, entries, ...buildIndex(entries), byCode: new Map(entries.map((e) => [e.code, e])) }
}

/** Load all configured tables, keyed by system. */
export async function loadCodeTables(settings, warn) {
  const out = new Map()
  const ok = async (p) => { try { await stat(p); return true } catch { warn?.(`找不到代码表文件：${p}`); return false } }
  if (settings.loincTable && await ok(settings.loincTable)) {
    try { const t = await loadLoinc(settings.loincTable, settings.loincZhTable && await ok(settings.loincZhTable) ? settings.loincZhTable : null); out.set(t.system, t) } catch (e) { warn?.(`读不了 LOINC 代码表：${e.message}`) }
  }
  if (settings.snomedTable && await ok(settings.snomedTable)) {
    try { const t = await loadSnomed(settings.snomedTable); out.set(t.system, t) } catch (e) { warn?.(`读不了 SNOMED CT 代码表：${e.message}`) }
  }
  return out
}

/** Property (LOINC) implied by a unit: helps tell mass from molar concentration, counts from fractions. */
export function propertyFromUnit(unit) {
  const u = String(unit ?? '').toLowerCase().replace(/μ|µ/g, 'u')
  if (!u) return null
  if (/^(mmol|umol|nmol|pmol|mol)\/(l|dl|ml)$/.test(u)) return 'SCnc'
  if (/^(g|mg|ug|ng|pg)\/(l|dl|ml)$/.test(u)) return 'MCnc'
  if (/^(u|iu|miu|uiu|ku|kiu)\/(l|ml)$/.test(u) || /\[iu\]/.test(u)) return 'CCnc'
  if (/10[\^*](9|12)\/l|\/ul|个\/ul/.test(u)) return 'NCnc'
  if (u === '%') return 'NFr'
  if (/^(s|秒|sec)$/.test(u)) return 'Time'
  if (u === 'fl') return 'EntVol'
  if (u === 'pg') return 'EntMass'
  if (/ml\/min/.test(u)) return 'VRat'
  return null
}

/**
 * Candidates for one query.
 * @param q { terms:[...], local:"本地名称", system?, property?, scale?, semantic?, unit? }
 */
export function search(table, q, limit = 12) {
  const qMain = [...new Set([...tokens((q.terms ?? []).join(' ')), ...tokens(q.local ?? '')])]
  if (!qMain.length) return []
  const scores = new Map()
  for (const t of qMain) {
    const hits = table.index.get(t)
    if (!hits || (table.entries.length > 1000 && hits.length > table.entries.length * 0.2)) continue
    const w = table.idf(t)
    for (const i of hits) {
      const e = table.entries[i]
      scores.set(i, (scores.get(i) ?? 0) + (e.main.includes(t) ? 2 * w : w))
    }
  }
  const prop = q.property ?? propertyFromUnit(q.unit)
  const ranked = [...scores.entries()].map(([i, s]) => {
    const e = table.entries[i]
    let score = s
    // 组分里多出来的词扣分：越“正好是这个东西”越靠前
    const extra = e.main.filter((t) => !qMain.includes(t)).length
    score -= extra * 0.3
    if (q.system && e.system && e.system.toLowerCase() === String(q.system).toLowerCase()) score += 3
    else if (q.system && e.system && e.system.toLowerCase().includes(String(q.system).toLowerCase().split('/')[0])) score += 1.5
    if (prop && e.property === prop) score += 2.5
    if (q.scale && e.scale === q.scale) score += 1
    if (q.semantic && e.semantic === q.semantic) score += 2
    if (e.rank) score += 1.5 / (1 + Math.log10(e.rank))
    return { e, score }
  }).sort((a, b) => b.score - a.score).slice(0, limit)
  return ranked.map(({ e }) => ({ code: e.code, display: e.display, ...(e.zh ? { zh: e.zh } : {}), ...(e.component ? { component: e.component, system: e.system, property: e.property, scale: e.scale, method: e.method || undefined, units: e.units || undefined } : {}), ...(e.semantic ? { semantic: e.semantic } : {}) }))
}
