/**
 * 本机对照库：<vocabDir>/vocab.sqlite（权限 0600）。存人工复核和模型给出的对照，所有输出根目录、所有批次共用。
 *
 *   domain_entries  值域条目的当前值（值域 + 条目键）       ——原 <vocabDir>/domains/<值域>.json
 *   term_mappings   术语对照的当前值（绑定 + 源概念键）     ——原 <vocabDir>/terminology/<绑定>.json
 *   specs           模型起草的映射规格（按表文件名）         ——原 <vocabDir>/specs/<表>.json
 *   vocab_log       每一次改动（只追加，审计用）：谁（用户 / 模型）、什么时候、改成了什么
 *
 * 旧的 JSON 文件在第一次打开库时并入一次，原文件留在原处、此后不再写。
 * 没有 node:sqlite 时退回旧的 JSON 文件读写。
 */
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { loadSqlite } from '../records.js'

export const VOCAB_FILE = 'vocab.sqlite'
const SCHEMA_VERSION = 1
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS domain_entries (
     domain TEXT NOT NULL, key TEXT NOT NULL, origin TEXT, status TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL,
     PRIMARY KEY (domain, key)
   );
   CREATE TABLE IF NOT EXISTS term_mappings (
     binding TEXT NOT NULL, key TEXT NOT NULL, origin TEXT, status TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL,
     PRIMARY KEY (binding, key)
   );
   CREATE TABLE IF NOT EXISTS specs (
     file TEXT PRIMARY KEY, status TEXT, origin TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS vocab_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL, target TEXT NOT NULL, key TEXT NOT NULL,
     action TEXT NOT NULL, origin TEXT, by TEXT, data TEXT, at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS vocab_log_target ON vocab_log (kind, target, key);`,
]

export const entryKey = (e) => `${e.code ?? ''}\u0001${e.display ?? ''}`
const now = () => new Date().toISOString()
async function exists(p) { try { await stat(p); return true } catch { return false } }
async function readJson(p, fallback) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return fallback } }
async function walkJson(dir, out = []) {
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) { const p = join(dir, e.name); if (e.isDirectory()) await walkJson(p, out); else if (e.name.endsWith('.json')) out.push(p) }
  return out
}
const idOf = (root, p) => relative(root, p).replace(/\\/g, '/').replace(/\.json$/, '')
const safeFile = (file) => String(file).replace(/[\\/:*?"<>|]+/g, '_').replace(/\.json$/i, '')

/* ------------------------------------------------------------------ sqlite */
function sqliteStore(DatabaseSync, path) {
  const db = new DatabaseSync(path)
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;')
    const v = db.prepare('PRAGMA user_version').get().user_version
    if (v > SCHEMA_VERSION) throw new Error(`对照库 ${path} 的版本（${v}）比本插件新（${SCHEMA_VERSION}），请升级插件`)
    for (let i = v; i < SCHEMA_VERSION; i++) tx(() => { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`) })
  } catch (e) { db.close(); throw e }
  const q = {
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    dAll: db.prepare('SELECT domain, data FROM domain_entries ORDER BY domain, key'),
    dGet: db.prepare('SELECT data FROM domain_entries WHERE domain = ? AND key = ?'),
    dDel: db.prepare('DELETE FROM domain_entries WHERE domain = ? AND key = ?'),
    dModel: db.prepare("SELECT domain, key, data FROM domain_entries WHERE origin = 'model'"),
    tDel: db.prepare('DELETE FROM term_mappings WHERE binding = ? AND key = ?'),
    tModel: db.prepare("SELECT binding, key, data FROM term_mappings WHERE origin = 'model'"),
    dPut: db.prepare('INSERT INTO domain_entries (domain, key, origin, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(domain, key) DO UPDATE SET origin = excluded.origin, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at'),
    tAll: db.prepare('SELECT binding, data FROM term_mappings ORDER BY binding, key'),
    tGet: db.prepare('SELECT data FROM term_mappings WHERE binding = ? AND key = ?'),
    tPut: db.prepare('INSERT INTO term_mappings (binding, key, origin, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(binding, key) DO UPDATE SET origin = excluded.origin, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at'),
    sAll: db.prepare('SELECT data FROM specs ORDER BY file'),
    sGet: db.prepare('SELECT data FROM specs WHERE file = ?'),
    sPut: db.prepare('INSERT INTO specs (file, status, origin, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(file) DO UPDATE SET status = excluded.status, origin = excluded.origin, data = excluded.data, updated_at = excluded.updated_at'),
    log: db.prepare('INSERT INTO vocab_log (kind, target, key, action, origin, by, data, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    history: db.prepare('SELECT action, origin, by, data, at FROM vocab_log WHERE kind = ? AND target = ? AND key = ? ORDER BY id'),
    stamp: db.prepare("SELECT (SELECT COUNT(*) FROM vocab_log) || ':' || (SELECT COALESCE(MAX(id), 0) FROM vocab_log) AS s"),
  }
  const group = (rows, k) => { const m = new Map(); for (const r of rows) { const l = m.get(r[k]) ?? []; l.push(JSON.parse(r.data)); m.set(r[k], l) } return m }
  return {
    kind: 'sqlite', path, q, tx,
    async domains() { return group(q.dAll.all(), 'domain') },
    async terms() { return group(q.tAll.all(), 'binding') },
    async specs() { return q.sAll.all().map((r) => JSON.parse(r.data)) },
    async getDomainEntry(domain, key) { const r = q.dGet.get(domain, key); return r ? JSON.parse(r.data) : null },
    async getTermMapping(binding, key) { const r = q.tGet.get(binding, key); return r ? JSON.parse(r.data) : null },
    /** list: [{ domain, entry }] — action: set | model | confirm */
    async putDomainEntries(list, action) {
      tx(() => { for (const { domain, entry } of list) { const k = entryKey(entry); q.dPut.run(domain, k, entry.origin ?? null, entry.status ?? null, JSON.stringify(entry), now()); q.log.run('domain', domain, k, action, entry.origin ?? null, entry.by ?? null, JSON.stringify(entry), now()) } })
    },
    async putTermMappings(list, action) {
      tx(() => { for (const { binding, mapping } of list) { q.tPut.run(binding, mapping.key, mapping.origin ?? null, mapping.status ?? null, JSON.stringify(mapping), now()); q.log.run('term', binding, mapping.key, action, mapping.origin ?? null, mapping.by ?? null, JSON.stringify(mapping), now()) } })
    },
    async putSpec(record, action) {
      tx(() => { q.sPut.run(record.file, record.status ?? null, record.reviewedBy ? 'user' : 'model', JSON.stringify(record), now()); q.log.run('spec', record.file, '', action, record.reviewedBy ? 'user' : 'model', record.reviewedBy ?? null, JSON.stringify({ status: record.status, spec: record.spec }), now()) })
    },
    async history(kind, target, key = '') { return q.history.all(kind, target, key).map((r) => ({ action: r.action, origin: r.origin, by: r.by, at: r.at, data: r.data ? JSON.parse(r.data) : null })) },
    close() { db.close() },
  }
}

