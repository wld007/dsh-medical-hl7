/**
 * 批次报告（Markdown + JSON）。不含病历原文：只有计数、字段名、假名编号和遮盖后的命中值。
 */
const STATUS = { running: '运行中', completed: '完成', review: '完成，有需要关注的项', cancelled: '已取消', failed: '失败' }
const TYPE_ORDER = ['Patient', 'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'Specimen', 'Procedure', 'DocumentReference', 'MedicationRequest', 'ChargeItem', 'Basic', 'Organization', 'Practitioner']

export function renderReport(run) {
  const L = []
  const t = run.totals
  const byType = {}
  const leftovers = {}
  const timeUnparsed = {}
  let invalid = 0
  for (const p of run.patients) {
    for (const [k, n] of Object.entries(p.byType ?? {})) byType[k] = (byType[k] ?? 0) + n
    for (const [k, n] of Object.entries(p.leftoverFields ?? {})) leftovers[k] = (leftovers[k] ?? 0) + n
    for (const [k, n] of Object.entries(p.timeUnparsed ?? {})) timeUnparsed[k] = (timeUnparsed[k] ?? 0) + n
    invalid += p.invalidRecords ?? 0
  }
  const ms = run.finishedAt ? new Date(run.finishedAt) - new Date(run.startedAt) : null
  L.push('# HL7 FHIR 转换报告', '')
  L.push(`- 批次：\`${run.id}\``)
  L.push(`- 状态：**${STATUS[run.status] ?? run.status}**`)
  L.push(`- 开始：${run.startedAt}${run.finishedAt ? `；结束：${run.finishedAt}（${fmtMs(ms)}）` : ''}`)
  L.push(`- 输入：\`${run.input}\``)
  L.push(`- 输入来源：${run.provenance?.note ?? '未知'}`)
  if (run.output) L.push(`- 交付：\`${run.output}\`（bundles/ 每病人一个 transaction Bundle；ndjson/ 整批 Bulk Data；manifest.json）`)
  L.push(`- 记录：\`${run.runDir}\`（mapping.json 是本批实际使用的映射规格）`)
  L.push(`- 标准：FHIR R4（4.0.1）；标识与本地代码体系命名空间 \`${run.namespace}\`；无时区的源时间按 ${run.timezone} 标注`)
  L.push(`- 映射规格：${(run.profilesUsed ?? []).map((p) => (p === 'auto' ? '自动推断' : p)).join('、') || '—'}`)
  if (run.sourceCheck) L.push(`- 源文件检查：${run.sourceCheck.files} 个，运行前后${run.sourceCheck.changed ? `有 ${run.sourceCheck.changed} 个变化 ⚠️` : '一致 ✓'}`)
  L.push('')
  if (run.error) L.push('## 错误', '', '```', String(run.error).split('\n').slice(0, 8).join('\n'), '```', '')
  if (run.warnings?.length) { L.push('## 注意', ''); for (const w of [...new Set(run.warnings)].slice(0, 50)) L.push(`- ⚠️ ${w}`); L.push('') }

  L.push('## 汇总', '')
  L.push('| 目录 | 病人 | 已交付 | 验收门未过（暂扣） | 资源 | 结构错误 | 结构提示 | 登记缺失的就诊 | 作废记录 |')
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  L.push(`| ${t.units} | ${t.patients} | ${t.done} | ${t.held} | ${t.resources} | ${t.errors} | ${t.warnings} | ${t.unresolvedEncounters ?? 0} | ${invalid} |`)
  L.push('')
  L.push('### 资源类型', '')
  L.push('| 类型 | 数量（按病人累计） | 整批去重后 |', '| --- | --- | --- |')
  const types = Object.keys({ ...byType, ...(run.bulk ?? {}) }).sort((a, b) => idx(a) - idx(b))
  for (const k of types) L.push(`| ${k} | ${byType[k] ?? 0} | ${run.bulk?.[k] ?? '—'} |`)
  L.push('')
  L.push('> 登记缺失的就诊：检验、诊断等记录写了门诊号/住院号，但就诊表里没有这次就诊。按号码建了 Encounter（status=unknown，带 encounter-not-registered 标签，门诊/住院由号码类型决定，时间不填），同一次就诊的记录仍能归到一起。', '')

  if (run.definitions) {
    const d = run.definitions
    L.push('## 附带的定义', '')
    L.push(`交付目录 definitions/ 里有 ${d.StructureDefinition} 个扩展定义（StructureDefinition）和 ${d.CodeSystem} 个本地代码体系（CodeSystem，列出本批出现过的全部本地代码）。接收方或官方校验器加载它们（\`-ig definitions/\`）即可识别本地扩展与代码。`, '')
    if (d.multiDisplay) {
      L.push(`### 一个代码多种名称（${d.multiDisplay} 个代码）`, '')
      L.push('同一本地代码在源数据里出现过不同的名称：多数是改名或简称，也可能是代码被混用（数据质量问题）。CodeSystem 以出现最多的为主名称，其余列为同义名，全部保留。下面是名称最多的一些：', '')
      L.push('| 代码体系 | 代码 | 名称（出现次数） |', '| --- | --- | --- |')
      for (const m of d.multiDisplaySample ?? []) L.push(`| ${m.system} | ${m.code} | ${m.names.slice(0, 6).join('、')}${m.names.length > 6 ? '…' : ''} |`)
      L.push('')
    }
  }
  L.push('## 映射覆盖', '')
  L.push('| 表 | 行数 |', '| --- | --- |')
  for (const [k, n] of Object.entries(run.tables ?? {}).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${n} |`)
  L.push('')
  if (run.inferred?.length) {
    L.push('### 没有现成规格、自动推断的表', '')
    L.push('这些表按 Basic 资源保留全部字段，并自动推断了病人、机构、医生、就诊号、记录时间。要转成具体的临床资源，请参照 mapping.json 里的推断结果写一份正式规格（放到设置里的 profilesDir）。', '')
    L.push('| 表 | 文件 | 行数 | 建议类型 | 推断出的角色数 |', '| --- | --- | --- | --- | --- |')
    for (const s of run.inferred) L.push(`| ${s.id} | ${s.file} | ${s.rows} | ${s.suggestedKind ?? '—'} | ${s.roles} |`)
    L.push('')
  }
  const lo = Object.entries(leftovers).sort((a, b) => b[1] - a[1])
  if (lo.length) {
    L.push('### 没有对应角色、原样保留的字段', '')
    L.push(`共 ${lo.length} 个字段，以 \`${run.namespace}/StructureDefinition/source-field\` 扩展（name/value）挂在对应资源上。出现次数多的字段值得补进映射规格。`, '')
    L.push('| 表.字段 | 次数 |', '| --- | --- |')
    for (const [k, n] of lo.slice(0, 60)) L.push(`| ${k} | ${n} |`)
    if (lo.length > 60) L.push(`| …另有 ${lo.length - 60} 个 | |`)
    L.push('')
  }
  const tu = Object.entries(timeUnparsed)
  if (tu.length) {
    L.push('### 无法识别的时间值', '', '这些值没有转成 FHIR 时间（原值仍在源文件；转换结果里该时间缺失）：', '')
    for (const [k, n] of tu) L.push(`- ${k}：${n} 处`)
    L.push('')
  }

  L.push('## 各病人', '')
  L.push('| 病人 | 状态 | 源记录 | 资源 | 结构错误 | 残留标识符 | 耗时 |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const p of run.patients.slice(0, 500)) {
    L.push(`| ${p.name} | ${p.status === 'held' ? '⚠️ 暂扣' : '交付'} | ${p.records} | ${p.resources} | ${p.gates.structure.errors} | ${p.gates.residual.hits} | ${fmtMs(p.ms)} |`)
  }
  if (run.patients.length > 500) L.push(`| …另有 ${run.patients.length - 500} 位 | | | | | | |`)
  L.push('')
  const bad = run.patients.filter((p) => p.validation?.errors?.length || p.residual?.length || p.issues?.length)
  if (bad.length) {
    L.push('## 问题明细', '')
    for (const p of bad.slice(0, 50)) {
      L.push(`### ${p.name}`, '')
      for (const e of p.validation?.errors ?? []) L.push(`- 结构：${e.type}/${e.id} \`${e.path}\` ${e.message}`)
      for (const h of p.residual ?? []) L.push(`- 残留${h.kind}：${h.value}（${h.where}）`)
      for (const i of p.issues ?? []) L.push(`- ${i}`)
      L.push('')
    }
  }
  if (run.officialValidation) {
    L.push('## 官方 HL7 Validator 抽检', '')
    for (const r of run.officialValidation.results ?? []) {
      if (r.failed) { L.push(`- ${r.bundle}：校验器没跑成`, '', '```', r.tail ?? '', '```'); continue }
      L.push(`- ${r.bundle}：错误 ${r.errors}，警告 ${r.warnings}`)
      for (const [m, n] of r.topErrors ?? []) L.push(`  - ${n} × ${m}`)
    }
    L.push('')
  }
  L.push('## 转换口径', '')
  L.push('- 值不变：时间只做格式转换，代码原样进本地代码体系（只有确知含义的才加标准编码，如体征的 LOINC、性别、婚姻状况），文本只去首尾空白，文书正文原样放进附件。')
  L.push('- 不丢数据：没有对应角色的字段挂 source-field 扩展；不认识的表转 Basic。')
  L.push('- 编号稳定：资源 id 由来源表 + 源记录主键派生，重跑不变；Bundle 用 PUT，可以重复导入。')
  L.push('- 含义不明的代码（如检验结果标志）不换算成 FHIR 标准取值，原样放在扩展里。')
  return { markdown: L.join('\n'), json: { id: run.id, status: run.status, totals: t, byType, bulk: run.bulk ?? null, tables: run.tables ?? {}, inferred: run.inferred ?? [], leftovers, timeUnparsed, warnings: run.warnings, officialValidation: run.officialValidation ?? null } }
}

function idx(t) { const i = TYPE_ORDER.indexOf(t); return i < 0 ? 99 : i }
function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
