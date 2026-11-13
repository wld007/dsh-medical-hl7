/**
 * ③ 术语对照的模型部分。实测：模型凭记忆给的 LOINC 代码约一半校验位都不对，校验位对的也常常张冠李戴
 * （如把白细胞计数的代码给嗜酸性粒细胞），核验模型同样凭记忆，也拦不住。所以：
 *
 *   候选只来自本地代码表（LOINC / SNOMED CT），模型只能在候选里选——闭集选择，和值域归一一样。
 *   1. 检索：识别模型把本地概念改写成检索要素（英文组分、标本系统、属性、标尺……），插件在代码表里取前 12 个候选；
 *   2. 选择：识别模型在候选里选一个，或者都不合适（null）；插件校验所选代码必须在候选里；
 *   3. 独立盲选：核验模型看同样的候选、不看识别模型的选择，自己选一个；两者相同才算一致；
 *   4. 复判：不一致时识别模型看核验模型的选择和理由，改选或坚持；坚持的转人工复核，不自动采用。
 * 没有配置代码表的目标（或其他标准，如 GB/T 6565）不交给模型，报告里说明。
 *
 * 发给模型的：本地代码、名称，上下文（组合项目、单位、标本、结果样例），以及候选的代码和名称。
 */
import { search, propertyFromUnit } from './codetable.js'
import { reviewLoop, isAbstain } from './loop.js'

const EQ = ['equivalent', 'wider', 'narrower', 'inexact']
const conceptBrief = (it) => ({ id: it.id, code: it.code ?? null, name: it.display ?? null, ...(it.ctx && Object.keys(it.ctx).length ? { context: it.ctx } : {}) })
const isLoinc = (b) => b.target.system === 'http://loinc.org'

export function queryPrompt(b, list) {
  const shape = isLoinc(b)
    ? '{"r":[{"id":"概念编号","terms":["英文组分名","英文同义词"],"system":"LOINC 系统（Ser/Plas、Bld、Urine、BldA、CSF…，不确定就空）","property":"LOINC 属性（MCnc、SCnc、CCnc、NCnc、NFr、PrThr、Type…，不确定就空）","scale":"Qn|Ord|Nom|Nar 或空"}]}'
    : '{"r":[{"id":"概念编号","terms":["英文术语","同义词"],"semantic":"SNOMED 语义标签（finding、disorder、specimen、qualifier value、substance…）"}]}'
  return [{ role: 'user', content: `任务：为了在 ${b.target.name} 代码表里检索，请把下列本地概念改写成检索要素。对照：${b.name}。
要求：terms 给英文名称（${isLoinc(b) ? 'LOINC 组分写法，如 Creatinine、Hemoglobin、Leukocytes' : 'SNOMED CT 英文术语'}）及常见同义词，1–4 个；结合上下文（组合项目、单位、标本、结果样例）判断；不认识的概念 terms 给空数组。
不要给代码。只输出 JSON：${shape}

概念：${JSON.stringify(list.map(conceptBrief))}` }]
}

const choiceBody = (b, list) => JSON.stringify(list.map((it) => ({ ...conceptBrief(it), candidates: it.candidates.map((c, i) => ({ n: i + 1, code: c.code, name: c.display, ...(c.zh ? { zh: c.zh } : {}), ...(c.property ? { property: c.property, system: c.system, scale: c.scale, units: c.units } : {}), ...(c.semantic ? { semantic: c.semantic } : {}) })) })))
const RULES = (b) => `判断要点：含义一致（组分 / 标本系统 / 属性：质量浓度 MCnc 与物质的量浓度 SCnc 按本地单位区分，计数 NCnc 与百分比 NFr 区分 / 标尺 / 方法）。候选里没有合适的就给 null，不要将就。equivalence：equivalent 等价 / wider 目标更宽 / narrower 目标更窄 / inexact 近似。`

