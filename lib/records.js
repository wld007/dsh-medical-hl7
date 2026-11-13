/**
 * 过程记录库（与 dsh-medical-event、dsh-medical-anonymizer 同一设计）：
 * 每个输出根目录一个 SQLite（<outputRoot>/_records/records.sqlite，权限 0600），各批次共用，表里用 run_id 区分。
 *
 *   runs         批次（常用字段单列，全量放 data 列的 JSON）——原 index.json、runs/<id>/run.json
 *   run_docs     批次的统计文档：schema / domains / terminology / mapping、按目录的阶段统计 stats:<目录>
 *                ——原 runs/<id>/*.json、stats/*.json
 *   model_calls  模型调用流水（只有大小、耗时、token，不含内容）——原 calls.json
 *   model_cache  模型回复（继续处理时复用；批次完成后删除）——原 model-cache.jsonl
 *
 * 仍然是文件：交付数据、report.md / report.json（给人和其他工具看）、中间结果 stages/*.ndjson.gz、
 * 暂扣的 Bundle、官方校验器输出。
 *
 * 列只用 TEXT / INTEGER，时间是 ISO 文本，结构放 JSON 文本列，以后可以原样搬到线上库。
 * 表结构版本记在 PRAGMA user_version；比本插件新的库拒绝打开。
 * 旧布局的文件在第一次打开库时并入一次，原文件留在原处、此后不再写。
 * 运行时没有 node:sqlite（Node < 22.13）时退回旧布局的文件读写。
 *
 * 模型缓存会引用取值样例：库和映射库一样敏感，所以权限 0600、开启 secure_delete。
 */
