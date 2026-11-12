/**
 * ① Schema 同构的模型部分：给没有映射规格的表起草规格（表 → 记录类别，字段 → 语义角色，角色 → 值域）。
 *
 * 发给模型的只有：表名、所在目录、字段名、填充率、不同值个数和每个字段最多 4 个截短的样例
 * （长文本字段只说“长文本”，不发内容）。起草结果经插件校验和独立盲审后保存为
 * <vocabDir>/specs/<表>.json，以后的批次直接复用；页面上可以确认、驳回或修改。
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { KINDS, KIND_DOC, rolesFor, isKnownRole, checkSpec } from '../mapping/roles.js'
import { profileFields } from '../mapping/infer.js'
import { parseTime, isBlank, str, stableId } from '../fhir/datatypes.js'
import { MEASURES } from '../fhir/terms.js'
import { reviewLoop } from './loop.js'
import { lookupEntry } from '../stages/vocab.js'

export const DRAFTED_PROFILE = 'drafted'

const CODE_SYSTEMS = {
  lab: { item: { name: 'lab-item', scope: 'org' }, panel: { name: 'lab-panel', scope: 'org' }, specimen: { name: 'specimen', scope: 'org' }, std: { name: 'lab-item-std' } },
  imaging: { item: { name: 'exam-item', scope: 'org' }, std: { name: 'exam-item-std' } },
  condition: { code: { name: 'icd-10-cn' }, local: { name: 'diagnosis-local', scope: 'org' } },
  procedure: { code: { name: 'procedure-code', scope: 'org' }, reason: { name: 'icd-10-cn' } },
  charge: { item: { name: 'charge-item', scope: 'org' } },
  medication: { drug: { name: 'drug', scope: 'org' } },
  death: { cause: { name: 'icd-10-cn' } },
}

export function specIdOf(file) {
  const base = String(file).replace(/\.[^.]+$/, '')
  const ascii = (base.match(/^[A-Za-z0-9_-]+/) ?? [''])[0]
  return `m-${ascii || stableId(base).slice(0, 10)}`.slice(0, 48)
}
const safeFile = (file) => String(file).replace(/[\\/:*?"<>|]+/g, '_')

/** Load drafted specs as one profile (rejected ones are skipped: those tables stay Basic). */
export async function loadDraftedProfile(vocabDir) {
  const tables = []
  const records = []
  if (vocabDir) {
    let names = []
    try { names = (await readdir(join(vocabDir, 'specs'))).filter((n) => n.endsWith('.json')).sort() } catch { /* none */ }
    for (const n of names) {
      try {
        const r = JSON.parse(await readFile(join(vocabDir, 'specs', n), 'utf8'))
        records.push(r)
        if (r.status === 'rejected' || !r.spec) continue
        const domains = Object.fromEntries(Object.entries(r.spec.domains ?? {}).filter(([, d]) => r.reviewedBy || !String(d).includes('/')))
        tables.push({ ...r.spec, domains, origin: r.reviewedBy ? 'user' : 'model', reviewed: Boolean(r.reviewedBy), draftStatus: r.status })
      } catch { /* broken file */ }
    }
  }
  return { profile: { id: DRAFTED_PROFILE, name: '模型起草', version: '1', tables }, records }
}

export async function saveDraft(vocabDir, record) {
  await mkdir(join(vocabDir, 'specs'), { recursive: true })
  await writeFile(join(vocabDir, 'specs', `${safeFile(record.file).replace(/\.json$/i, '')}.json`), JSON.stringify(record, null, 2))
}

/* ------------------------------------------------------------------ prompts */
function tableBrief(t) {
  return {
    table: t.file, path: t.path, rows: t.rows,
    fields: t.fields.map((f) => {
      const o = { name: f.name, fill: `${f.fill}%`, distinct: f.distinct }
      if (f.pseudonym) o.kind = `匿名化假名（${f.pseudonym}）`
      else if (f.longText) o.kind = `长文本（平均 ${f.avgLen} 字）`
      else o.examples = f.examples
      if (f.time) o.time = true
      return o
    }),
  }
}