/**
 * 一次性数据修复（0.6.0–0.6.4）：没有单独配置核验模型时，盲审调用失败却被当成“结论一致”。
 * 没有经过盲审、也没有人工确认的模型结果作废：起草的规格标为需重新起草（下次运行重新起草并盲审），
 * 值域条目与术语对照删除（回到“无对照”，下次运行重新提交模型）。每一条都记入 vocab_log。
 */
const blinded = (trail) => (trail ?? []).some((x) => x.step === '盲审' && (x.ok === true || x.ok === false))
function repairUnblinded(store) {
  if (store.q.meta.get('repair_unblinded_v1')) return { specs: 0, entries: 0, mappings: 0 }
  const out = { specs: 0, entries: 0, mappings: 0 }
  const at = now()
  store.tx(() => {
    for (const r of store.q.sAll.all().map((x) => JSON.parse(x.data))) {
      if (r.reviewedBy || r.status === 'rejected' || r.status === 'failed' || blinded(r.trail)) continue
      const next = { ...r, status: 'failed', note: '未经盲审（核验模型未配置时的缺陷），需重新起草', invalidatedAt: at }
      store.q.sPut.run(r.file, 'failed', 'model', JSON.stringify(next), at)
      store.q.log.run('spec', r.file, '', 'invalidate', 'system', null, JSON.stringify({ reason: next.note, was: { status: r.status, agreement: r.agreement } }), at)
      out.specs++
    }
    for (const r of store.q.dModel.all()) {
      const e = JSON.parse(r.data)
      if (blinded(e.trail)) continue
      store.q.dDel.run(r.domain, r.key)
      store.q.log.run('domain', r.domain, r.key, 'invalidate', 'system', null, JSON.stringify({ reason: '未经盲审，作废后重新提交模型', was: e }), at)
      out.entries++
    }
    for (const r of store.q.tModel.all()) {
      const m = JSON.parse(r.data)
      if (blinded(m.trail)) continue
      store.q.tDel.run(r.binding, r.key)
      store.q.log.run('term', r.binding, r.key, 'invalidate', 'system', null, JSON.stringify({ reason: '未经盲审，作废后重新提交模型', was: m }), at)
      out.mappings++
    }
    store.q.setMeta.run('repair_unblinded_v1', JSON.stringify({ at, ...out }))
  })
  return out
}

