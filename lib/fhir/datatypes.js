/**
 * 源数据取值 → FHIR 基本数据类型。
 *
 * 数据源格式不统一：毫秒时间戳、秒时间戳、"YYYY-MM-DD HH:mm:ss"、"YYYYMMDD"、
 * "YYYYMMDDHHmmss"、"YYYY/MM/DD" 都见过。这里只做格式转换，不改值：
 * 没有时区的本地时间按设置里的时区（默认 +08:00）标注。
 */
import { createHash } from 'node:crypto'

const pad = (n, w = 2) => String(n).padStart(w, '0')

export function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'string' && /^(null|NULL|None)$/.test(v.trim()))
}

export function str(v) {
  if (isBlank(v)) return undefined
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).trim()
}

/** Offset string like "+08:00" → minutes. */
export function offsetMinutes(tz = '+08:00') {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz)
  if (!m) return 480
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

function fromEpoch(ms, tz) {
  const off = offsetMinutes(tz)
  const d = new Date(ms + off * 60000)
  if (Number.isNaN(d.getTime())) return undefined
  const y = d.getUTCFullYear()
  if (y < 1800 || y > 2200) return undefined
  return `${pad(y, 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tz}`
}

function validYMD(y, m, d) {
  const yy = Number(y); const mm = Number(m); const dd = Number(d)
  if (yy < 1800 || yy > 2200 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  const t = new Date(Date.UTC(yy, mm - 1, dd))
  return t.getUTCMonth() === mm - 1
}

/**
 * Parse any supported time value.
 * Returns { kind: 'date'|'dateTime', value } or undefined.
 * Numbers: |n| ≥ 1e11 → milliseconds, 1e8..1e11 → seconds (e.g. 1700000000),
 * 8-digit numbers are YYYYMMDD.
 */
export function parseTime(v, tz = '+08:00') {
  if (isBlank(v)) return undefined
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()))) {
    const s = String(v).trim()
    if (/^\d{8}$/.test(s)) {
      const [y, m, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)]
      if (validYMD(y, m, d)) return { kind: 'date', value: `${y}-${m}-${d}` }
    }
    if (/^\d{14}$/.test(s)) {
      const [y, m, d, H, M, S] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)]
      if (validYMD(y, m, d) && +H < 24 && +M < 60 && +S < 60) return { kind: 'dateTime', value: `${y}-${m}-${d}T${H}:${M}:${S}${tz}` }
    }
    if (/^\d{12}$/.test(s)) {
      const [y, m, d, H, M] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12)]
      if (validYMD(y, m, d) && +H < 24 && +M < 60) return { kind: 'dateTime', value: `${y}-${m}-${d}T${H}:${M}:00${tz}` }
    }
    const n = Number(s)
    if (Math.abs(n) >= 1e11) { const value = fromEpoch(n, tz); return value && { kind: 'dateTime', value } }
    if (Math.abs(n) >= 1e8 && Math.abs(n) < 1e11 && Number.isInteger(n)) { const value = fromEpoch(n * 1000, tz); return value && { kind: 'dateTime', value } }
    return undefined
  }
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (m) {
    const [, y, mo, d, H, M, S, z] = m
    if (!validYMD(y, mo, d)) return undefined
    const date = `${y}-${pad(mo)}-${pad(d)}`
    if (H === undefined) return { kind: 'date', value: date }
    if (+H > 23 || +M > 59 || +(S ?? 0) > 59) return undefined
    const zone = z ? (z === 'Z' ? 'Z' : z.includes(':') ? z : `${z.slice(0, 3)}:${z.slice(3)}`) : tz
    return { kind: 'dateTime', value: `${date}T${pad(H)}:${pad(M)}:${pad(S ?? 0)}${zone}` }
  }
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[时:](\d{1,2})分?)?$/.exec(s)
  if (m) {
    const [, y, mo, d, H, M] = m
    if (!validYMD(y, mo, d)) return undefined
    const date = `${y}-${pad(mo)}-${pad(d)}`
    if (H === undefined) return { kind: 'date', value: date }
    return { kind: 'dateTime', value: `${date}T${pad(H)}:${pad(M)}:00${tz}` }
  }
  return undefined
}

export const dateTime = (v, tz) => parseTime(v, tz)?.value
/** FHIR `date` (birthDate): truncates a dateTime to its local date. */
export const date = (v, tz) => parseTime(v, tz)?.value.slice(0, 10)
/** FHIR `instant` needs seconds and a zone: only from dateTime values. */
export function instant(v, tz) {
  const t = parseTime(v, tz)
  return t?.kind === 'dateTime' ? t.value : undefined
}

