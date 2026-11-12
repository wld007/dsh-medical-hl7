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

/** 记录类别的中文说明（给模型起草映射用）。 */
export const KIND_DOC = {
  patient: '病人基本信息（每人一行或少量几行）', address: '地址（户籍、现住址）', encounter: '就诊登记 / 挂号 / 入出院登记（一次就诊一行）',
  condition: '诊断（一条诊断一行）', lab: '检验结果（一个检验子项一行，同一报告多行）', imaging: '检查报告（影像、超声、内镜、病理等，一份报告一行）',
  procedure: '手术或操作', document: '病历文书（主诉、现病史、病程记录、出院小结等成段文字，一份文书一行）',
  observation: '测量与问卷（体征、生活方式等，一行里有多个测量字段）', medication: '用药医嘱 / 处方明细（一种药一行）', charge: '费用明细（一个收费项目一行）',
  death: '死亡信息', generic: '以上都不是（全部字段原样保留）',
}

/** 语义角色的中文说明（给模型起草映射用）。 */
export const ROLE_DOC = {
  'patient.id': '病人身份证号（或证件号），用来把同一病人的记录归到一起', 'patient.localId': '机构内病人号 / 病案号 / 患者 ID', 'patient.card': '就诊卡号',
  'patient.name': '病人姓名', 'patient.gender.code': '性别代码', 'patient.gender.display': '性别名称', 'patient.birthDate': '出生日期', 'patient.telecom': '病人电话',
  'org.code': '医疗机构代码', 'org.name': '医疗机构名称', 'dept.code': '科室代码', 'dept.name': '科室名称',
  'encounter.outpatientNo': '门（急）诊号', 'encounter.inpatientNo': '住院号', 'encounter.setting': '就诊类型 / 病人来源代码（门诊、住院、急诊、体检）', 'encounter.setting.display': '就诊类型名称',
  'record.created': '记录创建时间', 'record.updated': '记录更新时间',
  name: '姓名', 'gender.code': '性别代码', 'gender.display': '性别名称', birthDate: '出生日期', telecom: '电话', 'maritalStatus.code': '婚姻状况代码', 'maritalStatus.display': '婚姻状况名称',
  'idType.code': '证件类型代码', 'idType.display': '证件类型名称', 'time.recorded': '记录时间',
  'address.text': '完整地址', 'address.province.code': '省代码', 'address.province.name': '省名称', 'address.city.code': '市代码', 'address.city.name': '市名称', 'address.county.code': '区县代码', 'address.county.name': '区县名称',
  'address.town.code': '乡镇街道代码', 'address.town.name': '乡镇街道名称', 'address.village.code': '村居委代码', 'address.village.name': '村居委名称', 'address.unit': '单元', 'address.house': '门牌号', 'address.postalCode': '邮编', 'source.name': '数据来源系统名称',
  'time.start': '开始时间（就诊 / 入院 / 手术开始 / 用药开始）', 'time.end': '结束时间（出院 / 手术结束 / 停药）', 'reason.text': '就诊原因 / 入院诊断 / 临床诊断（文字）', 'reason.code': '原因诊断代码',
  'dischargeDisposition.code': '离院方式代码', 'dischargeDisposition.display': '离院方式名称', 'location.ward': '病区', 'location.bed': '床号', 'emergency.flag': '急诊标志', 'firstVisit.flag': '初诊标志',
  'code.code': '主代码（诊断为 ICD-10；手术为手术操作代码）', 'code.display': '主代码对应名称', 'code.local': '机构内部诊断代码', text: '诊断描述原文', 'time.onset': '发病时间',
  'category.code': '类别代码（诊断类别 / 费用类别）', 'category.display': '类别名称', 'main.flag': '主诊断标志', 'tcm.flag': '中医诊断标志', 'tcm.code': '中医病证代码', 'tcm.display': '中医病证名称', order: '序号', note: '备注 / 经过描述',
  'report.no': '报告单号', 'panel.code': '检验组合（申请项目）代码', 'panel.display': '检验组合名称', 'item.code': '项目代码（检验子项 / 检查项目 / 收费项目）', 'item.display': '项目名称', 'item.stdCode': '标准项目代码', 'item.stdDisplay': '标准项目名称',
  value: '结果值', unit: '结果单位', refRange: '参考范围（文字）', flag: '结果异常标志', 'flag.decision': '结果判定', 'specimen.code': '标本类型代码', 'specimen.display': '标本类型名称',
  'time.effective': '检验 / 检查 / 测量时间', 'time.issued': '报告或审核时间', 'time.ordered': '申请时间', 'order.no': '申请单号 / 医嘱号',
  modality: '检查类型（CT、MR、US、DR……）', findings: '检查所见（客观描述）', conclusion: '检查结论 / 印象', 'bodySite.text': '部位', status: '状态',
  'time.performed': '手术 / 操作日期（计划或实施）', 'outcome.text': '术后诊断 / 结局', 'level.code': '手术级别代码', 'level.display': '手术级别名称', 'incision.code': '切口类别代码', 'incision.display': '切口类别名称', 'anesthesia.code': '麻醉方式代码', 'anesthesia.display': '麻醉方式名称',
  'time.authored': '文书书写时间 / 医嘱开立时间', title: '文书标题',
  'drug.code': '药品代码', 'drug.display': '药品名称', 'dose.value': '单次剂量', 'dose.unit': '剂量单位', 'route.display': '给药途径', 'frequency.display': '用药频次', quantity: '数量', 'quantity.unit': '数量单位',
  unitPrice: '单价', total: '金额', 'time.occurrence': '收费时间', 'refund.flag': '收退费标志',
  'time.death': '死亡时间', 'cause.code': '根本死因代码', 'cause.display': '根本死因名称', 'cause.text': '死因链描述', 'place.display': '死亡地点',
}
export const ACTOR_DOC = { author: '记录者 / 诊断医生 / 报告医生', performer: '执行者（检验者、检查医生）', requester: '申请 / 开单医生', verifier: '审核者', attender: '接诊 / 主治医生', admitter: '收治医生', surgeon: '主刀医生', assistant: '手术助手', anesthetist: '麻醉医生', collector: '采样人', recorder: '录入人', updater: '修改人', other: '其他参与者' }

/** Roles available to a kind, with Chinese descriptions. */
export function rolesFor(kind) {
  const list = [...COMMON_ROLES, ...(KIND_ROLES[kind] ?? [])]
  const out = Object.fromEntries(list.map((r) => [r, ROLE_DOC[r] ?? r]))
  for (const fn of ACTOR_FUNCTIONS) { out[`actor.${fn}.code`] = `${ACTOR_DOC[fn]}工号`; out[`actor.${fn}.name`] = `${ACTOR_DOC[fn]}姓名` }
  return out
}
