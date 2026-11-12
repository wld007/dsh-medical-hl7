/**
 * ① Schema 同构：源记录 → 公共中间模型（同构记录）。只搬不改。
 *
 * 做：表 → 记录类别（kind）；字段 → 语义角色；定主键；识别作废标记；同一角色多个备选字段取第一个有值的。
 * 不做：任何取值的解释或转换（时间、代码、单位都原样）。
 *
 * 同构记录：
 * {
 *   table, profile, kind, file, key, invalid,
 *   roles:    { <角色>: { field, raw } },           // 只含有值的角色
 *   items:    [{ index, field, raw, displayField, display, timeField, timeRaw }],   // 规格里逐项展开的字段
 *   sections: [{ title, field, raw }],              // 文书栏目
 *   extras:   [{ field, raw }],                     // 没有对应角色的字段（原样保留），含取值不同的备选字段
 * }
 */
import { isBlank, str, stableId } from '../fhir/datatypes.js'

export function recordKey(spec, row) {
  const parts = (spec.key ?? []).map((f) => str(row[f])).filter(Boolean)
  return parts.length ? parts.join('|') : stableId(JSON.stringify(row))
}

export function harmonize({ spec, profileId, row, file }) {
  const used = new Set(spec.key ?? [])
  const roles = {}
  for (const [role, fields] of Object.entries(spec.roles ?? {})) {
    const fs = [].concat(fields)
    for (const f of fs) used.add(f)
    const pick = fs.find((f) => !isBlank(row[f]))
    if (pick === undefined) continue
    roles[role] = { field: pick, raw: row[pick] }
    // 备选字段取值不同 → 不是同一信息，原样保留
    for (const g of fs) if (g !== pick && !isBlank(row[g]) && str(row[g]) !== str(row[pick])) used.delete(g)
  }
  let invalid = false
  if (spec.invalid) {
    used.add(spec.invalid.field)
    invalid = spec.invalid.values.includes(str(row[spec.invalid.field]))
  }
  const items = []
  for (const [index, it] of (spec.items ?? []).entries()) {
    const field = it.field ?? it.coded?.code
    const displayField = it.coded?.display
    for (const f of [field, displayField, it.timeField]) if (f) used.add(f)
    const raw = isBlank(row[field]) ? undefined : row[field]
    const display = displayField && !isBlank(row[displayField]) ? row[displayField] : undefined
    if (raw === undefined && display === undefined) continue
    items.push({ index, field, raw, displayField, display, timeField: it.timeField, timeRaw: it.timeField && !isBlank(row[it.timeField]) ? row[it.timeField] : undefined })
  }
  const sections = []
  for (const [field, title] of spec.sections ?? []) {
    used.add(field)
    if (!isBlank(row[field])) sections.push({ title, field, raw: row[field] })
  }
  const extras = []
  for (const [field, v] of Object.entries(row)) {
    if (used.has(field) || isBlank(v)) continue
    const raw = str(v)
    if (raw) extras.push({ field, raw })
  }
  return { table: spec.id, profile: profileId, kind: spec.kind, file, key: recordKey(spec, row), invalid, roles, items, sections, extras }
}

/** Schema-stage statistics across a batch. */
export function createSchemaStats() {
  const tables = {}
  return {
    add(h, spec) {
      const t = tables[h.table] ??= { table: h.table, kind: spec.kind, inferred: Boolean(spec.inferred), rows: 0, invalid: 0, roles: {}, extras: {}, items: {}, declaredRoles: Object.keys(spec.roles ?? {}) }
      t.rows++
      if (h.invalid) t.invalid++
      for (const [role, v] of Object.entries(h.roles)) { const r = t.roles[role] ??= { filled: 0, fields: {} }; r.filled++; r.fields[v.field] = (r.fields[v.field] ?? 0) + 1 }
      for (const it of h.items) { const k = it.field ?? it.displayField; t.items[k] = (t.items[k] ?? 0) + 1 }
      for (const e of h.extras) t.extras[e.field] = (t.extras[e.field] ?? 0) + 1
    },
    merge(other) {
      for (const [k, o] of Object.entries(other ?? {})) {
        const t = tables[k] ??= { ...o, roles: {}, extras: {}, items: {}, rows: 0, invalid: 0 }
        t.rows += o.rows; t.invalid += o.invalid
        for (const [r, v] of Object.entries(o.roles)) { const x = t.roles[r] ??= { filled: 0, fields: {} }; x.filled += v.filled; for (const [f, n] of Object.entries(v.fields)) x.fields[f] = (x.fields[f] ?? 0) + n }
        for (const [f, n] of Object.entries(o.extras)) t.extras[f] = (t.extras[f] ?? 0) + n
        for (const [f, n] of Object.entries(o.items)) t.items[f] = (t.items[f] ?? 0) + n
      }
    },
    toJSON() { return tables },
  }
}