/**
 * Numeric results: "33.27", "<0.5", ">=10", "1.2E3".
 * Returns { value, comparator? } or undefined when the text is not a plain number.
 */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : undefined
  const s = str(v)
  if (!s) return undefined
  const m = /^(<=|>=|<|>|≤|≥)?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(s)
  if (!m) return undefined
  const cmp = { '≤': '<=', '≥': '>=' }[m[1]] ?? m[1]
  const value = Number(m[2])
  if (!Number.isFinite(value)) return undefined
  // Keep the source precision ("60.0" stays 60.0 when serialised by decimalOf)
  return cmp ? { value, comparator: cmp, text: m[2] } : { value, text: m[2] }
}

/** "2.86-8.2" / "<1.00" / "≥ 10" → FHIR referenceRange entry (text always kept). */
export function referenceRange(v, unit) {
  const text = str(v)
  if (!text) return undefined
  const out = { text }
  const q = (n) => ({ value: n, ...(unit ? { unit } : {}) })
  let m = /^\s*([+-]?\d+\.?\d*)\s*(?:-|~|～|—|－|–)\s*([+-]?\d+\.?\d*)\s*$/.exec(text)
  if (m) { out.low = q(Number(m[1])); out.high = q(Number(m[2])); return out }
  m = /^\s*(<|<=|≤)\s*([+-]?\d+\.?\d*)\s*$/.exec(text)
  if (m) { out.high = q(Number(m[2])); return out }
  m = /^\s*(>|>=|≥)\s*([+-]?\d+\.?\d*)\s*$/.exec(text)
  if (m) { out.low = q(Number(m[2])); return out }
  return out
}

/** Stable FHIR id: 32 hex chars from the given parts. */
export function stableId(...parts) {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0001')).digest('hex').slice(0, 32)
}

/** Short ascii token for use inside URIs (e.g. scoping a local code system to one organisation). */
export function token(v) {
  return createHash('sha256').update(String(v)).digest('hex').slice(0, 10)
}

/** UCUM codes for units that appear in Chinese lab exports; anything else is kept as display text only. */
const UCUM = {
  'mmol/L': 'mmol/L', 'mmol/l': 'mmol/L', 'umol/L': 'umol/L', 'μmol/L': 'umol/L', 'µmol/L': 'umol/L', 'umol/l': 'umol/L',
  'mg/L': 'mg/L', 'mg/l': 'mg/L', 'g/L': 'g/L', 'g/l': 'g/L', 'mg/dL': 'mg/dL', 'ng/mL': 'ng/mL', 'ng/ml': 'ng/mL', 'pg/mL': 'pg/mL', 'pg/ml': 'pg/mL',
  'U/L': 'U/L', 'u/L': 'U/L', 'IU/L': '[IU]/L', 'IU/mL': '[IU]/mL', 'mIU/mL': 'm[IU]/mL', 'uIU/mL': 'u[IU]/mL', 'μIU/mL': 'u[IU]/mL',
  '%': '%', 'fL': 'fL', 'fl': 'fL', 'pg': 'pg', 's': 's', '秒': 's', 'sec': 's',
  '10^9/L': '10*9/L', '10*9/L': '10*9/L', '×10^9/L': '10*9/L', 'x10^9/L': '10*9/L', '10^12/L': '10*12/L', '×10^12/L': '10*12/L', 'x10^12/L': '10*12/L',
  'mmHg': 'mm[Hg]', 'cm': 'cm', 'kg': 'kg', 'kg/m2': 'kg/m2', 'kg/m²': 'kg/m2', '℃': 'Cel', '°C': 'Cel', '次/分': '/min', 'bpm': '/min',
  'ml/min': 'mL/min', 'mL/min': 'mL/min', 'mL/min/1.73m2': 'mL/min/{1.73_m2}', 'ml/min/1.73m2': 'mL/min/{1.73_m2}', 'mm/h': 'mm/h', 'g/dL': 'g/dL',
}

export function quantity(num, unit) {
  const q = { value: num.value }
  if (num.comparator) q.comparator = num.comparator
  const u = str(unit)
  if (u) {
    q.unit = u
    const code = UCUM[u]
    if (code) { q.system = 'http://unitsofmeasure.org'; q.code = code }
  }
  return q
}

export function base64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64')
}

/** Remove undefined / empty arrays / empty objects recursively (FHIR forbids empty elements). */
export function clean(x) {
  if (Array.isArray(x)) {
    const a = x.map(clean).filter((v) => v !== undefined)
    return a.length ? a : undefined
  }
  if (x && typeof x === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(x)) {
      const c = clean(v)
      if (c !== undefined) o[k] = c
    }
    return Object.keys(o).length ? o : undefined
  }
  if (x === null || x === undefined || x === '') return undefined
  if (typeof x === 'number' && !Number.isFinite(x)) return undefined
  return x
}
