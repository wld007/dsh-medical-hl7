/**
 * 语义角色词表：映射规格（profile）把源字段指派给这些角色，构建器只认角色，不认字段名。
 * 新数据源只需要写（或自动推断）一份规格，不改代码。
 *
 * 规格里一张表的写法（全部是数据，可以 JSON 序列化，便于人改、模型起草）：
 * {
 *   id: 'lab',                          // 表编号（稳定，进资源标识）
 *   match: { file: 'p_doc_fact_test_rcd.json' } | { fileRe: '检验报告' } | { fields: ['A','B'] },
 *   kind: 'lab',                        // 见 KINDS
 *   key: ['PRM_KEY'],                   // 源记录主键（可多字段）；缺省用整行内容的哈希
 *   roles: { 'item.code': 'TEST_CHD_ITM_CD', 'time.effective': ['TEST_DT', 'CRT_TM'], … },
 *                                       // 值可为字段或字段列表（取第一个有值的）
 *   domains: { 'encounter.setting': 'regional-platform/visit-type' },
 *                                       // 角色 → 值域（vocab/domains/）；不写时用默认绑定（时间、单位、性别……）
 *   invalid: { field: 'INVLD_FLG', values: ['1'] },   // 作废标记
 *   items: [ … ],                       // kind=observation：每个字段生成一条 Observation
 *   sections: [['CHF_COMPLNT', '主诉'], …],           // kind=document：拼成正文的字段与栏目名
 *   document: { code: 'outpatient-note', display: '门诊病历', loinc: '34108-1' },
 *   addressUse: 'home', addressKind: '现住址',         // kind=address
 *   codeSystems: { item: { name: 'lab-item', scope: 'org' } },  // 本地代码体系命名
 * }
 */

/** 每种记录对应的 FHIR 资源。 */
export const KINDS = {
  patient: '人口学信息 → Patient',
  address: '地址 → Patient.address',
  encounter: '就诊 → Encounter',
  condition: '诊断 → Condition',
  lab: '检验结果 → Observation（按报告号归并为 DiagnosticReport）',
  imaging: '检查报告 → DiagnosticReport',
  procedure: '手术操作 → Procedure',
  document: '病历文书 → DocumentReference',
  observation: '测量与问卷 → Observation（每个指定字段一条）',
  medication: '用药/医嘱 → MedicationRequest',
  charge: '费用明细 → ChargeItem',
  death: '死亡信息 → Patient.deceased + Observation（死因）',
  generic: '未识别 → Basic（全部字段无损保留）',
}

/** 所有表都可用的角色。 */
export const COMMON_ROLES = [
  'patient.id', 'patient.localId', 'patient.card', 'patient.name', 'patient.gender.code', 'patient.gender.display', 'patient.birthDate', 'patient.telecom',
  'org.code', 'org.name',
  'encounter.outpatientNo', 'encounter.inpatientNo', 'encounter.setting', 'encounter.setting.display',
  'record.created', 'record.updated',
  'dept.code', 'dept.name',
]

/** actor.<职能>.code / actor.<职能>.name：医务人员（代码与姓名成对）。 */
export const ACTOR_FUNCTIONS = ['author', 'performer', 'requester', 'verifier', 'attender', 'admitter', 'surgeon', 'assistant', 'anesthetist', 'collector', 'recorder', 'updater', 'other']

export const KIND_ROLES = {
  patient: ['name', 'gender.code', 'gender.display', 'birthDate', 'telecom', 'maritalStatus.code', 'maritalStatus.display', 'idType.code', 'idType.display', 'time.recorded'],
  address: ['address.text', 'address.province.code', 'address.province.name', 'address.city.code', 'address.city.name', 'address.county.code', 'address.county.name', 'address.town.code', 'address.town.name', 'address.village.code', 'address.village.name', 'address.unit', 'address.house', 'address.postalCode', 'time.recorded', 'source.name'],
  encounter: ['time.start', 'time.end', 'reason.text', 'dischargeDisposition.code', 'dischargeDisposition.display', 'location.ward', 'location.bed', 'emergency.flag', 'firstVisit.flag', 'maritalStatus.code', 'maritalStatus.display'],
  condition: ['code.code', 'code.display', 'code.local', 'text', 'time.recorded', 'time.onset', 'category.code', 'category.display', 'main.flag', 'tcm.flag', 'tcm.code', 'tcm.display', 'order', 'note'],
  lab: ['report.no', 'panel.code', 'panel.display', 'item.code', 'item.display', 'item.stdCode', 'item.stdDisplay', 'value', 'unit', 'refRange', 'flag', 'flag.decision', 'specimen.code', 'specimen.display', 'time.effective', 'time.issued', 'time.ordered', 'order.no', 'note'],
  imaging: ['report.no', 'item.code', 'item.display', 'item.stdCode', 'item.stdDisplay', 'modality', 'findings', 'conclusion', 'bodySite.text', 'reason.text', 'time.effective', 'time.issued', 'time.ordered', 'order.no', 'status'],
  procedure: ['code.code', 'code.display', 'time.start', 'time.end', 'time.performed', 'reason.text', 'reason.code', 'outcome.text', 'bodySite.text', 'note', 'level.code', 'level.display', 'incision.code', 'incision.display', 'anesthesia.code', 'anesthesia.display', 'order.no'],
  document: ['time.authored', 'title'],
  observation: ['time.effective', 'source.name'],
  medication: ['drug.code', 'drug.display', 'dose.value', 'dose.unit', 'route.display', 'frequency.display', 'quantity', 'quantity.unit', 'time.start', 'time.end', 'time.authored', 'order.no', 'note'],
  charge: ['item.code', 'item.display', 'quantity', 'unit', 'unitPrice', 'total', 'category.code', 'category.display', 'time.occurrence', 'refund.flag'],
  death: ['time.death', 'cause.code', 'cause.display', 'cause.text', 'place.display'],
  generic: ['time.recorded'],
}

export function isKnownRole(kind, role) {
  if (COMMON_ROLES.includes(role)) return true
  if (/^actor\.[a-z]+\.(code|name)$/.test(role)) return ACTOR_FUNCTIONS.includes(role.split('.')[1])
  return (KIND_ROLES[kind] ?? []).includes(role)
}

/** Check a table spec; returns a list of problems (empty = ok). */
export function checkSpec(spec) {
  const problems = []
  if (!spec.id) problems.push('缺少 id')
  if (!KINDS[spec.kind]) problems.push(`未知 kind: ${spec.kind}`)
  for (const role of Object.keys(spec.roles ?? {})) if (!isKnownRole(spec.kind, role)) problems.push(`表 ${spec.id}：未知角色 ${role}`)
  if (spec.kind === 'observation' && !(spec.items ?? []).length) problems.push(`表 ${spec.id}：observation 需要 items`)
  if (spec.kind === 'document' && !(spec.sections ?? []).length) problems.push(`表 ${spec.id}：document 需要 sections`)
  return problems
}
