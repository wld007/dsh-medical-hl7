/**
 * 数据去向统计（概览主画面用）：
 *   flows  来源表 → FHIR 资源类型 的条数（组装时记录）
 *   slots  每类资源的“格子”：一个 FHIR 字段在多少资源里有值
 * 只有计数，没有取值。
 */
const has = (x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && x.length === 0)
const anyCoding = (cc, re, not = false) => (cc?.coding ?? []).some((c) => (not ? !re.test(c.system ?? '') : re.test(c.system ?? '')))
const LOCAL = /dsh\.local|\{ns\}|\/CodeSystem\/(?!.*(loinc|snomed))/
const STD = /loinc\.org|snomed\.info|unitsofmeasure|terminology\.hl7\.org|hl7\.org\/fhir|dicom/

/** [label, test]; labels short enough for a cell (≤ 4 汉字 / 6 字母). */
export const SLOT_DEFS = {
  Patient: [['性别', (r) => has(r.gender)], ['出生日期', (r) => has(r.birthDate)], ['婚姻', (r) => has(r.maritalStatus?.coding)], ['地址', (r) => has(r.address)], ['电话', (r) => has(r.telecom)]],
  Encounter: [['就诊号', (r) => has(r.identifier)], ['类别', (r) => has(r.class)], ['时间', (r) => has(r.period?.start)], ['科室', (r) => has(r.serviceProvider)], ['诊断', (r) => has(r.diagnosis)], ['有登记', (r) => r.status !== 'unknown']],
  Condition: [['ICD-10', (r) => anyCoding(r.code, /icd-10/)], ['名称', (r) => has(r.code?.text)], ['就诊', (r) => has(r.encounter)], ['时间', (r) => has(r.recordedDate ?? r.onsetDateTime)], ['SNOMED', (r) => anyCoding(r.code, /snomed/)]],
  Observation: [['本地代码', (r) => anyCoding(r.code, STD, true)], ['标准编码', (r) => anyCoding(r.code, /loinc|snomed/)], ['结果值', (r) => has(r.valueQuantity) || has(r.valueString) || has(r.valueCodeableConcept) || r.valueBoolean !== undefined || has(r.component)], ['UCUM', (r) => has(r.valueQuantity?.code) || (r.component ?? []).some((c) => has(c.valueQuantity?.code))], ['参考范围', (r) => has(r.referenceRange)], ['异常解释', (r) => has(r.interpretation)]],
  DiagnosticReport: [['项目', (r) => has(r.code?.coding)], ['标准编码', (r) => anyCoding(r.code, /loinc/)], ['结果', (r) => has(r.result) || has(r.conclusion)], ['时间', (r) => has(r.effectiveDateTime)], ['报告原文', (r) => has(r.presentedForm) || has(r.conclusion)]],
  Specimen: [['标本', (r) => has(r.type?.coding)], ['标准编码', (r) => anyCoding(r.type, /snomed/)]],
  Procedure: [['手术代码', (r) => has(r.code?.coding)], ['时间', (r) => has(r.performedPeriod) || has(r.performedDateTime)], ['术者', (r) => has(r.performer)], ['就诊', (r) => has(r.encounter)]],
  MedicationRequest: [['药品', (r) => has(r.medicationCodeableConcept?.coding) || has(r.medicationCodeableConcept?.text)], ['标准编码', (r) => anyCoding(r.medicationCodeableConcept, LOCAL, true)], ['剂量', (r) => has(r.dosageInstruction?.[0]?.doseAndRate)], ['频次', (r) => has(r.dosageInstruction?.[0]?.timing)], ['途径', (r) => has(r.dosageInstruction?.[0]?.route)], ['就诊', (r) => has(r.encounter)]],
  DocumentReference: [['类型', (r) => has(r.type)], ['标准类型', (r) => anyCoding(r.type, /loinc/)], ['正文', (r) => has(r.content)], ['时间', (r) => has(r.date) || has(r.content?.[0]?.attachment?.creation)], ['就诊', (r) => has(r.context?.encounter)]],
  ChargeItem: [['项目', (r) => has(r.code?.coding)], ['标准编码', (r) => anyCoding(r.code, LOCAL, true)], ['数量', (r) => has(r.quantity)], ['金额', (r) => (r.extension ?? []).some((e) => /price/.test(e.url))], ['时间', (r) => has(r.occurrenceDateTime)]],
}

export const SLOT_NAMES = Object.fromEntries(Object.entries(SLOT_DEFS).map(([t, d]) => [t, d.map(([n]) => n)]))

/** Slot counts for one patient's resources: { Type: { n, v:[...] } }. */
export function slotCounts(resources) {
  const out = {}
  for (const r of resources) {
    const def = SLOT_DEFS[r.resourceType]
    if (!def) continue
    const s = (out[r.resourceType] ??= { n: 0, v: def.map(() => 0) })
    s.n++
    def.forEach(([, test], i) => { try { if (test(r)) s.v[i]++ } catch { /* skip */ } })
  }
  return out
}

/** Merge one patient's statistics into the run-level flow record. */
export function mergeFlow(flow, { flows = {}, tables = {}, slots = {} }) {
  const f = flow ?? { flows: {}, tables: {}, slots: {}, slotNames: SLOT_NAMES }
  for (const [k, n] of Object.entries(flows)) f.flows[k] = (f.flows[k] ?? 0) + n
  Object.assign(f.tables, tables)
  for (const [t, s] of Object.entries(slots)) {
    const x = (f.slots[t] ??= { n: 0, v: s.v.map(() => 0) })
    x.n += s.n
    s.v.forEach((n, i) => { x.v[i] = (x.v[i] ?? 0) + n })
  }
  f.slotNames = SLOT_NAMES
  return f
}