function catalog(domains) {
  const kinds = Object.entries(KIND_DOC).map(([k, d]) => `- ${k}：${d}`).join('\n')
  const roles = Object.keys(KINDS).filter((k) => k !== 'generic').map((k) => `【${k}】${Object.entries(rolesFor(k)).filter(([r]) => !r.startsWith('actor.')).map(([r, d]) => `${r}=${d}`).join('；')}`).join('\n')
  const actors = Object.entries(rolesFor('lab')).filter(([r]) => r.startsWith('actor.') && r.endsWith('.name')).map(([r, d]) => `${r.replace('.name', '.code/.name')}=${d.replace(/姓名$/, '')}`).join('；')
  const doms = domains.map((d) => `- ${d.id}：${d.name}（${(d.target?.values ?? []).slice(0, 8).map((v) => v.label ?? v.display).join('、')}${(d.target?.values ?? []).length > 8 ? '…' : ''}）`).join('\n')
  const measures = Object.entries(MEASURES).filter(([k]) => k !== 'bloodPressure').map(([k, m]) => `${k}=${m.text}`).join('、')
  return { kinds, roles, actors, doms, measures }
}

const SPEC_FORMAT = `{"kind":"类别","name":"中文表名","key":["主键字段"],"invalid":{"field":"作废标志字段","values":["1"]}或null,
 "roles":{"角色":"字段名" 或 ["首选字段","备选字段"]},
 "domains":{"角色或概念名":"值域编号"},
 "sections":[["字段名","栏目名"]],
 "items":[{"field":"字段名","local":"英文短名","text":"中文名","measure":"体征键或省略","unit":"单位或省略","coded":{"code":"代码字段","display":"名称字段"}或省略,"domain":"值域编号或省略"}],
 "reasons":{"字段名":"判断依据"}}`

export function draftPrompt(t, cat) {
  return [{ role: 'user', content: `任务：下面是一张医疗数据表（已匿名化）的字段画像。请起草它到公共中间模型的映射规格：判断这张表是哪一类记录，并把字段指派给语义角色。

记录类别（kind）：
${cat.kinds}

各类别可用的角色（角色=含义）：
${cat.roles}
医务人员角色（各类别都可用）：${cat.actors}
所有类别都可用：patient.*、org.*、dept.*、encounter.*、record.*（见上）。

可绑定的值域（domains，键为角色名去掉 .code/.display 后的概念名，如 "patient.gender"、"maritalStatus"、"unit"、"modality"、"encounter.setting"）：
${cat.doms}

规则：
1. 只能用上面列出的类别和角色；字段名必须逐字取自字段列表。一个角色可以给多个候选字段（按优先顺序）。
2. patient.id 必须指向病人本人的身份证号 / 证件号字段（取值多为“证件-xxxxxx”这类假名）；证件类型、记录号、就诊号、申请单号都不是。
3. 时间角色只能指向时间字段；代码和名称成对的字段分别给 .code 和 .display 角色。
4. 拿不准的字段不要指派（不指派的字段会原样保留，不会丢）；不要编造字段。
5. document 类：sections 列出组成正文的长文本字段和栏目名，按书写顺序；observation 类：items 列出每个测量 / 问卷字段（measure 可选：${cat.measures}）。
6. 只输出 JSON，格式：
${SPEC_FORMAT}

表：${JSON.stringify(tableBrief(t))}` }]
}