export function choosePrompt(b, list) {
  return [{ role: 'user', content: `任务：为每个本地概念，从给出的 ${b.target.name} 候选里选出对应的代码。只能选候选里的代码。
${RULES(b)}
输出 JSON：{"r":[{"id":"概念编号","code":"所选候选的代码或 null","equivalence":"equivalent","reason":"简短依据"}]}

概念与候选：${choiceBody(b, list)}` }]
}

export function blindChoosePrompt(b, list) {
  return [{ role: 'user', content: `你是一名独立的术语审查员。为每个本地概念，从给出的 ${b.target.name} 候选里独立选出对应的代码（你看不到别人的选择）。只能选候选里的代码。
${RULES(b)}
输出 JSON：{"r":[{"id":"概念编号","code":"所选候选的代码或 null","reason":"简短依据"}]}

概念与候选：${choiceBody(b, list)}` }]
}

export function adjudicateChoicePrompt(b, list) {
  return [{ role: 'user', content: `任务：下列概念，你的选择与独立审查员（或插件校验）的结论不同。请复判：对方对就改选（可改成对方的代码、别的候选或 null）；你对就坚持并说明理由。只能选候选里的代码。
${RULES(b)}
输出 JSON：{"r":[{"id":"概念编号","revise":true或false,"code":"…或 null","equivalence":"…","reason":"简短理由"}]}

待复判：${JSON.stringify(list.map(({ item, proposal, issue }) => ({ id: item.id, yours: proposal.code ?? null, reviewer: issue.alt ?? null, problem: issue.reason })))}
概念与候选：${choiceBody(b, list.map((x) => x.item))}` }]
}

const shapeChoice = (x) => {
  const code = x?.code === null || x?.code === undefined || x?.code === '' ? null : String(x.code).trim()
  if (!code) return { abstain: true, reason: String(x?.reason ?? '') }
  return { code, equivalence: EQ.includes(x?.equivalence) ? x.equivalence : 'equivalent', reason: String(x?.reason ?? '') }
}

/**
 * @param work [{ binding, concepts:[{key,scope,code,display,count,ctx}] }]
 * @param tables Map(system → code table)
 * @returns { decisions, cross, skipped }
 */
