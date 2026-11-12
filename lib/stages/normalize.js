/**
 * ② 值域归一：同构记录里的每个取值，按它绑定的值域翻成规范值。原值始终保留。
 *
 * 两类值域：
 *   格式类（代码实现）：datetime、datetime-text、decimal、ref-range、lab-value、icd10、icd9cm3、code-format
 *   枚举类（数据文件 vocab/domains/**.json）：性别、婚姻、单位、定性结果、就诊类型……
 *
 * 每个取值的结果：{ domain, raw, display?, value?, status, note? }
 *   status：normalized 已归一 ｜ text 按原文保留（有意不归一）｜ pending 待确认 ｜ unmapped 无对照 ｜ invalid 不属于本值域 / 无法解析
 * 只有 normalized 的 value 会被 FHIR 组装当成规范值使用；其余一律用原值。
 */
import { parseTime, parseNumber, referenceRange, str, halfWidth } from '../fhir/datatypes.js'
import { lookupEntry } from './vocab.js'

/** 格式类值域（不需要对照表）。 */
export const FORMAT_DOMAINS = {
  datetime: { name: '时间', description: '各种时间写法 → ISO 8601（无时区按设置时区）' },
  'datetime-text': { name: '文字中的时间', description: '从“记录时间：2025-03-12 10:04:54”这类文字里取出时间' },
  decimal: { name: '数值', description: '数字（含比较符 < > ≤ ≥、全角写法）' },
  'ref-range': { name: '参考范围', description: '“2.86-8.2”“<1.00”等 → 下限/上限；其余保留文字' },
  'lab-value': { name: '检验结果值', description: '数值结果 → 数值；非数值结果交给“定性结果”值域' },
  icd10: { name: 'ICD-10 代码', description: '诊断代码清洗：拆剑号星号组合、识别中医病证/证候代码、剔除脏值' },
  icd9cm3: { name: '手术操作代码', description: '识别 ICD-9-CM-3 国家临床版代码，其余为机构内代码' },
  'code-format': { name: '代码格式', description: 'FHIR 代码不能含换行、制表符或连续空格' },
}

/** 默认值域绑定：格式类按角色，枚举类按“概念”（代码角色 + 名称角色）。表规格的 domains 可以覆盖。 */
function formatDomainOf(kind, role) {
  if (/^(time|record)\./.test(role) || role === 'patient.birthDate' || role === 'birthDate') return 'datetime'
  if (kind === 'lab' && role === 'value') return 'lab-value'
  if (role === 'refRange') return 'ref-range'
  if (['quantity', 'unitPrice', 'total', 'dose.value', 'order'].includes(role)) return role === 'order' ? null : 'decimal'
  if ((kind === 'condition' && role === 'code.code') || (kind === 'death' && role === 'cause.code') || (kind === 'procedure' && role === 'reason.code')) return 'icd10'
  if (kind === 'procedure' && role === 'code.code') return 'icd9cm3'
  // 机构、科室、医务人员、病人的“代码”是标识，不是值域代码
  if (/(\.code|\.stdCode|^code\.local)$/.test(role) && !/^(org|dept|actor\.[a-z]+|patient\.[a-zA-Z.]+)\.code$/.test(role)) return 'code-format'
  return null
}
const DEFAULT_CONCEPTS = {
  '*': { 'patient.gender': 'gender' },
  patient: { gender: 'gender', maritalStatus: 'marital' },
  encounter: { maritalStatus: 'marital', 'emergency.flag': 'yes-no', 'firstVisit.flag': 'yes-no' },
  condition: { 'tcm.flag': 'yes-no' },
  lab: { unit: 'ucum-unit' },
  imaging: { modality: 'dicom-modality' },
  medication: { 'dose.unit': 'ucum-unit', 'quantity.unit': 'ucum-unit' },
}

/** Resolve the bindings of one table spec (cached on the spec). */
export function bindingsOf(spec) {
  if (spec._bindings) return spec._bindings
  const roles = Object.keys(spec.roles ?? {})
  const formats = {}
  for (const r of roles) { const d = spec.domains?.[r] && FORMAT_DOMAINS[spec.domains[r]] ? spec.domains[r] : formatDomainOf(spec.kind, r); if (d) formats[r] = d }
  const concepts = {}
  const declared = { ...DEFAULT_CONCEPTS['*'], ...(DEFAULT_CONCEPTS[spec.kind] ?? {}), ...Object.fromEntries(Object.entries(spec.domains ?? {}).filter(([, d]) => !FORMAT_DOMAINS[d])) }
  for (const [name, domain] of Object.entries(declared)) {
    const codeRole = roles.includes(name) ? name : roles.includes(`${name}.code`) ? `${name}.code` : undefined
    const displayRole = roles.includes(`${name}.display`) ? `${name}.display` : undefined
    if (!codeRole && !displayRole) continue
    concepts[name] = { domain, codeRole, displayRole }
    // 枚举概念的代码角色不再做代码格式检查（由值域负责）
    if (codeRole) delete formats[codeRole]
  }
  const items = (spec.items ?? []).map((it) => (it.domain ? { domain: it.domain } : it.coded ? null : it.measure || !it.asString ? { domain: 'decimal' } : null))
  Object.defineProperty(spec, '_bindings', { value: { formats, concepts, items }, enumerable: false })
  return spec._bindings
}