export function blindSchemaPrompt(t, spec) {
  const assigned = Object.entries(spec.roles ?? {}).map(([role, fs]) => ({ role, fields: [].concat(fs) }))
  return [{ role: 'user', content: `你是一名独立的数据映射审查员。下面是一张医疗数据表（已匿名化）的字段画像，以及另一个人起草的映射规格。你不知道起草者的理由。
任务：检查映射是否正确，找出错误。
检查要点：
1. kind（记录类别）是否与表的内容一致。
2. 每个“角色 → 字段”是否正确（含义一致；时间角色对时间字段；代码 / 名称没有颠倒）。
3. 有没有明显应当指派却漏掉的关键字段（病人证件号、时间、项目代码 / 名称、结果值、单位）。
4. key（主键）是否能唯一标识一行。
没有问题时 ok 为 true、issues 为空。只报告确有依据的问题，不要吹毛求疵。
输出 JSON：{"ok":true或false,"issues":[{"field":"字段名或空","problem":"wrong-role|missing|wrong-kind|wrong-key|other","suggest":"建议的角色或类别","reason":"简短理由"}]}

表：${JSON.stringify(tableBrief(t))}
映射：${JSON.stringify({ kind: spec.kind, key: spec.key, roles: assigned, domains: spec.domains ?? {}, items: spec.items ?? [], sections: spec.sections ?? [] })}` }]
}

export function adjudicateSchemaPrompt(t, spec, issue, cat) {
  return [{ role: 'user', content: `任务：你起草的映射规格被审查员（或插件校验）指出了问题。请逐条判断：问题成立就改正，给出完整的新规格；不成立就坚持原规格并说明理由。
可用的类别、角色、值域与起草时相同：
${cat.kinds}
${cat.roles}
医务人员：${cat.actors}
值域：
${cat.doms}
输出 JSON：{"revise":true或false,"spec":完整的新规格（revise 为 true 时必填，格式同起草）,"reason":"简短理由"}
规格格式：${SPEC_FORMAT}

表：${JSON.stringify(tableBrief(t))}
你的规格：${JSON.stringify(spec)}
指出的问题：${JSON.stringify(issue)}` }]
}

/* --------------------------------------------------------------- checking */
/** Normalize shape; returns the spec (never throws). */
export function shapeSpec(raw, t, domainIds) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const fields = new Set(t.fields.map((f) => f.name))
  const out = { id: specIdOf(t.file), name: str(s.name) ?? t.file.replace(/\.[^.]+$/, ''), match: { file: t.file }, kind: KINDS[s.kind] ? s.kind : 'generic', key: [].concat(s.key ?? []).filter((f) => fields.has(f)), roles: {}, domains: {}, drafted: true }
  if (s.invalid && fields.has(s.invalid.field)) out.invalid = { field: s.invalid.field, values: [].concat(s.invalid.values ?? ['1']).map(String) }
  for (const [role, fs] of Object.entries(s.roles ?? {})) {
    const list = [].concat(fs).map(String)
    if (list.length) out.roles[role] = list.length === 1 ? list[0] : list
  }
  for (const [k, d] of Object.entries(s.domains ?? {})) if (typeof d === 'string') out.domains[k.replace(/\.(code|display)$/, '')] = d
  if (out.kind === 'document') {
    out.sections = (Array.isArray(s.sections) ? s.sections : []).filter((x) => Array.isArray(x) && fields.has(x[0])).map((x) => [x[0], str(x[1]) ?? x[0]])
    out.document = { code: out.id, display: out.name }
  }
  if (out.kind === 'observation') {
    out.items = (Array.isArray(s.items) ? s.items : []).filter((x) => x && (fields.has(x.field) || fields.has(x.coded?.code) || fields.has(x.coded?.display))).map((x) => {
      const it = { text: str(x.text) ?? x.field, local: String(x.local ?? x.field ?? x.coded?.code ?? 'item').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'item' }
      if (x.coded && (fields.has(x.coded.code) || fields.has(x.coded.display))) it.coded = { code: fields.has(x.coded.code) ? x.coded.code : x.coded.display, display: fields.has(x.coded.display) ? x.coded.display : undefined }
      else it.field = x.field
      if (MEASURES[x.measure]) it.measure = x.measure
      if (x.unit) it.unit = String(x.unit)
      if (x.domain && domainIds.has(x.domain)) it.domain = x.domain
      if (!it.measure && !it.coded && !it.domain) it.category = 'survey'
      return it
    })
  }
  if (CODE_SYSTEMS[out.kind]) out.codeSystems = CODE_SYSTEMS[out.kind]
  return out
}

