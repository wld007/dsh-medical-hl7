/**
 * 读输入：找数据文件、选映射规格、按病人分组。只读，不改任何源文件。
 *
 * 处理单元：输入目录下每个直接子目录各算一个单元（通常一位病人一个目录）；
 * 输入目录本身直接放着数据文件时，整个输入算一个单元。单元内按 patient.id 角色的取值分病人，
 * 取不到时归到该单元里出现最多的病人。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, basename, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { isBlank, str } from './fhir/datatypes.js'
import { inferSpec } from './mapping/infer.js'
import { checkSpec } from './mapping/roles.js'

const DATA_EXT = new Set(['.json', '.ndjson', '.jsonl', '.csv'])
export const BUILTIN_PROFILES_DIR = fileURLToPath(new URL('../profiles/', import.meta.url))

export async function walk(dir, skip = () => false, out = []) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === '_records' || e.name === '__MACOSX') continue
    const p = join(dir, e.name)
    if (skip(p)) continue
    if (e.isDirectory()) await walk(p, skip, out)
    else if (e.isFile() && DATA_EXT.has(extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

/** Load built-in profiles plus *.mjs / *.json profiles from extra directories. */
export async function loadProfiles(extraDirs = []) {
  const profiles = []
  for (const dir of [BUILTIN_PROFILES_DIR, ...extraDirs.filter(Boolean)]) {
    let names = []
    try { names = (await readdir(dir)).sort() } catch { continue }
    for (const n of names) {
      const p = join(dir, n)
      let prof
      if (n.endsWith('.mjs') || n.endsWith('.js')) prof = (await import(`${pathToFileURL(p).href}?t=${(await stat(p)).mtimeMs}`)).default
      else if (n.endsWith('.json')) prof = JSON.parse(await readFile(p, 'utf8'))
      else continue
      const problems = (prof.tables ?? []).flatMap(checkSpec)
      if (problems.length) throw new Error(`映射规格 ${n} 有问题：\n${problems.join('\n')}`)
      profiles.push({ ...prof, path: p })
    }
  }
  return profiles
}

/** Find the table spec for a file (first matching profile wins). */
export function matchSpec(profiles, file, firstRow) {
  const name = basename(file)
  for (const prof of profiles) {
    for (const spec of prof.tables ?? []) {
      const m = spec.match ?? {}
      if (m.file && m.file !== name) continue
      if (m.fileRe && !new RegExp(m.fileRe).test(name)) continue
      if (m.fields && !(firstRow && m.fields.every((f) => f in firstRow))) continue
      if (!m.file && !m.fileRe && !m.fields) continue
      return { profile: prof, spec }
    }
  }
  return null
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []
    } else cell += ch
  }
  row.push(cell); if (row.some((c) => c !== '')) rows.push(row)
  const [head, ...body] = rows
  if (!head) return []
  head[0] = head[0].replace(/^\uFEFF/, '')
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export async function readRows(file) {
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
  const ext = extname(file).toLowerCase()
  if (ext === '.csv') return parseCsv(text)
  if (ext === '.ndjson' || ext === '.jsonl') return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const data = JSON.parse(text)
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.rows) ? data.rows : [data]
  return rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r))
}

/**
 * Processing units.
 * - The input has data files directly in it → one unit.
 * - Otherwise each immediate sub-directory is a candidate. A sample file from each is read for its
 *   patient key: if two sub-directories hold the same patient, the sub-directories are categories of
 *   one patient (e.g. 检验/、诊断/), so the whole input is one unit. Otherwise one unit per sub-directory.
 */
export async function findUnits(input, skip, profiles = []) {
  const st = await stat(input)
  if (st.isFile()) return [{ name: basename(input, extname(input)), dir: input, files: [input] }]
  const entries = (await readdir(input, { withFileTypes: true })).filter((e) => !e.name.startsWith('.') && e.name !== '_records')
  const direct = entries.filter((e) => e.isFile() && DATA_EXT.has(extname(e.name).toLowerCase()))
  const whole = async () => [{ name: basename(input), dir: input, files: await walk(input, skip) }]
  if (direct.length) return whole()
  const units = []
  for (const e of entries.filter((x) => x.isDirectory())) {
    const dir = join(input, e.name)
    if (skip(dir)) continue
    const files = await walk(dir, skip)
    if (files.length) units.push({ name: e.name, dir, files })
  }
  if (units.length < 2) return units
  const owner = new Map()
  for (const u of units) {
    const key = await samplePatientKey(u.files, profiles)
    if (key === undefined) continue
    if (owner.has(key)) return whole()
    owner.set(key, u.name)
  }
  return units
}

async function samplePatientKey(files, profiles) {
  for (const file of files.slice(0, 5)) {
    let rows
    try { rows = await readRows(file) } catch { continue }
    if (!rows.length) continue
    const spec = matchSpec(profiles, file, rows[0])?.spec ?? inferSpec(file, rows)
    for (const f of [].concat(spec.roles?.['patient.id'] ?? [])) {
      const v = rows.map((r) => r[f]).find((x) => !isBlank(x))
      if (v !== undefined) return str(v)
    }
  }
  return undefined
}

/**
 * Read one unit, choose specs and group rows by patient.
 * @returns { patients: Map<patientKey, { records, folders:Set }>, inferred: Map<specId, spec>, unmatched: [], errors: [], profilesUsed:Set }
 */
export async function readUnit(unit, profiles, inputRoot, inferredCache = new Map()) {
  const patients = new Map()
  const orphans = []
  const errors = []
  const profilesUsed = new Set()
  const tablesUsed = {}
  for (const file of unit.files) {
    const rel = relative(inputRoot, file) || basename(file)
    let rows
    try { rows = await readRows(file) } catch (error) { errors.push({ file: rel, error: String(error?.message ?? error) }); continue }
    if (!rows.length) continue
    let hit = matchSpec(profiles, file, rows[0])
    if (!hit) {
      const key = basename(file)
      let spec = inferredCache.get(key)
      if (!spec) { spec = inferSpec(file, rows); inferredCache.set(key, spec) }
      hit = { profile: { id: 'auto', timezone: profiles[0]?.timezone }, spec }
    }
    profilesUsed.add(hit.profile.id)
    tablesUsed[hit.spec.id] = (tablesUsed[hit.spec.id] ?? 0) + rows.length
    const pidFields = [].concat(hit.spec.roles?.['patient.id'] ?? [])
    for (const row of rows) {
      const pk = pidFields.map((f) => row[f]).find((v) => !isBlank(v))
      const rec = { spec: hit.spec, profileId: hit.profile.id, row, file: rel }
      if (pk === undefined) { orphans.push(rec); continue }
      const k = str(pk)
      const p = patients.get(k) ?? { records: [] }
      p.records.push(rec)
      patients.set(k, p)
    }
  }
  // 取不到病人编号的记录：单元里只有一位（或明显以一位为主）时归给他
  let orphaned = 0
  if (orphans.length) {
    const top = [...patients.entries()].sort((a, b) => b[1].records.length - a[1].records.length)
    if (top.length === 1 || (top.length > 1 && top[0][1].records.length > 0.9 * top.reduce((s, [, p]) => s + p.records.length, 0))) {
      top[0][1].records.push(...orphans)
    } else orphaned = orphans.length
  }
  return { patients, errors, orphaned, profilesUsed, tablesUsed }
}
