/**
 * 有界的“起草 → 插件校验 → 独立盲审 → 复判修正”循环（与 dsh-medical-anonymizer 同一套路）。
 *
 *   第 1 轮：识别模型给出提议（propose）。
 *   插件校验（check）：从不直接相信模型——字段要存在、代码要在目标值集里、校验位要对……不合格的当作问题。
 *   独立盲审（blind）：核验模型只看“输入 + 提议”，不看识别模型的理由，找出它认为错的。
 *   第 2 轮起：识别模型对每条问题复判（adjudicate）：坚持（附理由）或改正（给新提议）；
 *     改正的回到插件校验和盲审；坚持的成为“两模型分歧”，转人工复核（不自动采用）。
 *   轮次用完仍有问题的，转人工复核。
 * 没有单独的核验模型时，用同一个模型盲审（与匿名化插件一致）。
 *
 * 每条结果：{ id, proposal, outcome: 'agreed'|'review'|'failed', rounds, trail:[...] }
 */
/**
 * @param insist 识别模型复判时坚持原结论怎么办：
 *   'review'（默认）两模型分歧，转人工；'accept' 以复判为准（与匿名化插件的复判一致），记为 disputed 供复核。
 */
export async function reviewLoop({ items, propose, check, blind, adjudicate, maxRounds = 3, batch = 20, onProgress, insist = 'review' }) {
  const state = new Map(items.map((it) => [it.id, { item: it, proposal: null, issue: null, outcome: null, rounds: 0, trail: [] }]))
  const cross = { reviewed: 0, reported: 0, revised: 0, insisted: 0, checkFailed: 0 }
  const each = async (list, fn) => {
    const parts = []
    for (let i = 0; i < list.length; i += batch) parts.push(list.slice(i, i + batch))
    let done = 0
    await Promise.all(parts.map(async (p) => { await fn(p); done += p.length; onProgress?.(done, list.length) }))
  }

  // 第 1 轮：提议
  await each(items, async (part) => {
    let got = new Map()
    try { got = await propose(part, 1) } catch (error) { for (const it of part) { const s = state.get(it.id); s.outcome = 'failed'; s.trail.push({ round: 1, step: '起草', error: String(error?.message ?? error) }) } return }
    for (const it of part) {
      const s = state.get(it.id)
      s.rounds = 1
      const p = got.get(it.id)
      if (p === undefined) { s.outcome = 'failed'; s.trail.push({ round: 1, step: '起草', error: '模型没有给出结论' }); continue }
      s.proposal = p
      s.trail.push({ round: 1, step: '起草', proposal: p })
    }
  })

  let active = [...state.values()].filter((s) => s.outcome === null)
  for (let round = 1; round <= maxRounds && active.length; round += 1) {
    // 插件校验
    for (const s of active) {
      const why = check(s.item, s.proposal)
      if (why) { s.issue = { by: 'check', reason: why }; cross.checkFailed++; s.trail.push({ round, step: '插件校验', reason: why }) } else s.issue = null
    }
    // 独立盲审（只审没被插件拦下的）
    const toReview = active.filter((s) => !s.issue && !isAbstain(s.proposal))
    if (toReview.length) {
      await each(toReview, async (part) => {
        let verdicts = new Map()
        try { verdicts = await blind(part.map((s) => ({ item: s.item, proposal: s.proposal })), round) } catch (error) {
          // 盲审没做成：不能算作“没有异议”，转人工
          for (const s of part) { s.issue = { by: 'blind-failed', reason: `盲审失败：${String(error?.message ?? error).slice(0, 160)}` }; s.trail.push({ round, step: '盲审', error: String(error?.message ?? error) }) }
          return
        }
        for (const s of part) {
          cross.reviewed++
          const v = verdicts.get(s.item.id)
          if (!v) { s.issue = { by: 'blind-failed', reason: '核验模型没有给出结论' }; s.trail.push({ round, step: '盲审', note: '核验模型没有给出结论' }); continue }
          s.trail.push({ round, step: '盲审', ok: v.ok, reason: v.reason ?? '', alt: v.alt ?? null })
          if (!v.ok) { s.issue = { by: 'verify', reason: v.reason ?? '', alt: v.alt ?? null }; cross.reported++ }
        }
      })
    }
    // 没有问题的：两模型一致（或识别模型自己放弃）
    for (const s of active) if (!s.issue) s.outcome = isAbstain(s.proposal) ? 'abstain' : 'agreed'
    for (const s of active) if (s.issue?.by === 'blind-failed') s.outcome = 'review'
    const issues = active.filter((s) => s.issue && s.outcome === null)
    if (!issues.length || round === maxRounds) { for (const s of issues) s.outcome = 'review'; break }
    // 第 round+1 轮：识别模型复判
    await each(issues, async (part) => {
      let rulings = new Map()
      try { rulings = await adjudicate(part.map((s) => ({ item: s.item, proposal: s.proposal, issue: s.issue })), round + 1) } catch (error) {
        for (const s of part) { s.outcome = 'review'; s.trail.push({ round: round + 1, step: '复判', error: String(error?.message ?? error) }) }
        return
      }
      for (const s of part) {
        s.rounds = round + 1
        const r = rulings.get(s.item.id)
        if (!r) { s.outcome = 'review'; s.trail.push({ round: round + 1, step: '复判', note: '没有给出结论' }); continue }
        if (r.revise) { s.proposal = r.proposal; cross.revised++; s.trail.push({ round: round + 1, step: '复判', revise: true, reason: r.reason ?? '', proposal: r.proposal }) } else {
          // 坚持原提议：插件校验没过的不能坚持；盲审报出的成为分歧
          cross.insisted++
          s.outcome = s.issue.by === 'verify' && insist === 'accept' ? 'disputed' : 'review'
          s.dismissed = [...(s.dismissed ?? []), { round, reason: s.issue.reason, alt: s.issue.alt ?? null, ruling: r.reason ?? '' }]
          s.trail.push({ round: round + 1, step: '复判', revise: false, reason: r.reason ?? '' })
        }
      }
    })
    active = issues.filter((s) => s.outcome === null)
  }
  for (const s of state.values()) if (s.outcome === null) s.outcome = 'review'
  return { results: [...state.values()].map((s) => ({ id: s.item.id, item: s.item, proposal: s.proposal, outcome: s.outcome, rounds: s.rounds, issue: s.issue, dismissed: s.dismissed ?? [], trail: s.trail })), cross }
}

/** A proposal that declines to answer (no confident mapping). */
export const isAbstain = (p) => p === null || p?.abstain === true