/**
 * 病人编号字段决定记录怎么归到人：不交给模型猜。
 * 有“证件-xxxxxx”假名字段（匿名化插件的证件号）时就是它；否则模型的选择要通过一致性检查：
 * 同一个文件（一位病人）里几乎不变，不同文件之间不全相同。
 */
export function patientIdProblem(spec, t, rows, rowFiles, inferred) {
  const forced = pseudonymPatientField(t, rows, rowFiles)
  const pid = [].concat(spec.roles['patient.id'] ?? [])
  if (forced) return pid.length === 1 && pid[0] === forced ? null : `patient.id 必须是证件号假名字段 ${forced}`
  if (!pid.length) return null
  const val = (r) => pid.map((f) => r[f]).find((v) => !isBlank(v))
  const perFile = new Map()
  rows.forEach((r, i) => { const v = val(r); if (v === undefined) return; const k = rowFiles?.[i] ?? 0; const s = perFile.get(k) ?? new Set(); s.add(String(v)); perFile.set(k, s) })
  if ([...perFile.values()].some((s) => s.size > 2)) return `patient.id（${pid.join('/')}）在同一个文件里有多个不同取值，不像病人编号`
  if (perFile.size >= 2 && new Set([...perFile.values()].flatMap((s) => [...s])).size === 1 && !inferred) return `patient.id（${pid.join('/')}）在不同病人的文件里取值都相同，不像病人编号`
  return null
}
export function pseudonymPatientField(t, rows = [], rowFiles = []) {
  // 可能有多个证件号假名字段（病人本人、医生、家属）：取在同一病人文件里不变、填充率最高的
  const cands = t.fields.filter((x) => x.pseudonym === '证件' && x.fill >= 90)
  if (cands.length <= 1) return cands[0]?.name ?? null
  const spread = (f) => {
    const per = new Map()
    rows.forEach((r, i) => { const v = r[f]; if (isBlank(v)) return; const k = rowFiles[i] ?? 0; const st = per.get(k) ?? new Set(); st.add(String(v)); per.set(k, st) })
    return Math.max(0, ...[...per.values()].map((st) => st.size))
  }
  return cands.map((f, i) => ({ f, i, s: spread(f.name) })).sort((a, b) => a.s - b.s || b.f.fill - a.f.fill || a.i - b.i)[0].f.name
}

/** Problems the model must fix (null = fine). Never trusts the model: fields, roles, times, key, patient id. */
export function checkDraft(spec, t, rows, domainIds) {
  const fields = new Set(t.fields.map((f) => f.name))
  const problems = []
  if (spec.kind === 'generic') problems.push('kind 不在可用类别里，或选了 generic')
  for (const [role, fs] of Object.entries(spec.roles)) {
    if (!isKnownRole(spec.kind, role)) problems.push(`角色 ${role} 不属于类别 ${spec.kind}`)
    for (const f of [].concat(fs)) if (!fields.has(f)) problems.push(`字段 ${f} 不存在`)
  }
  for (const [k, d] of Object.entries(spec.domains)) if (!domainIds.has(d)) problems.push(`值域 ${d}（${k}）不存在`); else if (!CONCEPT_DOMAINS[k]?.includes(d)) problems.push(`${k} 不能绑定值域 ${d}${CONCEPT_DOMAINS[k] ? `（可选：${CONCEPT_DOMAINS[k].join('、')}）` : '（这个角色没有通用值域，不要绑定）'}`)
  const pid = [].concat(spec.roles['patient.id'] ?? [])
  if (!pid.length) problems.push('没有指派 patient.id（病人证件号）')
  else {
    const filled = rows.filter((r) => pid.some((f) => !isBlank(r[f]))).length
    if (rows.length && filled < rows.length * 0.9) problems.push(`patient.id 字段在 ${rows.length - filled}/${rows.length} 行里为空`)
  }
  for (const [role, fs] of Object.entries(spec.roles)) {
    if (!/^(time|record)\.|birthDate$/.test(role)) continue
    const vals = rows.map((r) => [].concat(fs).map((f) => r[f]).find((v) => !isBlank(v))).filter((v) => v !== undefined)
    const bad = vals.filter((v) => !parseTime(v)).length
    if (vals.length && bad > vals.length * 0.2) problems.push(`时间角色 ${role} 的取值有 ${bad}/${vals.length} 个不是时间`)
  }
  if (spec.key.length) {
    const keys = rows.map((r) => spec.key.map((f) => str(r[f]) ?? '').join('|'))
    const uniq = new Set(keys).size
    if (rows.length > 3 && uniq < rows.length * 0.95) problems.push(`key ${spec.key.join('+')} 在样本里有重复（${rows.length - uniq} 行）`)
  }
  if (spec.kind === 'document' && !spec.sections?.length) problems.push('document 类需要 sections（组成正文的字段）')
  if (spec.kind === 'observation' && !spec.items?.length) problems.push('observation 类需要 items（测量字段）')
  const p2 = checkSpec(spec).filter((x) => !/未知角色/.test(x))
  problems.push(...p2)
  return problems.length ? problems.join('；') : null
}