/* ------------------------------------------------------------ format */
const TIME_PATTERNS = [
  [/^-?\d{11,}$/, '毫秒时间戳'], [/^\d{9,10}$/, '秒时间戳'], [/^\d{8}$/, 'YYYYMMDD'], [/^\d{14}$/, 'YYYYMMDDHHmmss'], [/^\d{12}$/, 'YYYYMMDDHHmm'],
  [/^\d{4}-\d{1,2}-\d{1,2}$/, 'YYYY-MM-DD'], [/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{1,2}:\d{1,2}(\.\d+)?$/, 'YYYY-MM-DD HH:mm:ss'], [/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{1,2}$/, 'YYYY-MM-DD HH:mm'],
  [/^\d{4}\/\d{1,2}\/\d{1,2}/, 'YYYY/MM/DD'], [/^\d{4}年/, 'YYYY年MM月DD日'], [/[zZ]|[+-]\d{2}:?\d{2}$/, '带时区'],
]
const timePattern = (v) => { const s = String(v).trim(); return TIME_PATTERNS.find(([re]) => re.test(s))?.[1] ?? '其他' }

function formatValue(domain, raw, tz) {
  switch (domain) {
    case 'datetime': {
      const t = parseTime(raw, tz)
      return t ? { status: 'normalized', value: t, form: timePattern(raw) } : { status: 'invalid', form: timePattern(raw), note: '无法识别的时间' }
    }
    case 'datetime-text': {
      const m = /\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?/.exec(String(raw))
      const t = m && parseTime(m[0], tz)
      return t ? { status: 'normalized', value: t, form: '文字中的时间' } : { status: 'invalid', note: '文字里没有可识别的时间' }
    }
    case 'decimal': {
      const n = parseNumber(raw)
      return n ? { status: 'normalized', value: n, form: halfWidth(String(raw)) !== String(raw) ? '全角写法' : n.comparator ? '带比较符' : '数字' } : { status: 'invalid', note: '不是数字' }
    }
    case 'ref-range': {
      const r = referenceRange(raw)
      if (!r) return { status: 'invalid' }
      const form = r.low && r.high ? '区间' : r.high ? '上限（<x）' : r.low ? '下限（>x）' : '文字'
      return { status: r.low || r.high ? 'normalized' : 'text', value: r, form }
    }
    case 'icd10': return icd10(raw)
    case 'icd9cm3': {
      const s = str(raw)
      if (!s) return { status: 'invalid' }
      if (/^\d{2}\.\d{1,4}(x\d{3})?$/.test(s)) return { status: 'normalized', value: { system: 'icd-9-cm-3-cn', code: s }, form: 'ICD-9-CM-3 国家临床版' }
      if (/^[^\s]+( [^\s]+)*$/.test(s)) return { status: 'normalized', value: { system: 'local', code: s }, form: '机构内代码' }
      return { status: 'invalid', note: '代码含空白' }
    }
    case 'code-format': {
      const s = str(raw)
      return s && /^[^\s]+( [^\s]+)*$/.test(s) ? { status: 'normalized', value: s, form: '合规' } : { status: 'invalid', note: '代码含换行、制表符或连续空格', form: '含空白' }
    }
    default: return { status: 'unmapped' }
  }
}

