import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRecords } from '../lib/records.js'
import { openVocabStore } from '../lib/stages/vocabstore.js'
import { loadVocab, saveDomainEntry, saveModelDomainEntries, confirmModelResult, vocabHistory } from '../lib/stages/vocab.js'
import { writeFictionalPatient } from './fixtures/fictional.mjs'
import { createService } from '../lib/service.js'

const tmp = async (p) => realpath(await mkdtemp(join(tmpdir(), p)))

test('记录库：批次、文档、模型调用与缓存；权限 0600；删除批次', async () => {
  const dir = join(await tmp('hl7-rec-'), '_records')
  const st = await openRecords(dir)
  assert.equal(st.kind, 'sqlite')
  assert.equal((await stat(st.path)).mode & 0o777, 0o600)
  const run = { id: 'r1', status: 'completed', startedAt: '2026-01-01T00:00:00Z', inputName: 'x', totals: { patients: 2, resources: 10, held: 0 } }
  await st.saveRun(run)
  await st.saveRun({ ...run, id: 'r2', startedAt: '2026-01-02T00:00:00Z' })
  assert.deepEqual((await st.listRuns()).map((r) => r.id), ['r2', 'r1'], '按开始时间倒序')
  await st.putDoc('r1', 'domains', { a: 1 })
  await st.putDoc('r1', 'stats:目录A', { b: 2 })
  assert.deepEqual(await st.getDoc('r1', 'domains'), { a: 1 })
  assert.deepEqual(await st.docNames('r1', 'stats:'), ['stats:目录A'])
  await st.putCalls('r1', [{ role: 'suggest', phase: '值域归一', ok: true, ms: 5 }, { role: 'verify', phase: '值域盲审', ok: false, error: 'x' }])
  assert.equal((await st.calls('r1')).length, 2)
  const c = st.cache('r1'); c.put('k', 'm', 'reply'); assert.equal(c.get('k'), 'reply'); assert.equal(c.count(), 1)
  await st.dropCache('r1'); assert.equal(c.get('k'), undefined)
  await st.deleteRun('r1')
  assert.equal(await st.loadRun('r1'), null); assert.equal(await st.getDoc('r1', 'domains'), null)
  st.close()
})

test('记录库：旧布局文件第一次打开时并入，原文件不动', async () => {
  const dir = join(await tmp('hl7-legacy-'), '_records')
  await mkdir(join(dir, 'runs', 'old1', 'stats'), { recursive: true })
  await writeFile(join(dir, 'index.json'), JSON.stringify([{ id: 'old1' }]))
  await writeFile(join(dir, 'runs', 'old1', 'run.json'), JSON.stringify({ id: 'old1', status: 'review', startedAt: '2025-01-01T00:00:00Z', totals: { patients: 1 } }))
  await writeFile(join(dir, 'runs', 'old1', 'domains.json'), JSON.stringify({ d: 1 }))
  await writeFile(join(dir, 'runs', 'old1', 'stats', 'U1.json'), JSON.stringify({ s: 1 }))
  await writeFile(join(dir, 'runs', 'old1', 'calls.json'), JSON.stringify([{ phase: 'x' }]))
  await writeFile(join(dir, 'runs', 'old1', 'model-cache.jsonl'), `${JSON.stringify({ k: 'kk', r: 'rr' })}\n`)
  const st = await openRecords(dir)
  assert.equal((await st.loadRun('old1')).status, 'review')
  assert.deepEqual(await st.getDoc('old1', 'domains'), { d: 1 })
  assert.deepEqual(await st.getDoc('old1', 'stats:U1'), { s: 1 })
  assert.equal((await st.calls('old1')).length, 1)
  assert.equal(st.cache('old1').get('kk'), 'rr')
  assert.ok((await readdir(join(dir, 'runs', 'old1'))).includes('run.json'), '原文件保留')
  st.close()
})

test('记录库：没有 node:sqlite 时退回旧布局文件', async () => {
  const dir = join(await tmp('hl7-files-'), '_records')
  const st = await openRecords(dir, { sqlite: false })
  assert.equal(st.kind, 'files')
  await st.saveRun({ id: 'f1', status: 'completed', totals: {} })
  await st.putDoc('f1', 'domains', { a: 1 })
  assert.equal((await st.listRuns())[0].id, 'f1')
  assert.ok((await readdir(join(dir, 'runs', 'f1'))).includes('domains.json'))
})