/**
 * 绑定的值域与字段取值是否对得上：用已有对照试一下样本，大多数取值都不认识，多半是绑错了字段
 * （实测：模型把年龄字段绑成性别，再把 81、84 “推断”成女性）。
 */
export function bindingFit(spec, rows, domains) {
  const out = []
  for (const [concept, domainId] of Object.entries(spec.domains ?? {})) {
    const d = domains.get(domainId)
    if (!d) continue
    const pick = (role) => [].concat(spec.roles?.[role] ?? [])
    const codeFs = [...pick(concept), ...pick(`${concept}.code`)]
    const dispFs = pick(`${concept}.display`)
    if (!codeFs.length && !dispFs.length) continue
    let n = 0; let known = 0
    for (const r of rows) {
      const c = codeFs.map((f) => r[f]).find((v) => !isBlank(v)); const s = dispFs.map((f) => r[f]).find((v) => !isBlank(v))
      if (c === undefined && s === undefined) continue
      n++
      let cs = c === undefined ? undefined : str(c); let ds = s === undefined ? undefined : str(s)
      if (d.match === 'display') { ds = ds ?? cs; cs = undefined }
      const e = lookupEntry(d, cs, ds)
      if (e && e.status !== 'invalid') known++
    }
    const ok = n < 5 || known >= n * 0.5
    out.push({ concept, domain: domainId, ok, problem: ok ? null : `值域 ${domainId} 绑在 ${[...codeFs, ...dispFs].join('/')} 上，样本 ${n} 个取值里只认得 ${known} 个，多半绑错了字段` })
  }
  return out
}

/** 角色 → 可绑定的通用值域（意思对得上的才放行）。没列出的角色不能由模型绑定值域。 */
export const CONCEPT_DOMAINS = {
  'patient.gender': ['gender'], gender: ['gender'], 'patient.maritalStatus': ['marital'], maritalStatus: ['marital'],
  unit: ['ucum-unit'], 'dose.unit': ['ucum-unit'], 'quantity.unit': ['ucum-unit'], modality: ['dicom-modality'], value: ['qualitative-result'],
  'emergency.flag': ['yes-no'], 'firstVisit.flag': ['yes-no'], 'main.flag': ['yes-no'], 'tcm.flag': ['yes-no'], 'refund.flag': ['yes-no'],
}
const ITEM_DOMAINS = new Set(['yes-no', 'abo', 'rh', 'qualitative-result', 'gender', 'marital'])