export async function suggestTerms({ work, runner, maxRounds, tables, signal, onProgress }) {
  const decisions = []
  const skipped = []
  const cross = { reviewed: 0, reported: 0, revised: 0, insisted: 0, checkFailed: 0, retrieved: 0, noCandidates: 0 }
  const runnable = []
  for (const w of work) {
    const table = tables?.get(w.binding.target.system)
    if (table) runnable.push({ ...w, table }); else skipped.push({ binding: w.binding.id, name: w.binding.name, target: w.binding.target.name, concepts: w.concepts.length, reason: `未配置 ${w.binding.target.name} 本地代码表；模型直接给出的代码不可靠，未提交模型` })
  }
  let done = 0; const total = runnable.reduce((n, w) => n + w.concepts.length, 0)
  await Promise.all(runnable.map(async ({ binding: b, concepts, table }) => {
    const items = concepts.map((c, i) => ({ ...c, id: `c${i + 1}` }))
    const byId = new Map(items.map((x) => [x.id, x]))
    const ask = async (role, phase, round, msgs, n) => {
      const { json } = await runner.askJson(role, { phase, round, items: n }, msgs, { signal, validate: (j) => Array.isArray(j?.r), maxTokens: 4000 })
      return new Map(json.r.filter((x) => byId.has(String(x?.id))).map((x) => [String(x.id), x]))
    }
    // 1. 检索要素 → 候选
    for (let i = 0; i < items.length; i += 20) {
      const part = items.slice(i, i + 20)
      let q = new Map()
      try { q = await ask('suggest', '术语检索', 1, queryPrompt(b, part), part.length) } catch { /* 用本地名称检索 */ }
      for (const it of part) {
        const x = q.get(it.id) ?? {}
        const unit = it.ctx?.unit?.[0]
        it.candidates = search(table, { terms: Array.isArray(x.terms) ? x.terms : [], local: it.display, system: x.system || undefined, property: x.property || propertyFromUnit(unit) || undefined, scale: x.scale || undefined, semantic: x.semantic || undefined, unit })
        if (it.candidates.length) cross.retrieved++; else cross.noCandidates++
      }
    }
    const withCands = items.filter((it) => it.candidates.length)
    for (const it of items.filter((x) => !x.candidates.length)) decisions.push({ binding: b.id, mapping: { key: it.key, from: { scope: it.scope ?? undefined, code: it.code ?? undefined, display: it.display ?? undefined }, to: null, equivalence: 'unmatched', status: 'pending', note: `${table.name} 代码表里检索不到候选`, origin: 'model', models: runner.models } })
    // 2–4. 选择 → 盲选 → 复判
    const { results, cross: c } = await reviewLoop({
      items: withCands, maxRounds, batch: 10, onProgress: (n) => onProgress?.(done + n, total),
      propose: async (list, round) => new Map([...(await ask('suggest', '术语选择', round, choosePrompt(b, list), list.length))].map(([id, x]) => [id, shapeChoice(x)])),
      check: (it, p) => (isAbstain(p) || it.candidates.some((x) => x.code === p.code) ? null : `${p.code} 不在候选里`),
      blind: async (list, round) => {
        const got = await ask('verify', '术语盲选', round, blindChoosePrompt(b, list.map((x) => x.item)), list.length)
        return new Map(list.map(({ item, proposal }) => {
          const v = got.get(item.id)
          if (!v) return [item.id, undefined]
          const pick = v.code ? String(v.code).trim() : null
          return [item.id, { ok: pick === proposal.code, reason: pick === proposal.code ? '' : `审查员独立选择：${pick ?? '都不合适'}（${v.reason ?? ''}）`, alt: pick ? { code: pick, display: item.candidates.find((x) => x.code === pick)?.display ?? '' } : null }]
        }).filter(([, v]) => v))
      },
      adjudicate: async (list, round) => {
        const got = await ask('suggest', '术语复判', round, adjudicateChoicePrompt(b, list), list.length)
        return new Map([...got].map(([id, x]) => [id, { revise: x.revise === true, proposal: shapeChoice(x), reason: String(x.reason ?? '') }]))
      },
    })
    done += withCands.length
    for (const k of Object.keys(c)) cross[k] += c[k]
    for (const r of results) {
      if (r.outcome === 'failed') continue
      const it = byId.get(r.id)
      const p = r.proposal
      const from = { scope: it.scope ?? undefined, code: it.code ?? undefined, display: it.display ?? undefined }
      const cand = (code) => it.candidates.find((x) => x.code === code)
      const base = { key: it.key, from, origin: 'model', models: runner.models, rounds: r.rounds, verifiedBy: `本地 ${table.name} 代码表`, trail: r.trail.map((x) => ({ round: x.round, step: x.step, ok: x.ok, revise: x.revise, reason: x.reason ?? x.error ?? x.note })) }
      let mapping
      if (r.outcome === 'agreed') mapping = { ...base, to: { code: p.code, display: cand(p.code)?.display ?? '' }, equivalence: p.equivalence, status: 'confirmed', note: `两模型独立选出同一代码：${p.reason}` }
      else if (r.outcome === 'abstain') mapping = { ...base, to: null, equivalence: 'unmatched', status: 'pending', note: `候选里没有合适的：${p?.reason ?? ''}`, candidates: it.candidates.slice(0, 5).map((x) => ({ code: x.code, display: x.display, by: 'search' })) }
      else mapping = { ...base, to: null, equivalence: 'unmatched', status: 'pending', note: `两模型选择不同，待人工复核。${r.issue?.reason ?? ''}`, candidates: [p && !isAbstain(p) ? { code: p.code, display: cand(p.code)?.display ?? '', by: 'suggest' } : null, r.issue?.alt?.code ? { code: r.issue.alt.code, display: r.issue.alt.display ?? '', by: 'verify' } : null].filter(Boolean) }
      decisions.push({ binding: b.id, mapping })
    }
  }))
  return { decisions, cross, skipped }
}
