/**
 * 就诊号关联（数据核对）：哪个字段把各表连到就诊登记上，由数据回答，不靠模型猜。
 *
 * 实测：模型给每张表挑的“门诊号 / 住院号”字段大多对不上（住院登记表甚至把机构代码当成住院号），
 * 结果几乎所有记录都挂在“登记缺失”的就诊上。做法：
 *   1. 扫描时按病人（目录）收集每张表“像编号”的字段取值；
 *   2. 就诊登记表（kind=encounter）里被其他表引用最多的字段，就是真正的就诊号；
 *   3. 每张表里取值能在这个字段里找到（≥ 60%）的字段，就是它的关联字段。
 * 只改模型起草的规格，内置规格不动；证据（命中率）记在规格里，页面上可见。
 */
import { isBlank, str, parseTime } from '../fhir/datatypes.js'

const TIME_ROLE = /^(time|record)\.|birthDate$/
const idLike = (v) => {
  if (isBlank(v) || typeof v === 'object') return false
  const s = String(v).trim()
  return s.length >= 4 && s.length <= 40 && !/\s/.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)
}

export function createLinkStats() {
  const acc = new Map() // table → { kind, drafted, fields: Map(field → { n, hits: Map(regKey → hits) }) }
  const regScore = new Map() // `${R}|${fr}` → hits from other tables
  return {
    /** One patient's records: [{ spec, row }]. */
    add(records) {
      const byTable = new Map()
      for (const r of records) {
        const t = byTable.get(r.spec.id) ?? { spec: r.spec, values: new Map() }
        byTable.set(r.spec.id, t)
        const timeFields = new Set(Object.entries(r.spec.roles ?? {}).filter(([role]) => TIME_ROLE.test(role)).flatMap(([, f]) => [].concat(f)))
        for (const [f, v] of Object.entries(r.row)) {
          if (timeFields.has(f) || !idLike(v)) continue
          let s = t.values.get(f); if (!s) t.values.set(f, (s = new Set())); s.add(str(v))
        }
      }
      // 登记表的取值索引
      const index = new Map() // value → [regKey]
      for (const [id, t] of byTable) {
        if (t.spec.kind !== 'encounter') continue
        for (const [f, s] of t.values) for (const v of s) { const k = `${id}|${f}`; const l = index.get(v); if (l) l.push(k); else index.set(v, [k]) }
      }
      if (!index.size) return
      for (const [id, t] of byTable) {
        const a = acc.get(id) ?? { kind: t.spec.kind, drafted: Boolean(t.spec.drafted), fields: new Map() }
        acc.set(id, a)
        for (const [f, s] of t.values) {
          const x = a.fields.get(f) ?? { n: 0, hits: new Map() }
          a.fields.set(f, x)
          x.n += s.size
          for (const v of s) for (const k of index.get(v) ?? []) {
            if (k.startsWith(`${id}|`)) continue
            x.hits.set(k, (x.hits.get(k) ?? 0) + 1)
            regScore.set(k, (regScore.get(k) ?? 0) + 1)
          }
        }
      }
    },
    /**
     * Fixes for drafted specs: { [tableId]: { role, field, matched, rate, previous } }.
     * @param specs Map(tableId → spec)
     */
    decide(specs) {
      const fixes = []
      // 每张登记表的就诊号：被其他表引用最多的字段
      const regKey = new Map() // R → { field, score }
      for (const [k, score] of regScore) {
        const [R, f] = k.split('|')
        if (score < 10) continue
        const cur = regKey.get(R)
        if (!cur || score > cur.score) regKey.set(R, { field: f, score })
      }
      // 同一个就诊号在所有表里必须用同一种角色（门诊号 / 住院号），否则会拆成两个就诊：按登记表的名称定
      const roleCache = new Map()
      const roleOf = (spec) => {
        if (roleCache.has(spec.id)) return roleCache.get(spec.id)
        const name = `${spec.name ?? ''} ${spec.match?.file ?? ''}`
        const r = /住院|入院|出院|病案首页/.test(name) ? 'encounter.inpatientNo' : /门\(?急?\)?诊|挂号/.test(name) ? 'encounter.outpatientNo'
          : spec.roles?.['encounter.inpatientNo'] && !spec.roles?.['encounter.outpatientNo'] ? 'encounter.inpatientNo' : 'encounter.outpatientNo'
        roleCache.set(spec.id, r)
        return r
      }
      const push = (fix, spec) => {
        fixes.push(fix)
        // 换了角色的：另一种角色若指向同一字段，拿掉
        const other = fix.role === 'encounter.inpatientNo' ? 'encounter.outpatientNo' : 'encounter.inpatientNo'
        if (fix.field && [].concat(spec.roles?.[other] ?? [])[0] === fix.field) fixes.push({ table: fix.table, role: other, field: null, previous: fix.field, evidence: `${fix.field} 已作为${fix.role === 'encounter.inpatientNo' ? '住院号' : '门诊号'}` })
      }
      for (const [R, { field, score }] of regKey) {
        const spec = specs.get(R)
        if (!spec?.drafted) continue
        const role = roleOf(spec)
        const prev = [].concat(spec.roles?.[role] ?? [])
        if (prev[0] !== field) push({ table: R, role, field, previous: prev.join('/') || null, evidence: `其他表有 ${score} 个编号能在 ${field} 里找到（就诊登记表的就诊号）` }, spec)
        else push({ table: R, role, field, previous: field, evidence: '' }, spec)
      }
      for (const [id, a] of acc) {
        const spec = specs.get(id)
        if (!spec?.drafted || a.kind === 'encounter') continue
        let best = null
        for (const [f, x] of a.fields) {
          if (x.n < 2) continue
          for (const [k, hits] of x.hits) {
            const [R, fr] = k.split('|')
            if (regKey.get(R)?.field !== fr) continue
            const rate = hits / x.n
            // 编号少时要求更高的命中率
            const need = x.n >= 10 ? 0.6 : x.n >= 4 ? 0.75 : 1
            if (rate >= need && (!best || rate > best.rate || (rate === best.rate && x.n > best.n))) best = { field: f, R, fr, rate, n: x.n }
          }
        }
        if (!best) continue
        const role = roleOf(specs.get(best.R))
        const prev = [].concat(spec.roles?.[role] ?? [])
        push({ table: id, role, field: best.field, previous: prev.join('/') || null, evidence: `${best.field} 的 ${best.n} 个编号有 ${Math.round(best.rate * 100)}% 能在 ${best.R} 的 ${best.fr} 里找到` }, spec)
        // 另一种就诊号角色如果几乎找不到对应，多半也是选错了字段：拿掉（原样保留）
        const other = role === 'encounter.inpatientNo' ? 'encounter.outpatientNo' : 'encounter.inpatientNo'
        const of = [].concat(spec.roles?.[other] ?? [])[0]
        if (of && of !== best.field) {
          const x = a.fields.get(of)
          const rate = x && x.n ? Math.max(0, ...[...x.hits.values()]) / x.n : 0
          if (rate < 0.1) fixes.push({ table: id, role: other, field: null, previous: of, evidence: `${of} 的编号在就诊登记里几乎找不到（${Math.round(rate * 100)}%）` })
        }
      }
      // 没有变化的（previous === field）不算修正
      return fixes.filter((f) => f.previous !== f.field)
    },
  }
}
