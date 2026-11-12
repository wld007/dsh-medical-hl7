/**
 * 没有现成规格的表：按字段名和取值自动起草一份规格。
 *
 * 只推断“与数据源无关”的公共角色（病人、机构、医务人员、就诊号、记录时间），
 * 表本身按 generic（Basic）保留全部字段，并给出建议的 kind 供人工确认后写成正式规格。
 * 主要信号是匿名化插件留下的假名前缀，它们在任何数据源里都一样。
 */
import { basename, extname } from 'node:path'
import { isBlank, parseTime, stableId } from '../fhir/datatypes.js'

const PSEUDO = /^(证件|医院|医生|化名|就诊|住院|病历|地址|电话|社保|银行卡)-[0-9A-F]{6}$/

function prefixOf(v) {
  const m = PSEUDO.exec(String(v).trim())
  return m ? m[1] : null
}

/** Profile the fields of a sample of rows. */
export function profileFields(rows, limit = 500) {
  const sample = rows.slice(0, limit)
  const fields = new Map()
  for (const row of sample) {
    for (const [k, v] of Object.entries(row)) {
      const f = fields.get(k) ?? { name: k, n: 0, filled: 0, prefixes: {}, times: 0, numbers: 0, len: 0, examples: [] }
      f.n++
      if (!isBlank(v)) {
        f.filled++
        const p = prefixOf(v); if (p) f.prefixes[p] = (f.prefixes[p] ?? 0) + 1
        if (parseTime(v)) f.times++
        if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v).trim())) f.numbers++
        f.len += String(v).length
        if (f.examples.length < 3 && !p) f.examples.push(String(v).slice(0, 20))
      }
      fields.set(k, f)
    }
  }
  return [...fields.values()].map((f) => ({ ...f, dominant: Object.entries(f.prefixes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, avgLen: f.filled ? f.len / f.filled : 0 }))
}

const stem = (name) => name.replace(/_?(CD|CODE|NM|NAME|SGNT|ID|NO)$/i, '')
const isCodeName = (n) => /(_|^)(CD|CODE|ID)$/i.test(n)

const KIND_HINTS = [
  ['lab', /TEST|LIS|LAB|RSLT|检验|化验/i],
  ['imaging', /EXAM|RIS|PACS|IMG|检查|影像/i],
  ['condition', /DIAG|ICD|诊断/i],
  ['procedure', /OPRT|OPER|SURG|手术/i],
  ['medication', /DRUG|MED|PRSCR|ORDER|医嘱|处方|用药/i],
  ['charge', /FEE|CHRG|COST|费用|结算/i],
  ['encounter', /VST|VISIT|REG|ADMN|挂号|就诊|入出院/i],
  ['death', /DTH|DEATH|死亡/i],
  ['document', /MDC_HTR|EMR|NOTE|病历|记录|小结|病程/i],
]

/**
 * Draft a spec for an unknown table.
 * @returns spec with kind 'generic', `inferred: true`, `suggestedKind`, and `reasons`.
 */
export function inferSpec(file, rows) {
  const base = basename(file, extname(file))
  const fields = profileFields(rows)
  const roles = {}
  const reasons = []
  const take = (role, f, why) => { if (!roles[role]) { roles[role] = f; reasons.push(`${f} → ${role}（${why}）`) } }
  const byPrefix = (p) => fields.filter((f) => f.dominant === p && f.prefixes[p] >= f.filled * 0.8)

  // 病人：证件号假名；没有时按字段名找身份证号
  const idf = byPrefix('证件').sort((a, b) => b.filled - a.filled)[0] ?? fields.find((f) => /ID_?CRD|IDCARD|SFZ|身份证|WS02_01_030_01/i.test(f.name))
  if (idf) take('patient.id', idf.name, idf.dominant ? '取值是证件号假名' : '字段名像身份证号')
  const nm = byPrefix('化名')[0]; if (nm) take('patient.name', nm.name, '取值是姓名假名')
  const tel = byPrefix('电话')[0]; if (tel) take('patient.telecom', tel.name, '取值是电话假名')
  for (const f of byPrefix('就诊')) take('encounter.outpatientNo', f.name, '取值是就诊号假名')
  for (const f of byPrefix('住院')) take('encounter.inpatientNo', f.name, '取值是住院号假名')
  // 机构：代码/名称成对
  const orgs = byPrefix('医院')
  for (const f of orgs) take(isCodeName(f.name) ? 'org.code' : 'org.name', f.name, '取值是医院假名')
  // 医务人员：按字段名词干配对，职能统一记为 other
  const docs = byPrefix('医生')
  const stems = new Map()
  for (const f of docs) { const s = stem(f.name); stems.set(s, [...(stems.get(s) ?? []), f]) }
  let i = 0
  for (const [, fs] of stems) {
    if (i++ >= 1) break // Basic 只挂一位作者；其余医生字段原样保留在 source-field
    for (const f of fs) take(`actor.other.${isCodeName(f.name) ? 'code' : 'name'}`, f.name, '取值是医生假名')
  }
  // 记录时间：最像时间、名字像“创建/记录时间”的字段
  const timeFields = fields.filter((f) => f.filled && f.times >= f.filled * 0.9)
  const tf = timeFields.find((f) => /CRT|RCD|RECORD|CREATE|TIME|DT/i.test(f.name)) ?? timeFields[0]
  if (tf) take('time.recorded', tf.name, '取值是时间')
  const key = ['PRM_KEY', '_id', 'ID', 'id'].find((k) => fields.some((f) => f.name === k && f.filled === f.n))
  const hay = `${base} ${fields.map((f) => f.name).join(' ')}`
  const scored = KIND_HINTS.map(([k, re]) => [k, (hay.match(new RegExp(re.source, 'gi')) ?? []).length]).sort((a, b) => b[1] - a[1])
  const suggestedKind = scored[0][1] > 0 ? scored[0][0] : null
  return {
    id: `auto-${base.replace(/[^A-Za-z0-9_-]+/g, '') || stableId(base).slice(0, 8)}`,
    name: base,
    match: { file: basename(file) },
    kind: 'generic',
    key: key ? [key] : [],
    roles,
    inferred: true,
    suggestedKind,
    reasons,
    fields: fields.map((f) => ({ name: f.name, fill: f.n ? Math.round((100 * f.filled) / f.n) : 0, pseudonym: f.dominant, time: f.filled > 0 && f.times >= f.filled * 0.9 })),
  }
}
