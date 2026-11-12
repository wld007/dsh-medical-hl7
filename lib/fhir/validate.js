/**
 * 内置校验（每个资源都跑；官方 HL7 Validator 另作抽检）：
 *   - 结构：id 格式、各资源必填元素、取值二选一（value[x]/dataAbsentReason）、扩展格式、空元素
 *   - 数据类型：date / dateTime / instant 的正则，code 不含首尾空白
 *   - 约束：Period 起止顺序、Condition con-5 等
 *   - 引用完整性：字面引用 "Type/id" 必须能在本病人的 Bundle 里找到
 */
const ID = /^[A-Za-z0-9\-.]{1,64}$/
const DATE = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?$/
const DATETIME = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/
const INSTANT = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/
const CODE = /^[^\s]+( [^\s]+)*$/

const DATE_KEYS = new Set(['birthDate'])
const INSTANT_KEYS = new Set(['issued', 'lastUpdated'])
const DATETIME_KEYS = new Set(['effectiveDateTime', 'recordedDate', 'onsetDateTime', 'performedDateTime', 'occurrenceDateTime', 'deceasedDateTime', 'valueDateTime', 'authoredOn', 'creation', 'start', 'end'])

const REQUIRED = {
  Encounter: ['status', 'class'],
  Condition: ['subject'],
  Observation: ['status', 'code'],
  DiagnosticReport: ['status', 'code'],
  Procedure: ['status', 'subject'],
  DocumentReference: ['status', 'content'],
  ChargeItem: ['status', 'code', 'subject'],
  MedicationRequest: ['status', 'intent', 'subject'],
  Basic: ['code'],
}

function walk(node, path, visit) {
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`, visit)); return }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { visit(k, v, `${path}.${k}`, node); walk(v, `${path}.${k}`, visit) }
  }
}

/**
 * @param resources one patient's resources (shared Organization/Practitioner included)
 * @returns { errors: [{ type, id, path, message }], warnings: [...], counts }
 */
export function validateResources(resources) {
  const errors = []; const warnings = []
  const have = new Set(resources.map((r) => `${r.resourceType}/${r.id}`))
  const err = (r, path, message) => { if (errors.length < 2000) errors.push({ type: r.resourceType, id: r.id, path, message }) }
  const warn = (r, path, message) => { if (warnings.length < 2000) warnings.push({ type: r.resourceType, id: r.id, path, message }) }
  let refs = 0; let logicalRefs = 0
  for (const r of resources) {
    if (!r.resourceType) { err(r, '', '缺少 resourceType'); continue }
    if (!ID.test(r.id ?? '')) err(r, 'id', `id 不合规：${r.id}`)
    for (const k of REQUIRED[r.resourceType] ?? []) if (r[k] === undefined) err(r, k, `缺少必填元素 ${k}`)
    if (r.resourceType === 'Observation') {
      const values = Object.keys(r).filter((k) => k.startsWith('value'))
      if (values.length > 1) err(r, 'value[x]', '多个 value[x]')
      if (values.length && r.dataAbsentReason) err(r, 'dataAbsentReason', 'obs-6：有值时不能有 dataAbsentReason')
      if (!values.length && !r.dataAbsentReason && !r.component && !r.hasMember) warn(r, 'value[x]', '没有值也没有 dataAbsentReason')
    }
    if (r.resourceType === 'Condition' && r.verificationStatus?.coding?.[0]?.code === 'entered-in-error' && r.clinicalStatus) err(r, 'clinicalStatus', 'con-5')
    if (r.resourceType === 'MedicationRequest' && !r.medicationCodeableConcept && !r.medicationReference) err(r, 'medication[x]', '缺少 medication[x]')
    if (r.resourceType === 'Organization' && !r.name && !r.identifier) err(r, '', 'org-1：机构需要名称或标识')
    walk(r, r.resourceType, (k, v, path, parent) => {
      if (v === '' || v === null || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) err(r, path, '空元素')
      if (typeof v === 'string') {
        if (DATE_KEYS.has(k) && !DATE.test(v)) err(r, path, `date 格式不对：${v}`)
        if (INSTANT_KEYS.has(k) && !INSTANT.test(v)) err(r, path, `instant 格式不对：${v}`)
        if (DATETIME_KEYS.has(k) && !DATETIME.test(v)) err(r, path, `dateTime 格式不对：${v}`)
        if (k === 'code' && !CODE.test(v)) err(r, path, `code 含首尾或连续空白：${JSON.stringify(v)}`)
        if (k !== 'data' && v !== v.trim()) warn(r, path, '字符串有首尾空白')
        if (k === 'reference') {
          refs++
          if (/^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/.test(v)) { if (!have.has(v)) err(r, path, `引用找不到：${v}`) } else err(r, path, `引用格式不对：${v}`)
        }
      }
      if (k === 'identifier' && parent && 'type' in parent && !Array.isArray(v) && !('reference' in parent)) logicalRefs++
      if ((k === 'period' || k === 'performedPeriod' || k === 'validityPeriod') && v?.start && v?.end && v.end < v.start) err(r, path, 'per-1：结束早于开始')
      if (k === 'extension' && Array.isArray(v)) {
        for (const [i, e] of v.entries()) {
          if (!e?.url) err(r, `${path}[${i}]`, '扩展缺少 url')
          const hasValue = Object.keys(e ?? {}).some((x) => x.startsWith('value'))
          if (hasValue === Boolean(e?.extension)) err(r, `${path}[${i}]`, 'ext-1：扩展要么有值要么有子扩展')
        }
      }
    })
  }
  return { errors, warnings, counts: { resources: resources.length, references: refs, logicalReferences: logicalRefs } }
}