/** 诊断代码清洗。 */
function icd10(raw) {
  const s = str(raw)
  if (!s) return { status: 'invalid' }
  const ICD = /^[A-Z]\d{2}(\.[0-9A-Za-z]{1,4}(x\d{3})?)?$/
  if (ICD.test(s)) return { status: 'normalized', value: { system: 'icd-10-cn', code: s }, form: /x\d{3}$/.test(s) ? '国家临床版扩展码' : 'ICD-10' }
  // 剑号星号组合：N18.900x012+D63.8*（+ 后为星号码）
  const m = /^([A-Z]\d{2}(?:\.[0-9A-Za-z]{1,4}(?:x\d{3})?)?)\s*[+†]\s*([A-Z]\d{2}(?:\.[0-9A-Za-z]{1,4}(?:x\d{3})?)?)\*?$/.exec(s)
  if (m) return { status: 'normalized', value: { system: 'icd-10-cn', code: m[1], asterisk: m[2] }, form: '剑号星号组合（已拆分）' }
  if (/^[A-Z]\d{2}\.[0-9A-Za-z]{1,4}\*$/.test(s)) return { status: 'normalized', value: { system: 'icd-10-cn', code: s.slice(0, -1), asteriskOnly: true }, form: '星号码' }
  // 只有剑号码、星号码缺失（源数据截断）：取剑号码
  const dag = /^([A-Z]\d{2}(?:\.[0-9A-Za-z]{1,4}(?:x\d{3})?)?)\s*[+†]$/.exec(s)
  if (dag) return { status: 'normalized', value: { system: 'icd-10-cn', code: dag[1] }, form: '剑号码（星号码缺失）', note: '源数据只有剑号码，星号码缺失' }
  // 中医：GB/T 15657-2021 带点分层代码（A 疾病、B 证候）；GB/T 15657-1995 字母代码（B 疾病、Z 证候）
  if (/^A\d{2}(\.\d{2})+\.?$/.test(s)) return { status: 'normalized', value: { system: 'tcm-disease', code: s.replace(/\.$/, '') }, form: '中医疾病代码（GB/T 15657-2021）' }
  if (/^B\d{2}(\.\d{2})+\.?$/.test(s)) return { status: 'normalized', value: { system: 'tcm-syndrome', code: s.replace(/\.$/, '') }, form: '中医证候代码（GB/T 15657-2021）' }
  if (/^B[A-Z]{2}\d{3}$/.test(s)) return { status: 'normalized', value: { system: 'tcm-disease', code: s }, form: '中医疾病代码（GB/T 15657-1995）' }
  if (/^Z[A-Z][A-Z0-9]{3,4}$/.test(s)) return { status: 'normalized', value: { system: 'tcm-syndrome', code: s }, form: '中医证候代码（GB/T 15657-1995）' }
  return { status: 'invalid', note: '不是可识别的诊断代码', form: '其他' }
}