test('对照库：复核、模型结果、确认都有历史；旧 JSON 并入；人工条目不被模型覆盖', async () => {
  const vocabDir = await tmp('hl7-vocab-')
  await mkdir(join(vocabDir, 'domains', 'regional-platform'), { recursive: true })
  await writeFile(join(vocabDir, 'domains', 'regional-platform', 'lab-result-flag.json'), JSON.stringify({ entries: [{ code: '1', to: 'H', status: 'confirmed', origin: 'user', by: 'user' }] }))
  const v0 = await loadVocab(vocabDir)
  assert.equal(v0.domains.get('regional-platform/lab-result-flag').entries.find((e) => e.code === '1').to, 'H', '旧 JSON 并入')
  assert.equal((await openVocabStore(vocabDir)).kind, 'sqlite')
  await saveModelDomainEntries(vocabDir, 'regional-platform/lab-result-flag', [{ code: '1', to: 'L', status: 'confirmed' }, { code: '0', to: 'L', status: 'confirmed' }])
  const v1 = await loadVocab(vocabDir)
  const flag = v1.domains.get('regional-platform/lab-result-flag')
  assert.equal(flag.entries.find((e) => e.code === '1').to, 'H', '人工条目不被模型覆盖')
  assert.equal(flag.entries.find((e) => e.code === '0').source, 'model')
  assert.notEqual(v1.version, v0.version)
  await confirmModelResult(vocabDir, 'domain', 'regional-platform/lab-result-flag', '0\u0001')
  await saveDomainEntry(vocabDir, 'regional-platform/lab-result-flag', { code: '0', to: 'N', status: 'confirmed', note: '改正' })
  const h = await vocabHistory(vocabDir, 'domain', 'regional-platform/lab-result-flag', '0\u0001')
  assert.deepEqual(h.map((x) => x.action), ['model', 'confirm', 'set'])
  assert.equal(h.at(-1).data.to, 'N')
})

test('删除批次：删记录与 _records/runs/<批次>，保留交付目录', async () => {
  const base = await tmp('hl7-del-')
  await writeFictionalPatient(join(base, 'in', '病人A'))
  const svc = createService({ config: { outputRoot: join(base, 'out') }, defaultDirectory: base, stateDir: join(base, 'state') })
  const { runId } = await svc.start({ inputDir: join(base, 'in') })
  let run
  for (let i = 0; i < 400; i++) { ({ run } = await svc.status(runId)); if (run.status !== 'running' && !svc.isRunning()) break; await new Promise((r) => setTimeout(r, 25)) }
  const r = await svc.deleteRun(runId)
  assert.equal(r.deleted, true)
  assert.equal((await svc.list()).runs.length, 0)
  assert.ok((await readdir(join(base, 'out', 'in'))).includes('bundles'), '交付目录还在')
  assert.ok(!(await readdir(join(base, 'out', '_records', 'runs'))).includes(runId))
  svc.dispose()
})

test('数据修复：未经盲审的模型结果作废（规格重新起草、值域条目删除），人工条目不动', async () => {
  const vocabDir = await tmp('hl7-repair-')
  await mkdir(join(vocabDir, 'specs'), { recursive: true })
  await mkdir(join(vocabDir, 'domains'), { recursive: true })
  await writeFile(join(vocabDir, 'specs', 'a.json'), JSON.stringify({ file: 'a.json', status: 'applied', agreement: 'agreed', spec: { id: 'm-a', kind: 'lab', roles: {} }, trail: [{ round: 1, step: '起草' }, { round: 1, step: '盲审', error: '未配置核验模型' }] }))
  await writeFile(join(vocabDir, 'specs', 'b.json'), JSON.stringify({ file: 'b.json', status: 'applied', agreement: 'agreed', spec: { id: 'm-b', kind: 'lab', roles: {} }, trail: [{ round: 1, step: '盲审', ok: true }] }))
  await writeFile(join(vocabDir, 'domains', 'gender.json'), JSON.stringify({ entries: [{ code: 'x', to: 'male', status: 'confirmed', origin: 'model', trail: [] }, { code: 'y', to: 'female', status: 'confirmed', origin: 'user' }] }))
  const st = await openVocabStore(vocabDir)
  assert.deepEqual(st.repaired, { specs: 1, entries: 1, mappings: 0 })
  const specs = Object.fromEntries((await st.specs()).map((r) => [r.file, r.status]))
  assert.deepEqual(specs, { 'a.json': 'failed', 'b.json': 'applied' })
  const g = (await st.domains()).get('gender')
  assert.deepEqual(g.map((e) => e.code), ['y'], '人工条目保留')
  assert.ok((await st.history('spec', 'a.json')).some((x) => x.action === 'invalidate'))
})
