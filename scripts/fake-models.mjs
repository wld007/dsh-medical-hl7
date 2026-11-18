/**
 * 本机假模型端点（OpenAI 兼容，只给演示和预览用）：按提示里的任务类型给出确定的回答。
 * 两个“模型”故意在少数项上意见不同，好让流水线上看得见盲审、复查和人工复核。
 *   suggest = 识别模型，verify = 核验模型（按请求里的 model 区分）。
 */
import http from 'node:http'

const tail = (p, label) => JSON.parse(p.slice(p.lastIndexOf(label) + label.length).trim())
// 演示数据（scripts/demo-data.mjs）的字段 → 角色；按记录类别取
const FIELD_ROLES = {
  PATIENT_ID: 'patient.id', ORG_CD: 'org.code', VISIT_NO: 'encounter.outpatientNo', INHOSP_NO: 'encounter.inpatientNo', DEPT_NM: 'dept.name',
  REG_TM: { encounter: 'time.start' }, ADM_TM: { encounter: 'time.start' }, DIS_TM: { encounter: 'time.end' }, DOCTOR_NM: { encounter: 'actor.attender.name' },
  DIAG_CD: { condition: 'code.code' }, DIAG_NM: { condition: 'code.display' }, DIAG_TM: { condition: 'time.recorded' },
  RPT_NO: { lab: 'report.no' }, ITEM_CD: { lab: 'item.code' }, ITEM_NM: { lab: 'item.display' }, RSLT_VAL: { lab: 'value' }, RSLT_UNIT: { lab: 'unit' }, REF_RANGE: { lab: 'refRange' }, TEST_TM: { lab: 'time.effective' },
  DRUG_CD: { medication: 'drug.code' }, DRUG_NM: { medication: 'drug.display' }, DOSE: { medication: 'dose.value' }, DOSE_UNIT: { medication: 'dose.unit' }, FREQ: { medication: 'frequency.display' }, ROUTE: { medication: 'route.display' }, PRESC_TM: { medication: 'time.authored' },
  FEE_ITEM_CD: { charge: 'item.code' }, FEE_ITEM_NM: { charge: 'item.display' }, QTY: { charge: 'quantity' }, PRICE: { charge: 'unitPrice' }, AMOUNT: { charge: 'total' }, FEE_TM: { charge: 'time.occurrence' },
  OPR_CD: { procedure: 'code.code' }, OPR_NM: { procedure: 'code.display' }, OPR_TM: { procedure: 'time.performed' }, SURGEON_NM: { procedure: 'actor.surgeon.name' },
  DOC_TM: { document: 'time.authored' }, FLW_TM: { document: 'time.authored' }, FLW_DCT: { document: 'actor.author.name' },
  NAME: { patient: 'name' }, SEX_CD: { patient: 'gender.code' }, BIRTH_DT: { patient: 'birthDate' },
}
const KINDS = [[/检验|lab/i, 'lab'], [/诊断|diagnos/i, 'condition'], [/挂号|入出院|登记/i, 'encounter'], [/手术|surgery/i, 'procedure'], [/处方|医嘱|medic/i, 'medication'], [/费用|charge/i, 'charge'], [/小结|随访|记录/i, 'document']]

function answer(model, p) {
  const verify = /verify|gemma/.test(model)
  if (p.includes('起草它到公共中间模型的映射规格')) {
    const brief = tail(p, '表：')
    const fields = new Set((brief.fields ?? []).map((f) => f.name))
    const name = String(brief.table ?? '')
    const kind = KINDS.find(([re]) => re.test(name))?.[1] ?? (/病人|基本信息/.test(name) ? 'patient' : 'document')
    const roles = {}
    for (const [f, byKind] of Object.entries(FIELD_ROLES)) {
      if (!fields.has(f)) continue
      const role = typeof byKind === 'string' ? byKind : byKind[kind]
      if (role) roles[role] = f
    }
    const domains = {}
    if (roles.unit) domains.unit = 'ucum-unit'
    if (roles['dose.unit']) domains['dose.unit'] = 'ucum-unit'
    const sections = [['SUMMARY_TXT', '出院小结'], ['FLW_RESULT', '随访结果']].filter(([f]) => fields.has(f))
    return { kind, name: name.replace(/\.json$/, ''), key: ['REC_ID'], roles, domains, sections }
  }
  if (p.includes('独立的数据映射审查员')) {
    const spec = tail(p, '映射：')
    const dct = (spec.roles ?? []).find((x) => x.role === 'actor.author.name')?.fields?.[0]
    return dct ? { ok: false, issues: [{ field: dct, problem: '这个医生字段是随访医生，不是记录作者', suggest: 'actor.performer.name', reason: '字段名为随访医生' }] } : { ok: true, issues: [] }
  }
  if (p.includes('你起草的映射规格被审查员')) return { revise: false, reason: '随访记录由随访医生书写，就是作者' }
  if (p.includes('值域中还没有对照的取值')) return { r: tail(p, '取值：').map((x) => (/μIU|uIU/i.test(x.name ?? '') ? { id: x.id, verdict: 'map', to: 'u[IU]/mL', reason: 'μ 即 u（微）' } : { id: x.id, verdict: 'unsure', to: null, reason: '含义不明' })) }
  if (p.includes('独立的数据质量审查员')) return { r: tail(p, '结论：').map((x) => ({ id: x.id, ok: false, reason: '应为 m[IU]/mL（毫国际单位）', alt: 'm[IU]/mL' })) }
  if (p.includes('你给出的下列归一结论被审查员')) { const ids = [...new Set([...p.matchAll(/"id":"(v\d+)"/g)].map((m) => m[1]))]; return { r: ids.map((id) => ({ id, revise: false, verdict: 'map', to: 'u[IU]/mL', reason: 'μ 是微，不是毫' })) } }
  if (p.includes('改写成检索要素')) { const EN = { 肌酐: ['Creatinine'], 葡萄糖: ['Glucose'], 胰岛素: ['Insulin'], 白细胞: ['Leukocytes'] }; return { r: tail(p, '概念：').map((x) => ({ id: x.id, terms: EN[x.name] ?? [] })) } }
  if (p.includes('你的选择与独立审查员')) { const r = JSON.parse(p.slice(p.indexOf('待复判：') + 4, p.indexOf('\n概念与候选：'))); return { r: r.map((x) => ({ id: x.id, revise: false, reason: '按单位' })) } }
  if (p.includes('选出对应的代码')) return { r: tail(p, '概念与候选：').map((x) => ({ id: x.id, code: (verify ? x.candidates.at(-1) : x.candidates[0])?.code ?? null, equivalence: 'equivalent', reason: verify ? '更接近' : '按单位' })) }
  return {}
}

export async function startFakeModels({ delayMs = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'suggest-model' }, { id: 'verify-model' }] })
    const q = JSON.parse(body || '{}')
    const p = q.messages?.at(-1)?.content ?? ''
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs * (0.6 + Math.random() * 0.8)))
    let out = {}
    try { out = answer(q.model ?? '', p) } catch { out = {} }
    send(200, { choices: [{ message: { role: 'assistant', content: JSON.stringify(out) } }], usage: { prompt_tokens: Math.round(p.length / 2), completion_tokens: 60, total_tokens: Math.round(p.length / 2) + 60 } })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() }
}
