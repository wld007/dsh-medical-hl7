/**
 * 批次报告（Markdown + JSON）。不含病历原文：只有计数、字段名、假名编号和遮盖后的命中值。
 */
const STATUS = { running: '运行中', completed: '完成', review: '完成，有需要关注的项', cancelled: '已取消', failed: '失败' }
const TYPE_ORDER = ['Patient', 'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'Specimen', 'Procedure', 'DocumentReference', 'MedicationRequest', 'ChargeItem', 'Basic', 'Organization', 'Practitioner']

export function renderReport(run, detail = {}) {
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
  const FMT = { both: 'bundles/ 每病人一个 transaction Bundle；ndjson/ 整批 Bulk Data', bundles: '只存按人：bundles/ 每病人一个 transaction Bundle', ndjson: '只存按资源类型：ndjson/ 整批 Bulk Data' }
  if (run.output) L.push(`- 交付：\`${run.output}\`（${FMT[run.outputFormat ?? 'both']}；definitions/ 本地扩展与代码定义；manifest.json；字段说明见插件 docs/bundle-fields.md）`)
  L.push(`- 记录：\`${run.runDir}\`（mapping.json 是本批实际使用的映射规格）`)
  L.push(`- 标准：FHIR R4（4.0.1）；标识与本地代码体系命名空间 \`${run.namespace}\`；无时区的源时间按 ${run.timezone} 标注`)
  L.push(`- 映射规格：${(run.profilesUsed ?? []).map((p) => (p === 'auto' ? '自动推断' : p)).join('、') || '—'}`)
  if (run.sourceCheck) L.push(`- 源文件检查：${run.sourceCheck.files} 个，运行前后${run.sourceCheck.changed ? `有 ${run.sourceCheck.changed} 个变化 ⚠️` : '一致 ✓'}`)
  const M = run.model
  if (M?.configured) {
    L.push(`- 模型：\`${M.models?.suggest}\`（${M.endpoint ?? ''}）`)
    L.push(`- 核验模型：${M.models?.verify ? `\`${M.models.verify}\`（${M.verifyEndpoint ?? ''}，独立盲审）` : '同识别模型'}`)
    L.push(`- 思考模式：${M.disableThinking ? '关闭（enable_thinking=false）' : '开启'}；轮次上限：${M.maxRounds}；每个模型并发 ${M.concurrency}；超时 ${Math.round((M.timeoutMs ?? 0) / 1000)} 秒`)
    if (M.calls) L.push(`- 模型调用：${M.calls.total} 次（实发 ${M.calls.live}，复用缓存 ${M.calls.cached}，失败 ${M.calls.failed}），${M.calls.tokens} token`)
  } else if (M) L.push(`- 模型：${M.note ?? '未使用'}`)
  L.push('')
  if (run.error) L.push('## 错误', '', '```', String(run.error).split('\n').slice(0, 8).join('\n'), '```', '')
  if (run.warnings?.length) { L.push('## 注意', ''); for (const w of [...new Set(run.warnings)].slice(0, 50)) L.push(`- ⚠️ ${w}`); L.push('') }

  const st = run.stages
  if (st) {
    const pc = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`)
    L.push('## 流程', '')
    L.push('读取分组 → ① Schema 同构 → ② 值域归一 → ③ 术语对照 → ④ FHIR 组装 → 验收 → 交付', '')
    L.push('| 阶段 | 结果 |', '| --- | --- |')
    L.push(`| ① Schema 同构 | ${st.schema.tables} 张表（${st.schema.inferred} 张自动推断），${st.schema.rows} 行；${st.schema.extrasFields} 个字段没有对应角色，原样保留 |`)
    L.push(`| ② 值域归一 | ${st.domains.domains} 个值域、${st.domains.values} 个取值：已归一 ${st.domains.normalized}，按原文保留 ${st.domains.text}，**待确认 ${st.domains.pending}**，无对照 ${st.domains.unmapped}，不属于本值域/无法解析 ${st.domains.invalid}；覆盖率 ${pc(st.domains.coverage)} |`)
    L.push(`| ③ 术语对照 | ${st.terminology.bindings} 组对照、${st.terminology.concepts} 个本地概念，已对照 ${st.terminology.mappedConcepts} 个；按出现次数覆盖 ${pc(st.terminology.coverage)}（没对照的照常交付，只是少一个标准编码） |`)
    L.push(`| 对照表版本 | \`${run.vocab?.version ?? '—'}\`（内置 + 本机复核 \`${run.vocab?.dir ?? '—'}\`） |`)
    L.push('')
    L.push('> 值域归一与术语对照是两步：值域归一解决“同一件事写法不统一”（原值保留，另给规范值）；术语对照把本地概念对到 LOINC、SNOMED CT 等外部标准（只另加编码）。含义未确认的值标“待确认”，不猜，原值照常交付。', '')
  }
  const MP = run.model?.phases
  if (MP) {
    const cx = (c) => (c ? `盲审 ${c.reviewed}，报出 ${c.reported}，插件校验拦下 ${c.checkFailed}，复判改正 ${c.revised}，坚持 ${c.insisted}` : '—')
    L.push('## 模型', '')
    L.push('每一步都是：模型给出结论 → 插件校验（字段存在、目标值集、代码在候选里）→ 核验模型独立盲审 → 有问题时识别模型复判修正，最多 ' + (run.model.maxRounds ?? 3) + ' 轮。两模型一致的采用（标“模型 · 未复核”），有分歧的转人工复核。结果存本机对照表，下次复用。', '')
    L.push('| 阶段 | 交给模型 | 采用 | 转人工 / 放弃 | 失败 | 交叉核验 |', '| --- | --- | --- | --- | --- | --- |')
    if (MP.schema) L.push(`| ① Schema 起草 | ${MP.schema.tables} 张表 | ${MP.schema.applied}（两模型一致 ${MP.schema.agreed ?? 0}，复判为准 ${MP.schema.disputed ?? 0}） | 有未解决问题 ${MP.schema.review} | ${MP.schema.failed} | ${cx(MP.schema.cross)} |`)
    if (MP.values) L.push(`| ② 值域归一 | ${MP.values.asked} 个取值 | 规范值 ${MP.values.confirmed}，原文保留 ${MP.values.text}，不属于本值域 ${MP.values.invalid} | ${MP.values.pending} | ${MP.values.failed} | ${cx(MP.values.cross)} |`)
    if (MP.terms) L.push(`| ③ 术语对照 | ${MP.terms.asked} 个概念 | ${MP.terms.confirmed} | 分歧 ${MP.terms.review}，没有合适候选 ${MP.terms.abstain} | ${MP.terms.failed} | ${cx(MP.terms.cross)} |`)
    L.push('')
    if (MP.terms?.tables?.length) L.push(`本地代码表：${MP.terms.tables.map((t) => `${t.name}（${t.size} 条${t.zh ? '，含中文' : ''}）`).join('、')}`, '')
    if (MP.terms?.skipped?.length) { L.push('没有交给模型的术语对照（缺本地代码表；模型凭记忆给的代码不可靠）：', ''); for (const x of MP.terms.skipped) L.push(`- ${x.name}：${x.concepts} 个概念`); L.push('') }
  }
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
  L.push('## ① Schema 同构', '')
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

  if (detail.domains) {
    const doms = Object.values(detail.domains).sort((a, b) => (a.kind === b.kind ? b.total - a.total : a.kind === 'enum' ? -1 : 1))
    const n = (d, k) => d.byStatus[k] ?? 0
    L.push('## ② 值域归一', '')
    L.push('| 值域 | 类型 | 取值 | 已归一 | 原文保留 | 待确认 | 无对照 | 不属于/无法解析 | 覆盖率 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const d of doms) L.push(`| ${d.name}（${d.id}） | ${d.kind === 'enum' ? '对照' : '格式'} | ${d.total} | ${n(d, 'normalized')} | ${n(d, 'text')} | ${n(d, 'pending')} | ${n(d, 'unmapped')} | ${n(d, 'invalid')} | ${(d.coverage * 100).toFixed(1)}% |`)
    L.push('')
    const open = doms.flatMap((d) => d.values.filter((v) => ['pending', 'unmapped', 'invalid'].includes(v.status)).map((v) => ({ d, v }))).sort((a, b) => b.v.count - a.v.count)
    if (open.length) {
      L.push('### 待处理的取值', '', '在页面「值域归一」里复核：确认对照、标为不属于本值域或按原文保留。改动存本机，下次运行生效。', '')
      L.push('| 值域 | 代码 | 名称/原值 | 次数 | 状态 | 说明 |', '| --- | --- | --- | --- | --- | --- |')
      const ST = { pending: '待确认', unmapped: '无对照', invalid: '不属于本值域/无法解析' }
      for (const { d, v } of open.slice(0, 60)) L.push(`| ${d.name} | ${v.code ?? ''} | ${v.display ?? ''} | ${v.count} | ${ST[v.status]} | ${(v.note ?? '').replace(/\|/g, '/')} |`)
      if (open.length > 60) L.push(`| …另有 ${open.length - 60} 个 | | | | | |`)
      L.push('')
    }
  }
  if (detail.terminology) {
    const ts = Object.values(detail.terminology).sort((a, b) => b.occurrences - a.occurrences)
    L.push('## ③ 术语对照', '')
    L.push('| 对照 | 目标标准 | 本地概念 | 已对照 | 出现次数 | 已对照的出现次数 | 覆盖率 | 落在 |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const t of ts) L.push(`| ${t.name} | ${t.target?.name ?? ''} | ${t.concepts} | ${t.mappedConcepts} | ${t.occurrences} | ${t.mappedOccurrences} | ${t.coverage === null ? '—' : `${(t.coverage * 100).toFixed(1)}%`} | ${t.lands ?? ''} |`)
    L.push('', '本批用到的已确认对照，以 FHIR ConceptMap 放在交付目录 definitions/ 里。', '')
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
  return { markdown: L.join('\n'), json: { id: run.id, status: run.status, totals: t, stages: run.stages ?? null, byType, bulk: run.bulk ?? null, tables: run.tables ?? {}, inferred: run.inferred ?? [], leftovers, timeUnparsed, warnings: run.warnings, officialValidation: run.officialValidation ?? null } }
}

function idx(t) { const i = TYPE_ORDER.indexOf(t); return i < 0 ? 99 : i }
function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
