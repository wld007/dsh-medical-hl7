import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFictionalPatient } from './fixtures/fictional.mjs'
import { harmonize } from '../lib/stages/harmonize.js'
import { createNormalizer } from '../lib/stages/normalize.js'
import { loadVocab, lookupEntry } from '../lib/stages/vocab.js'
import { createService } from '../lib/service.js'

const spec = {
  id: 't', kind: 'lab', key: ['K'], invalid: { field: 'DEL', values: ['1'] },
  roles: { 'patient.id': 'PID', value: 'V', unit: 'U', refRange: 'R', 'time.effective': ['T1', 'T2'], 'patient.gender.code': 'G', 'patient.gender.display': 'GN', 'item.code': 'C' },
}

test('Schema 同构：只搬不改；备选字段取值不同的原样保留；未映射字段进 extras', () => {
  const h = harmonize({ spec, profileId: 'p', file: 'f.json', row: { K: 'k1', PID: 'x', V: '＜0.600', U: 'umol/l', T1: 1579100000000, T2: 1579200000000, G: '9', GN: '其他', C: '5049', EXTRA: '保留', DEL: '0' } })
  assert.equal(h.roles.value.raw, '＜0.600', '原值不变')
  assert.equal(h.roles['time.effective'].raw, 1579100000000)
  assert.deepEqual(h.extras.map((e) => e.field).sort(), ['EXTRA', 'T2'])
  assert.equal(h.invalid, false)
})

test('值域归一：格式类与枚举类、状态、统计', async () => {
  const vocab = await loadVocab(null)
  const n = createNormalizer({ vocab })
  const h = harmonize({ spec, profileId: 'p', file: 'f.json', row: { K: 'k1', PID: 'x', V: '＜0.600', U: 'umol/l', R: '＜1.00', T1: '2020-01-02 03:04:05', G: '9', GN: '其他', C: 'a\nb' } })
  const N = n.normalize(h, spec)
  assert.deepEqual(N.values.value.value, { type: 'quantity', value: 0.6, comparator: '<', text: '0.600' }, '全角比较符')
  assert.equal(N.values.refRange.value.high.value, 1)
  assert.equal(N.values['time.effective'].value.value, '2020-01-02T03:04:05+08:00')
  assert.equal(N.concepts.unit.to, 'umol/L', '单位写法统一到 UCUM')
  assert.equal(N.concepts['patient.gender'].status, 'pending', '性别 9/其他 待确认，不猜')
  assert.equal(N.values['item.code'].status, 'invalid', '代码含换行')
  const s = n.summary()
  assert.equal(s.gender.byStatus.pending, 1)
  assert.equal(s['ucum-unit'].values[0].to, 'umol/L')

  const dx = { id: 'd', kind: 'condition', roles: { 'patient.id': 'PID', 'code.code': 'ICD' } }
  const icd = (code) => n.normalize(harmonize({ spec: dx, profileId: 'p', file: 'f', row: { PID: 'x', ICD: code } }), dx).values['code.code']
  assert.deepEqual(icd('N18.900x012+D63.8*').value, { system: 'icd-10-cn', code: 'N18.900x012', asterisk: 'D63.8' }, '拆剑号星号')
  assert.equal(icd('B03.01.02.02.01').value.system, 'tcm-syndrome', 'GB/T 15657-2021：B 为证候')
  assert.equal(icd('A04.05.13').value.system, 'tcm-disease')
  assert.equal(icd('E11.301+').value.code, 'E11.301', '只有剑号码')
  assert.equal(icd('1|G47.900,').status, 'invalid')
  const gender = vocab.domains.get('gender')
  assert.equal(lookupEntry(gender, '1', '男性').to, 'male')
})

test('复核：页面改对照 → 存本机 → 重跑生效；中间结果与 ConceptMap', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-review-')))
  await writeFictionalPatient(join(base, 'in', '病人A'))
  const svc = createService({ config: { outputRoot: join(base, 'out') }, defaultDirectory: base, stateDir: join(base, 'state') })
  const wait = async (id) => { for (let i = 0; i < 400; i++) { const { run } = await svc.status(id); if (run.status !== 'running') return run; await new Promise((r) => setTimeout(r, 25)) } }
  const first = await wait((await svc.start({ inputDir: join(base, 'in') })).runId)
  assert.equal(first.error, undefined, first.error)
  assert.ok(first.stages.domains.pending > 0)
  const stages = await readdir(join(first.runDir, 'stages'))
  assert.deepEqual(stages.sort(), ['病人A.harmonized.ndjson.gz', '病人A.normalized.ndjson.gz'])
  const norm = gunzipSync(await readFile(join(first.runDir, 'stages', '病人A.normalized.ndjson.gz'))).toString().trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(norm.some((r) => r.concepts?.flag?.status === 'pending'))

  // 值域：确认检验结果标志 1 = H
  const dv = await svc.domainsView(first.id)
  const flag = dv.domains.find((d) => d.id === 'regional-platform/lab-result-flag')
  assert.equal(flag.values[0].status, 'pending')
  await svc.reviewDomain({ domain: flag.id, code: '1', to: 'H', status: 'confirmed', note: '测试' })
  assert.equal((await svc.domainsView(first.id)).domains.find((d) => d.id === flag.id).values[0].changed, true, '标出与本批不同')
  // 术语：肌酐 → LOINC
  const tv = await svc.terminologyView(first.id)
  const lab = tv.bindings.find((b) => b.id === 'lab-item')
  const crea = lab.items.find((c) => c.display === '肌酐')
  await svc.reviewTerm({ binding: 'lab-item', key: crea.key, from: { scope: crea.scope, code: crea.code, display: crea.display }, to: { code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma' }, equivalence: 'equivalent', status: 'confirmed' })

  const second = await wait((await svc.rerun(first.id)).runId)
  assert.equal(second.error, undefined, second.error)
  const bundle = JSON.parse(await readFile(join(second.output, 'bundles', '病人A.json'), 'utf8'))
  const obs = bundle.entry.map((e) => e.resource).find((r) => r.resourceType === 'Observation' && r.code.text === '肌酐')
  assert.equal(obs.interpretation[0].coding[0].code, 'H', '复核后的值域对照生效')
  assert.ok(obs.code.coding.some((c) => c.system === 'http://loinc.org' && c.code === '2160-0'), '复核后的术语对照生效')
  assert.ok(obs.extension.some((e) => e.url.endsWith('/result-flag')), '原值仍保留')
  const defs = await readdir(join(second.output, 'definitions'))
  assert.ok(defs.includes('ConceptMap-term-lab-item.json'))
  assert.notEqual(second.vocab.version, first.vocab.version)
})