/* -------------------------------------------------------------- engine */
export function createNormalizer({ vocab, timezone = '+08:00' }) {
  const stats = new Map() // domain → { total, byStatus, forms, values: Map }
  const MAX_VALUES = 2000

  function record(domainId, res, key, sample, where) {
    const s = stats.get(domainId) ?? { total: 0, byStatus: {}, forms: {}, values: new Map(), fields: {} }
    stats.set(domainId, s)
    s.total++
    s.byStatus[res.status] = (s.byStatus[res.status] ?? 0) + 1
    if (res.form) s.forms[res.form] = (s.forms[res.form] ?? 0) + 1
    s.fields[where] = (s.fields[where] ?? 0) + 1
    if (key === undefined) return
    let v = s.values.get(key)
    if (!v) {
      if (s.values.size >= MAX_VALUES) { s.truncated = (s.truncated ?? 0) + 1; return }
      v = { ...sample, status: res.status, to: res.to ?? null, note: res.note ?? null, count: 0, fields: {} }
      s.values.set(key, v)
    }
    v.count++
    v.fields[where] = (v.fields[where] ?? 0) + 1
  }

  function enumValue(domainId, code, display) {
    const d = vocab.domains.get(domainId)
    if (!d) return { status: 'unmapped', note: `值域 ${domainId} 未定义` }
    const e = lookupEntry(d, code, display)
    if (!e) return { status: 'unmapped' }
    if (e.status === 'confirmed') {
      const t = d.target?.values?.find((x) => x.code === e.to)
      return { status: 'normalized', to: e.to, value: { system: t?.system ?? d.target?.system, code: e.to, display: t?.display, label: t?.label ?? t?.display }, label: e.label ?? null, note: e.note ?? e.basis ?? null }
    }
    return { status: e.status === 'text' ? 'text' : e.status, to: null, label: e.label ?? null, note: e.note ?? null }
  }

  /** Normalize one harmonized record (with its table spec). */
  function normalize(h, spec) {
    const b = bindingsOf(spec)
    const where = (x) => `${h.table}.${x}`
    const values = {}
    for (const [role, domain] of Object.entries(b.formats)) {
      const v = h.roles[role]
      if (!v) continue
      // 检验结果值：数值归“数值”值域，非数值交给“定性结果”值域
      if (domain === 'lab-value') {
        const n = formatValue('decimal', v.raw, timezone)
        if (n.status === 'normalized') {
          values[role] = { domain: 'decimal', raw: v.raw, status: 'normalized', value: { type: 'quantity', ...n.value } }
          record('decimal', n, undefined, null, where(v.field))
          continue
        }
        const text = str(v.raw)
        const q = enumValue('qualitative-result', undefined, text)
        values[role] = { domain: 'qualitative-result', raw: v.raw, ...q, value: q.status === 'normalized' ? { type: 'coded', ...q.value } : { type: 'text' } }
        record('qualitative-result', q, `\u0001${text}`, { display: text }, where(v.field))
        continue
      }
      const res = formatValue(domain, v.raw, timezone)
      values[role] = { domain, raw: v.raw, ...res }
      // 格式类只登记不合格的原值（合格的太多），以及所有写法的计数
      record(domain, res, res.status === 'normalized' ? undefined : String(v.raw).slice(0, 60), { code: String(v.raw).slice(0, 60) }, where(v.field))
    }
    const concepts = {}
    for (const [name, c] of Object.entries(b.concepts)) {
      const code = c.codeRole ? h.roles[c.codeRole] : undefined
      const disp = c.displayRole ? h.roles[c.displayRole] : undefined
      if (!code && !disp) continue
      const cs = code ? str(code.raw) : undefined; const ds = disp ? str(disp.raw) : undefined
      const res = enumValue(c.domain, cs, ds)
      concepts[name] = { domain: c.domain, code: cs, display: ds, ...res }
      record(c.domain, res, `${cs ?? ''}\u0001${ds ?? ''}`, { code: cs, display: ds }, where((code ?? disp).field))
    }
    const items = h.items.map((it) => {
      const bind = b.items[it.index]
      const itSpec = spec.items[it.index]
      if (itSpec.timeField && it.timeRaw !== undefined) {
        const tr = formatValue('datetime-text', it.timeRaw, timezone)
        record('datetime-text', tr, tr.status === 'normalized' ? undefined : String(it.timeRaw).slice(0, 60), { code: String(it.timeRaw).slice(0, 60) }, where(itSpec.timeField))
        it = { ...it, time: tr.status === 'normalized' ? tr.value : undefined }
      }
      if (!bind) return { ...it, result: null }
      if (bind.domain === 'decimal') {
        if (it.raw === undefined) return { ...it, result: null }
        const res = formatValue('decimal', it.raw, timezone)
        record('decimal', res, res.status === 'normalized' ? undefined : String(it.raw).slice(0, 60), { code: String(it.raw).slice(0, 60) }, where(it.field))
        return { ...it, result: { domain: 'decimal', raw: it.raw, ...res } }
      }
      const cs = it.raw === undefined ? undefined : str(it.raw); const ds = it.display === undefined ? undefined : str(it.display)
      const res = enumValue(bind.domain, cs, ds)
      record(bind.domain, res, `${cs ?? ''}\u0001${ds ?? ''}`, { code: cs, display: ds }, where(it.field ?? it.displayField))
      return { ...it, result: { domain: bind.domain, code: cs, display: ds, ...res } }
    })
    return { ...h, items, values, concepts }
  }

  function summary() {
    const out = {}
    for (const [id, s] of stats) {
      const d = vocab.domains.get(id)
      const f = FORMAT_DOMAINS[id]
      const ok = (s.byStatus.normalized ?? 0) + (s.byStatus.text ?? 0)
      out[id] = {
        id, kind: f ? 'format' : 'enum', name: d?.name ?? f?.name ?? id, description: d?.description ?? f?.description ?? '', version: d?.version ?? null,
        target: d?.target ? { system: d.target.system, name: d.target.name, open: Boolean(d.target.open), values: d.target.values ?? [] } : null,
        total: s.total, byStatus: s.byStatus, coverage: s.total ? ok / s.total : 1, forms: s.forms, fields: s.fields, truncated: s.truncated ?? 0,
        values: [...s.values.values()].sort((a, b) => b.count - a.count),
      }
    }
    return out
  }
  return { normalize, summary, stats }
}

/** Merge per-patient domain summaries (for resumed runs). */
export function mergeDomainSummaries(a = {}, b = {}) {
  const out = structuredClone(a)
  for (const [id, s] of Object.entries(b)) {
    const t = out[id]
    if (!t) { out[id] = structuredClone(s); continue }
    t.total += s.total
    for (const [k, n] of Object.entries(s.byStatus)) t.byStatus[k] = (t.byStatus[k] ?? 0) + n
    for (const [k, n] of Object.entries(s.forms)) t.forms[k] = (t.forms[k] ?? 0) + n
    for (const [k, n] of Object.entries(s.fields)) t.fields[k] = (t.fields[k] ?? 0) + n
    const byKey = new Map(t.values.map((v) => [`${v.code ?? ''}\u0001${v.display ?? ''}`, v]))
    for (const v of s.values) { const k = `${v.code ?? ''}\u0001${v.display ?? ''}`; const x = byKey.get(k); if (x) { x.count += v.count; for (const [f, n] of Object.entries(v.fields)) x.fields[f] = (x.fields[f] ?? 0) + n } else byKey.set(k, structuredClone(v)) }
    t.values = [...byKey.values()].sort((x, y) => y.count - x.count)
    const ok = (t.byStatus.normalized ?? 0) + (t.byStatus.text ?? 0)
    t.coverage = t.total ? ok / t.total : 1
  }
  return out
}