async function importLegacy(store, vocabDir) {
  if (store.q.meta.get('legacy_imported')) return
  const dl = []; const tl = []; const sl = []
  const dDir = join(vocabDir, 'domains')
  for (const p of (await walkJson(dDir)).sort()) { const o = await readJson(p, null); for (const e of o?.entries ?? []) dl.push({ domain: idOf(dDir, p), entry: e }) }
  const tDir = join(vocabDir, 'terminology')
  for (const p of (await walkJson(tDir)).sort()) { const o = await readJson(p, null); for (const m of o?.mappings ?? []) if (m?.key) tl.push({ binding: idOf(tDir, p), mapping: m }) }
  for (const p of (await walkJson(join(vocabDir, 'specs'))).sort()) { const r = await readJson(p, null); if (r?.file) sl.push(r) }
  store.tx(() => {
    for (const { domain, entry } of dl) { const k = entryKey(entry); if (!store.q.dGet.get(domain, k)) { store.q.dPut.run(domain, k, entry.origin ?? null, entry.status ?? null, JSON.stringify(entry), now()); store.q.log.run('domain', domain, k, 'import', entry.origin ?? null, entry.by ?? null, JSON.stringify(entry), entry.at ?? now()) } }
    for (const { binding, mapping } of tl) { if (!store.q.tGet.get(binding, mapping.key)) { store.q.tPut.run(binding, mapping.key, mapping.origin ?? null, mapping.status ?? null, JSON.stringify(mapping), now()); store.q.log.run('term', binding, mapping.key, 'import', mapping.origin ?? null, mapping.by ?? null, JSON.stringify(mapping), mapping.at ?? now()) } }
    for (const r of sl) { if (!store.q.sGet.get(r.file)) { store.q.sPut.run(r.file, r.status ?? null, r.reviewedBy ? 'user' : 'model', JSON.stringify(r), now()); store.q.log.run('spec', r.file, '', 'import', r.reviewedBy ? 'user' : 'model', r.reviewedBy ?? null, JSON.stringify({ status: r.status }), r.at ?? now()) } }
    store.q.setMeta.run('legacy_imported', now())
  })
}

/* ------------------------------------------------------- JSON 文件退路 */
function fileStore(vocabDir) {
  const dPath = (id) => join(vocabDir, 'domains', `${id}.json`)
  const tPath = (id) => join(vocabDir, 'terminology', `${id}.json`)
  const write = async (p, o) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(o, null, 2)) }
  return {
    kind: 'files', path: null,
    async domains() { const m = new Map(); const root = join(vocabDir, 'domains'); for (const p of (await walkJson(root)).sort()) m.set(idOf(root, p), (await readJson(p, {})).entries ?? []); return m },
    async terms() { const m = new Map(); const root = join(vocabDir, 'terminology'); for (const p of (await walkJson(root)).sort()) m.set(idOf(root, p), (await readJson(p, {})).mappings ?? []); return m },
    async specs() { const out = []; for (const p of (await walkJson(join(vocabDir, 'specs'))).sort()) { const r = await readJson(p, null); if (r) out.push(r) } return out },
    async getDomainEntry(domain, key) { return ((await readJson(dPath(domain), {})).entries ?? []).find((e) => entryKey(e) === key) ?? null },
    async getTermMapping(binding, key) { return ((await readJson(tPath(binding), {})).mappings ?? []).find((m) => m.key === key) ?? null },
    async putDomainEntries(list) {
      const by = new Map(); for (const x of list) by.set(x.domain, [...(by.get(x.domain) ?? []), x.entry])
      for (const [id, entries] of by) { const o = await readJson(dPath(id), { entries: [] }); const ks = new Set(entries.map(entryKey)); o.entries = [...(o.entries ?? []).filter((e) => !ks.has(entryKey(e))), ...entries]; await write(dPath(id), o) }
    },
    async putTermMappings(list) {
      const by = new Map(); for (const x of list) by.set(x.binding, [...(by.get(x.binding) ?? []), x.mapping])
      for (const [id, ms] of by) { const o = await readJson(tPath(id), { mappings: [] }); const ks = new Set(ms.map((m) => m.key)); o.mappings = [...(o.mappings ?? []).filter((m) => !ks.has(m.key)), ...ms]; await write(tPath(id), o) }
    },
    async putSpec(record) { await write(join(vocabDir, 'specs', `${safeFile(record.file)}.json`), record) },
    async history() { return [] },
    close() {},
  }
}

const stores = new Map()
/** 打开（并缓存）本机对照库。 */
export async function openVocabStore(vocabDir, { sqlite = true } = {}) {
  if (!vocabDir) return null
  const k = `${vocabDir}|${sqlite}`
  if (stores.has(k)) return stores.get(k)
  const p = (async () => {
    await mkdir(vocabDir, { recursive: true })
    const mod = sqlite ? await loadSqlite() : null
    if (!mod?.DatabaseSync) return fileStore(vocabDir)
    const path = join(vocabDir, VOCAB_FILE)
    const fresh = !(await exists(path))
    const s = sqliteStore(mod.DatabaseSync, path)
    if (fresh) await chmod(path, 0o600).catch(() => {})
    await importLegacy(s, vocabDir)
    s.repaired = repairUnblinded(s)
    return s
  })()
  stores.set(k, p)
  try { return await p } catch (e) { stores.delete(k); throw e }
}
export function closeVocabStores() { for (const p of stores.values()) p.then((s) => s?.close()).catch(() => {}); stores.clear() }