/** Final safety net: drop whatever is still invalid (dropped fields stay as source-field — nothing is lost). */
export function sanitize(spec, t, rows, domainIds, inferred) {
  const fields = new Set(t.fields.map((f) => f.name))
  const dropped = []
  for (const [role, fs] of Object.entries(spec.roles)) {
    const keep = [].concat(fs).filter((f) => fields.has(f))
    if (!isKnownRole(spec.kind, role) || !keep.length) { dropped.push(role); delete spec.roles[role]; continue }
    spec.roles[role] = keep.length === 1 ? keep[0] : keep
  }
  for (const [k, d] of Object.entries(spec.domains)) if (!domainIds.has(d) || !CONCEPT_DOMAINS[k]?.includes(d)) { delete spec.domains[k]; dropped.push(`值域 ${d}（${k}）`) }
  for (const it of spec.items ?? []) if (it.domain && !ITEM_DOMAINS.has(it.domain)) delete it.domain
  if (!spec.roles['patient.id'] && inferred?.roles?.['patient.id']) spec.roles['patient.id'] = inferred.roles['patient.id']
  for (const [role, fs] of Object.entries(spec.roles)) {
    if (!/^(time|record)\.|birthDate$/.test(role)) continue
    const vals = rows.map((r) => [].concat(fs).map((f) => r[f]).find((v) => !isBlank(v))).filter((v) => v !== undefined)
    if (vals.length && vals.filter((v) => !parseTime(v)).length > vals.length * 0.2) { dropped.push(role); delete spec.roles[role] }
  }
  if (spec.key.length) {
    const keys = rows.map((r) => spec.key.map((f) => str(r[f]) ?? '').join('|'))
    if (rows.length > 3 && new Set(keys).size < rows.length * 0.95) { dropped.push('key'); spec.key = [] }
  }
  if (spec.kind === 'document' && !spec.sections?.length) spec.kind = 'generic'
  if (spec.kind === 'observation' && !spec.items?.length) spec.kind = 'generic'
  if (spec.kind === 'generic') { spec.roles['time.recorded'] ??= inferred?.roles?.['time.recorded']; if (!spec.roles['time.recorded']) delete spec.roles['time.recorded'] }
  return dropped
}

/** Table brief from sample rows. */
export function describeTable(file, path, rows) {
  const prof = profileFields(rows, 200)
  return {
    file, path, rows: rows.length,
    fields: prof.map((f) => {
      const vals = new Set(); for (const r of rows.slice(0, 200)) if (!isBlank(r[f.name])) vals.add(String(r[f.name]))
      return { name: f.name, fill: f.n ? Math.round((100 * f.filled) / f.n) : 0, distinct: vals.size, pseudonym: f.dominant, time: f.filled > 0 && f.times >= f.filled * 0.9, longText: f.avgLen > 40, avgLen: Math.round(f.avgLen), examples: [...vals].slice(0, 4).map((v) => v.slice(0, 30)) }
    }),
  }
}

/**
 * Draft specs for tables without one.
 * @param tables [{ file, path, rows, inferred }]
 * @returns { records, cross }
 */
