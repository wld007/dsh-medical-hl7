/**
 * ② 值域归一的模型部分：对照表里没有的取值（“无对照”），请模型给出规范值，经插件校验、独立盲审、复判后写入对照表。
 * 含义取决于源系统约定的（“待确认”）不交给模型：模型也不知道，猜了反而有害。
 *
 * 发给模型的：值域说明、目标值集、源取值（代码、名称）、出现在哪些字段、次数。
 */
import { reviewLoop, isAbstain } from './loop.js'

const VERDICTS = ['map', 'text', 'invalid', 'unsure']
const UCUM_LIKE = /^[A-Za-z0-9%.\/*^'\[\]{}()_-]{1,40}$/

const domainBrief = (d) => ({
  id: d.id, name: d.name, description: d.description ?? '',
  target: d.target ? { name: d.target.name, open: Boolean(d.target.open), values: d.target.open ? undefined : (d.target.values ?? []).map((v) => ({ code: v.code, name: v.label ?? v.display })) } : null,
  // 已确认的对照（示例）：让模型看到这个值域在数据里实际是怎么编码的
  known: (d.entries ?? []).filter((e) => e.status === 'confirmed' && e.source !== 'model').slice(0, 15).map((e) => ({ code: e.code ?? null, name: e.display ?? null, to: e.to })),
})
const NO_GUESS = `硬性要求：
1. 依据只能是取值本身、值域说明、已有对照和公认标准（如 GB/T 2261、WS 364、UCUM）；不要用“通常”“常见”“推测”之类的理由——没有依据就选 unsure。
2. 纯数字或字母代码，除非值域说明或已有对照写明了它的含义，一律选 unsure。
3. 看起来是别的字段误填进来的（年龄、日期时间、编号、假名“证件-xxxxxx”、人名、诊断名称……）选 invalid。
4. 代码和名称冲突时以名称为准。`
const valueBrief = (it) => ({ id: it.id, code: it.code ?? null, name: it.display ?? null, count: it.count, fields: Object.keys(it.fields ?? {}).slice(0, 3) })

export function valuePrompt(d, list) {
  return [{ role: 'user', content: `任务：下面是源数据里某个值域中还没有对照的取值。请把每个取值归一到目标值集。
结论（verdict）只能是：
- "map"：属于本值域，给出目标值集中的代码 to${d.target?.open ? '（目标值集开放：给出规范写法，如 UCUM 单位代码）' : '（必须逐字取自目标值集）'}
- "text"：属于这个字段的正常内容，但本身是描述性文字，不是规范值（按原文保留）
- "invalid"：不属于这个值域（填错字段、无意义的值）
- "unsure"：含义取决于源系统的约定、没有依据判断——此时必须选 unsure，不要猜
${NO_GUESS}
输出 JSON：{"r":[{"id":"取值编号","verdict":"map","to":"目标代码或 null","reason":"简短依据"}]}，每个取值一条。

值域：${JSON.stringify(domainBrief(d))}
取值：${JSON.stringify(list.map(valueBrief))}` }]
}

export function blindValuePrompt(d, list) {
  return [{ role: 'user', content: `你是一名独立的数据质量审查员。下面是某个值域中源取值的归一结论（由另一人给出，你不知道其理由）。请逐条判断结论是否正确。
判断要点：取值的含义是否与目标值一致；“text”是否确属描述性内容；“invalid”是否确实不属于这个值域。
凡是靠“通常”“常见编码”推断出来的 map（尤其是纯数字代码），一律判为不正确——应当是 unsure。拿不准时判为不正确并说明。
输出 JSON：{"r":[{"id":"取值编号","ok":true或false,"reason":"简短理由","alt":{"verdict":"你的结论","to":"你的目标代码或 null"}}]}

值域：${JSON.stringify(domainBrief(d))}
结论：${JSON.stringify(list.map(({ item, proposal }) => ({ ...valueBrief(item), verdict: proposal.verdict, to: proposal.to ?? null })))}` }]
}

export function adjudicateValuePrompt(d, list) {
  return [{ role: 'user', content: `任务：你给出的下列归一结论被审查员（或插件校验）指出了问题。请逐条复判：问题成立就改正（给出新的 verdict 和 to）；不成立就坚持并说明理由。
verdict 只能是 map / text / invalid / unsure；map 的 to 必须${d.target?.open ? '是规范写法' : '逐字取自目标值集'}。
输出 JSON：{"r":[{"id":"取值编号","revise":true或false,"verdict":"…","to":"…或 null","reason":"简短理由"}]}

值域：${JSON.stringify(domainBrief(d))}
待复判：${JSON.stringify(list.map(({ item, proposal, issue }) => ({ ...valueBrief(item), yours: { verdict: proposal.verdict, to: proposal.to ?? null }, problem: issue.reason, reviewer: issue.alt ?? undefined })))}` }]
}

const shape = (x) => {
  const verdict = VERDICTS.includes(x?.verdict) ? x.verdict : 'unsure'
  if (verdict === 'unsure') return { abstain: true, verdict, reason: String(x?.reason ?? '') }
  return { verdict, to: verdict === 'map' ? (x?.to === null || x?.to === undefined ? null : String(x.to).trim()) : null, reason: String(x?.reason ?? '') }
}

/**
 * @param work [{ domain, values:[{code,display,count,fields}] }]
 * @returns { decisions: [{ domain, code, display, entry }], cross }
 */
export async function suggestValues({ work, runner, maxRounds, signal, onProgress }) {
  const decisions = []
  const cross = { reviewed: 0, reported: 0, revised: 0, insisted: 0, checkFailed: 0 }
  let done = 0; const total = work.reduce((n, w) => n + w.values.length, 0)
  await Promise.all(work.map(async ({ domain: d, values }) => {
    const items = values.map((v, i) => ({ ...v, id: `v${i + 1}` }))
    const byId = new Map(items.map((x) => [x.id, x]))
    const codes = new Set((d.target?.values ?? []).map((v) => v.code))
    const ask = async (role, phase, round, msgs, n) => {
      const { json } = await runner.askJson(role, { phase, round, items: n }, msgs, { signal, validate: (j) => Array.isArray(j?.r), maxTokens: 3000 })
      return new Map(json.r.filter((x) => byId.has(String(x?.id))).map((x) => [String(x.id), x]))
    }
    const { results, cross: c } = await reviewLoop({
      items, maxRounds, batch: 25, onProgress: (n) => onProgress?.(done + n, total),
      propose: async (list, round) => new Map([...(await ask('suggest', '值域归一', round, valuePrompt(d, list), list.length))].map(([id, x]) => [id, shape(x)])),
      check: (it, p) => {
        if (isAbstain(p) || p.verdict !== 'map') return null
        if (!p.to) return 'verdict 为 map 却没有给出 to'
        if (d.target?.open) return UCUM_LIKE.test(p.to) ? null : `“${p.to}”不像规范写法`
        return codes.has(p.to) ? null : `“${p.to}”不在目标值集里（可选：${[...codes].join('、')}）`
      },
      blind: async (list, round) => {
        const got = await ask('verify', '值域盲审', round, blindValuePrompt(d, list), list.length)
        return new Map([...got].map(([id, x]) => [id, { ok: x.ok === true, reason: String(x.reason ?? ''), alt: x.alt ?? null }]))
      },
      adjudicate: async (list, round) => {
        const got = await ask('suggest', '值域复判', round, adjudicateValuePrompt(d, list), list.length)
        return new Map([...got].map(([id, x]) => [id, { revise: x.revise === true, proposal: shape(x), reason: String(x.reason ?? '') }]))
      },
    })
    done += items.length
    for (const k of Object.keys(cross)) cross[k] += c[k]
    for (const r of results) {
      if (r.outcome === 'failed') continue
      const it = byId.get(r.id)
      const p = r.proposal
      const base = { origin: 'model', models: runner.models, rounds: r.rounds }
      let entry
      if (r.outcome === 'agreed') {
        entry = p.verdict === 'map' ? { to: p.to, status: 'confirmed', note: `模型：${p.reason}` } : { to: null, status: p.verdict, note: `模型：${p.reason}` }
      } else if (r.outcome === 'abstain') {
        entry = { to: null, status: 'pending', note: `模型无法判断：${p?.reason ?? ''}` }
      } else {
        entry = { to: null, status: 'pending', note: `两模型有分歧，待人工复核。识别：${p ? `${p.verdict}${p.to ? ` → ${p.to}` : ''}（${p.reason}）` : '—'}；核验：${r.issue?.reason ?? ''}`, candidate: p && !isAbstain(p) ? { verdict: p.verdict, to: p.to } : null }
      }
      decisions.push({ domain: d.id, code: it.code ?? undefined, display: it.display ?? undefined, entry: { ...entry, ...base, trail: r.trail.map((x) => ({ round: x.round, step: x.step, ok: x.ok, revise: x.revise, reason: x.reason ?? x.error ?? x.note })) } })
    }
  }))
  return { decisions, cross }
}