import { appendFile, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const RECORDS_FILE = 'records.sqlite'
export const SCHEMA_VERSION = 1
const PRODUCER = 'dsh-medical-hl7'

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     started_at TEXT,
     finished_at TEXT,
     input TEXT,
     input_name TEXT,
     output TEXT,
     patients INTEGER,
     resources INTEGER,
     held INTEGER,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS runs_started ON runs (started_at);
   CREATE TABLE IF NOT EXISTS run_docs (
     run_id TEXT NOT NULL,
     name TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (run_id, name)
   );
   CREATE TABLE IF NOT EXISTS model_calls (
     run_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     at TEXT,
     role TEXT,
     phase TEXT,
     round INTEGER,
     model TEXT,
     ok INTEGER,
     cached INTEGER NOT NULL DEFAULT 0,
     ms INTEGER,
     tokens INTEGER,
     items INTEGER,
     error TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, seq)
   );
   CREATE TABLE IF NOT EXISTS model_cache (
     key TEXT PRIMARY KEY,
     model TEXT,
     content TEXT NOT NULL,
     run_id TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS model_cache_run ON model_cache (run_id);`,
]

let sqliteModule
export async function loadSqlite() {
  if (sqliteModule === undefined) {
    try {
      // node:sqlite 在 Node 22 上会打印一次 ExperimentalWarning：只屏蔽这一条
      const emit = process.emitWarning
      process.emitWarning = (w, ...a) => (String(w?.message ?? w).includes('SQLite') ? undefined : emit.call(process, w, ...a))
      try { sqliteModule = await import('node:sqlite') } finally { process.emitWarning = emit }
    } catch { sqliteModule = null }
  }
  return sqliteModule
}

async function exists(p) { try { await stat(p); return true } catch { return false } }
async function readJson(p, fallback) { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return fallback } }
async function readLines(p) { try { return (await readFile(p, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const now = () => new Date().toISOString()
const n = (x) => (Number.isFinite(x) ? x : null)

/** 批次列表里的一行。 */
export const runBrief = (run) => ({
  id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt ?? null, input: run.inputName,
  patients: run.totals?.patients ?? 0, resources: run.totals?.resources ?? 0, held: run.totals?.held ?? 0,
  source: run.source ?? null, resumedFrom: run.resumedFrom ?? null, model: run.model?.configured ? run.model.models?.suggest ?? null : null,
})

/** 旧布局文件名 → 文档名。 */
const LEGACY_DOCS = { 'schema.json': 'schema', 'domains.json': 'domains', 'terminology.json': 'terminology', 'mapping.json': 'mapping' }

/* ------------------------------------------------------------------ sqlite */
function sqliteRecords(DatabaseSync, recordsDir, path) {
  const db = new DatabaseSync(path)
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;')
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (version > SCHEMA_VERSION) throw new Error(`记录库 ${path} 的版本（${version}）比本插件新（${SCHEMA_VERSION}），请升级插件`)
    for (let v = version; v < SCHEMA_VERSION; v++) tx(() => { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`) })
  } catch (e) { db.close(); throw e }
  const q = {
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    runPut: db.prepare(`INSERT INTO runs (id, status, started_at, finished_at, input, input_name, output, patients, resources, held, data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, finished_at = excluded.finished_at, input = excluded.input,
        input_name = excluded.input_name, output = excluded.output, patients = excluded.patients, resources = excluded.resources, held = excluded.held,
        data = excluded.data, updated_at = excluded.updated_at`),
    runGet: db.prepare('SELECT data FROM runs WHERE id = ?'),
    runList: db.prepare('SELECT data FROM runs ORDER BY started_at DESC LIMIT ?'),
    runDel: db.prepare('DELETE FROM runs WHERE id = ?'),
    docPut: db.prepare('INSERT INTO run_docs (run_id, name, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
    docGet: db.prepare('SELECT data FROM run_docs WHERE run_id = ? AND name = ?'),
    docNames: db.prepare('SELECT name FROM run_docs WHERE run_id = ? ORDER BY name'),
    docsDel: db.prepare('DELETE FROM run_docs WHERE run_id = ?'),
    docsDelPrefix: db.prepare('DELETE FROM run_docs WHERE run_id = ? AND name LIKE ?'),
    callsDel: db.prepare('DELETE FROM model_calls WHERE run_id = ?'),
    callPut: db.prepare('INSERT OR REPLACE INTO model_calls (run_id, seq, at, role, phase, round, model, ok, cached, ms, tokens, items, error, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    calls: db.prepare('SELECT data FROM model_calls WHERE run_id = ? ORDER BY seq'),
    cacheGet: db.prepare('SELECT content FROM model_cache WHERE key = ?'),
    cachePut: db.prepare('INSERT OR IGNORE INTO model_cache (key, model, content, run_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    cacheDrop: db.prepare('DELETE FROM model_cache WHERE run_id = ?'),
    cacheCount: db.prepare('SELECT COUNT(*) AS n FROM model_cache WHERE run_id = ?'),
  }
  q.setMeta.run('schema_version', String(SCHEMA_VERSION))
  q.setMeta.run('producer', PRODUCER)
  let open = true
  const putRun = (run) => {
    const b = runBrief(run)
    q.runPut.run(run.id, run.status ?? 'unknown', run.startedAt ?? null, run.finishedAt ?? null, run.input ?? null, run.inputName ?? null, run.output ?? null,
      n(b.patients), n(b.resources), n(b.held), JSON.stringify(run), now())
  }
  const putCalls = (runId, calls) => tx(() => {
    q.callsDel.run(runId)
    calls.forEach((c, i) => q.callPut.run(runId, i + 1, c.at ?? null, c.role ?? null, c.phase ?? null, n(c.round), c.model ?? null, c.ok == null ? null : c.ok ? 1 : 0, c.cached ? 1 : 0, n(c.ms), n(c.tokens), n(c.items), c.error ?? null, JSON.stringify(c)))
  })
  return {
    kind: 'sqlite', path, db, tx, q, putRun, putCalls,
    async saveRun(run) { if (open) putRun(run) },
    async loadRun(id) { const r = q.runGet.get(id); return r ? JSON.parse(r.data) : null },
    async listRuns(limit = 100) { return q.runList.all(limit).map((r) => runBrief(JSON.parse(r.data))) },
    async deleteRun(id) { tx(() => { q.runDel.run(id); q.docsDel.run(id); q.callsDel.run(id); q.cacheDrop.run(id) }) },
    async putDoc(runId, name, value) { if (open) q.docPut.run(runId, name, JSON.stringify(value), now()) },
    async getDoc(runId, name) { const r = q.docGet.get(runId, name); return r ? JSON.parse(r.data) : null },
    async docNames(runId, prefix = '') { return q.docNames.all(runId).map((r) => r.name).filter((x) => x.startsWith(prefix)) },
    async dropDocs(runId, prefix) { q.docsDelPrefix.run(runId, `${prefix.replace(/[%_]/g, '')}%`) },
    async putCalls(runId, calls) { if (open) putCalls(runId, calls) },
    async calls(runId) { return q.calls.all(runId).map((r) => JSON.parse(r.data)) },
    cache(runId) {
      return {
        get: (key) => (open ? q.cacheGet.get(key)?.content : undefined),
        put: (key, model, content) => { if (open) q.cachePut.run(key, model ?? '', content, runId, now()) },
        count: () => q.cacheCount.get(runId).n,
      }
    },
    async dropCache(runId) { if (open) q.cacheDrop.run(runId) },
    close() { if (open) { open = false; db.close() } },
  }
}

/** 旧布局并入（每个库只做一次；原文件不动）。 */
async function importLegacy(store, recordsDir) {
  if (store.q.meta.get('legacy_imported')) return
  const runsDir = join(recordsDir, 'runs')
  let ids = []
  try { ids = (await readdir(runsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name) } catch { /* none */ }
  const loaded = []
  for (const id of ids) {
    const dir = join(runsDir, id)
    const run = await readJson(join(dir, 'run.json'), null)
    if (!run?.id) continue
    const docs = {}
    for (const [f, name] of Object.entries(LEGACY_DOCS)) { const v = await readJson(join(dir, f), null); if (v) docs[name] = v }
    let stats = []
    try { stats = (await readdir(join(dir, 'stats'))).filter((f) => f.endsWith('.json')) } catch { /* none */ }
    for (const f of stats) { const v = await readJson(join(dir, 'stats', f), null); if (v) docs[`stats:${f.replace(/\.json$/, '')}`] = v }
    loaded.push({ run, docs, calls: await readJson(join(dir, 'calls.json'), []), cache: await readLines(join(dir, 'model-cache.jsonl')) })
  }
  store.tx(() => {
    for (const { run, docs, calls, cache } of loaded) {
      if (!store.q.runGet.get(run.id)) store.putRun(run)
      for (const [name, v] of Object.entries(docs)) if (!store.q.docGet.get(run.id, name)) store.q.docPut.run(run.id, name, JSON.stringify(v), now())
      if (calls.length && !store.q.calls.all(run.id).length) calls.forEach((c, i) => store.q.callPut.run(run.id, i + 1, c.at ?? null, c.role ?? null, c.phase ?? null, n(c.round), c.model ?? null, c.ok == null ? null : c.ok ? 1 : 0, c.cached ? 1 : 0, n(c.ms), n(c.tokens), n(c.items), c.error ?? null, JSON.stringify(c)))
      for (const c of cache) if (c?.k && c.r) store.q.cachePut.run(c.k, '', c.r, run.id, now())
    }
    store.q.setMeta.run('legacy_imported', now())
  })
}

/* ------------------------------------------------------- 旧布局（文件）退路 */
function fileRecords(recordsDir) {
  const dirOf = (id) => join(recordsDir, 'runs', id)
  const indexPath = join(recordsDir, 'index.json')
  const docPath = (id, name) => (LEGACY_DOCS[`${name}.json`] ? join(dirOf(id), `${name}.json`) : name.startsWith('stats:') ? join(dirOf(id), 'stats', `${name.slice(6)}.json`) : join(dirOf(id), 'docs', `${name.replace(/[^\w.-]+/g, '_')}.json`))
  const mem = new Map()
  return {
    kind: 'files', path: null,
    async saveRun(run) {
      await mkdir(dirOf(run.id), { recursive: true })
      await writeFile(join(dirOf(run.id), 'run.json'), JSON.stringify(run, null, 2))
      const idx = await readJson(indexPath, [])
      await writeFile(indexPath, JSON.stringify([runBrief(run), ...idx.filter((r) => r.id !== run.id)].slice(0, 100), null, 2))
    },
    async loadRun(id) { return readJson(join(dirOf(id), 'run.json'), null) },
    async listRuns(limit = 100) { return (await readJson(indexPath, [])).slice(0, limit) },
    async deleteRun(id) {
      const idx = await readJson(indexPath, [])
      await writeFile(indexPath, JSON.stringify(idx.filter((r) => r.id !== id), null, 2))
      for (const f of ['run.json', 'calls.json', 'model-cache.jsonl', ...Object.keys(LEGACY_DOCS)]) await rm(join(dirOf(id), f), { force: true })
      await rm(join(dirOf(id), 'stats'), { recursive: true, force: true })
    },
    async putDoc(id, name, value) { const p = docPath(id, name); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, JSON.stringify(value)) },
    async getDoc(id, name) { return readJson(docPath(id, name), null) },
    async docNames(id, prefix = '') {
      const out = []
      for (const [f, name] of Object.entries(LEGACY_DOCS)) if (await exists(join(dirOf(id), f))) out.push(name)
      try { for (const f of await readdir(join(dirOf(id), 'stats'))) out.push(`stats:${f.replace(/\.json$/, '')}`) } catch { /* none */ }
      return out.filter((x) => x.startsWith(prefix)).sort()
    },
    async dropDocs(id, prefix) { if (prefix === 'stats:') await rm(join(dirOf(id), 'stats'), { recursive: true, force: true }) },
    async putCalls(id, calls) { await mkdir(dirOf(id), { recursive: true }); await writeFile(join(dirOf(id), 'calls.json'), JSON.stringify(calls)) },
    async calls(id) { return readJson(join(dirOf(id), 'calls.json'), []) },
    cache(id) {
      const p = join(dirOf(id), 'model-cache.jsonl')
      let m = mem.get(id)
      let loading = null
      if (!m) { m = new Map(); mem.set(id, m); loading = readLines(p).then((l) => { for (const x of l) if (x.k) m.set(x.k, x.r) }) }
      let q = Promise.resolve()
      return {
        ready: loading,
        get: (key) => m.get(key),
        put: (key, model, content) => { if (m.has(key)) return; m.set(key, content); q = q.then(async () => { await mkdir(dirOf(id), { recursive: true }); await appendFile(p, `${JSON.stringify({ k: key, r: content })}\n`, { mode: 0o600 }) }).catch(() => {}) },
        count: () => m.size,
      }
    },
    async dropCache(id) { mem.delete(id); await rm(join(dirOf(id), 'model-cache.jsonl'), { force: true }) },
    close() {},
  }
}

/**
 * 打开输出根目录的记录库。
 *   opts.sqlite === false  强制用旧布局文件（测试、排障用）
 *   opts.create === false  _records 目录不存在时返回 null（不在已删除的输出目录里重建）
 */
export async function openRecords(recordsDir, { sqlite = true, create = true } = {}) {
  if (!create && !(await exists(recordsDir))) return null
  await mkdir(recordsDir, { recursive: true })
  const mod = sqlite ? await loadSqlite() : null
  if (!mod?.DatabaseSync) return fileRecords(recordsDir)
  const path = join(recordsDir, RECORDS_FILE)
  const fresh = !(await exists(path))
  const store = sqliteRecords(mod.DatabaseSync, recordsDir, path)
  if (fresh) await chmod(path, 0o600).catch(() => {})
  await importLegacy(store, recordsDir)
  return store
}