export async function draftSpecs({ tables, runner, vocab, maxRounds, signal, onProgress }) {
  // 只能绑定通用值域：带“数据源/”前缀的值域（如 regional-platform/visit-type）是那个数据源自己的编码，别的数据源不能借用
  const domains = [...vocab.domains.values()].filter((d) => !d.id.includes('/'))
  const domainIds = new Set(domains.map((d) => d.id))
  const fit = (spec, rows) => bindingFit(spec, rows, vocab.domains)
  const cat = catalog(domains)
  const T = new Map(tables.map((t) => [t.file, { ...t, brief: describeTable(t.file, t.path, t.rows) }]))
  const items = tables.map((t) => ({ id: t.file }))
  const ask = (role, phase, round, msgs, validate) => runner.askJson(role, { phase, round, items: 1 }, msgs, { validate, signal, maxTokens: 6000 })
  const { results, cross } = await reviewLoop({
    items, maxRounds, batch: 1, onProgress, insist: 'accept',
    propose: async ([it], round) => {
      const t = T.get(it.id)
      const { json } = await ask('suggest', 'Schema 起草', round, draftPrompt(t.brief, cat), (j) => j && typeof j === 'object' && j.roles)
      return new Map([[it.id, shapeSpec(json, t.brief, domainIds)]])
    },
    check: (it, spec) => { const t = T.get(it.id); return [checkDraft(spec, t.brief, t.rows, domainIds), patientIdProblem(spec, t.brief, t.rows, t.rowFiles, t.inferred), fit(spec, t.rows).filter((x) => !x.ok).map((x) => x.problem).join('；') || null].filter(Boolean).join('；') || null },
    blind: async (list, round) => {
      const [{ item, proposal }] = list
      const { json } = await ask('verify', 'Schema 盲审', round, blindSchemaPrompt(T.get(item.id).brief, proposal), (j) => j && typeof j.ok === 'boolean')
      const issues = Array.isArray(json.issues) ? json.issues : []
      return new Map([[item.id, { ok: json.ok && !issues.length, reason: issues.map((x) => `${x.field ? `${x.field}：` : ''}${x.problem ?? ''} ${x.suggest ? `→ ${x.suggest}` : ''} ${x.reason ?? ''}`.trim()).join('；'), alt: issues }]])
    },
    adjudicate: async (list, round) => {
      const [{ item, proposal, issue }] = list
      const t = T.get(item.id)
      const { json } = await ask('suggest', 'Schema 复判', round, adjudicateSchemaPrompt(t.brief, proposal, issue, cat), (j) => j && typeof j.revise === 'boolean')
      return new Map([[item.id, { revise: json.revise && json.spec, proposal: json.revise && json.spec ? shapeSpec(json.spec, t.brief, domainIds) : proposal, reason: json.reason }]])
    },
  })
  const records = results.map((r) => {
    const t = T.get(r.id)
    if (!r.proposal) return { file: r.id, status: 'failed', trail: r.trail, at: new Date().toISOString() }
    const spec = r.proposal
    // 轮次用完、核验模型仍报问题的字段先拿掉（原样保留为 source-field），其余照用；
    // 复判坚持的（disputed）以复判为准，问题记录下来供人工复核
    const fieldNames = new Set(t.brief.fields.map((f) => f.name))
    const disputed = r.outcome === 'review' && Array.isArray(r.issue?.alt) ? [...new Set(r.issue.alt.map((x) => x.field).filter((f) => fieldNames.has(f)))] : []
    for (const f of disputed) for (const [role, fs] of Object.entries(spec.roles)) { const keep = [].concat(fs).filter((x) => x !== f); if (keep.length) spec.roles[role] = keep.length === 1 ? keep[0] : keep; else delete spec.roles[role] }
    const forced = pseudonymPatientField(t.brief, t.rows, t.rowFiles)
    if (forced) spec.roles['patient.id'] = forced
    const dropped = sanitize(spec, t.brief, t.rows, domainIds, t.inferred)
    if (!forced && patientIdProblem(spec, t.brief, t.rows, t.rowFiles, t.inferred)) { if (t.inferred?.roles?.['patient.id']) spec.roles['patient.id'] = t.inferred.roles['patient.id']; else delete spec.roles['patient.id']; dropped.push('patient.id') }
    for (const x of fit(spec, t.rows)) if (!x.ok) { delete spec.domains[x.concept]; dropped.push(`值域 ${x.domain}（${x.concept}）`) }
    return {
      file: r.id, path: t.path, fields: t.brief.fields.map((f) => f.name), spec, status: r.outcome === 'review' ? 'review' : 'applied', agreement: r.outcome,
      origin: 'model', models: runner.models, rounds: r.rounds, disputed, dropped, issue: r.outcome === 'review' ? r.issue ?? null : null,
      dismissed: (r.dismissed ?? []).map((x) => ({ round: x.round, reason: x.reason, ruling: x.ruling })),
      trail: r.trail.map((x) => ({ ...x, proposal: undefined, reason: x.reason ?? x.error ?? x.note })), at: new Date().toISOString(),
    }
  })
  return { records, cross }
}
