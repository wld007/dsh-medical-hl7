import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFictionalPatient } from './fixtures/fictional.mjs'
import { createService } from '../lib/service.js'
import { loincValid, snomedConceptValid } from '../lib/fhir/checkdigit.js'

/** Mock models answering from the JSON embedded at the end of the prompt. */
function mock(name, log) {
  return {
    model: name,
    async chat(messages) {
      const p = messages.at(-1).content
      log.push({ name, kind: p.slice(0, 30) })
      const tail = (label) => JSON.parse(p.slice(p.lastIndexOf(label) + label.length).trim())
      let out
      if (p.includes('起草它到公共中间模型的映射规格')) {
        out = { kind: 'document', name: '随访记录', key: ['REC_ID'], roles: { 'patient.id': 'ID_CRD_NO', 'org.code': 'ORG_CD', 'actor.author.name': 'FLW_DCT', 'time.authored': 'FLW_TM', 'encounter.outpatientNo': 'VISIT_NO' }, sections: [['FLW_RESULT', '随访结果']] }
      } else if (p.includes('独立的数据映射审查员')) {
        out = { ok: true, issues: [] }
      } else if (p.includes('值域中还没有对照的取值')) {
        out = { r: tail('取值：').map((x) => (x.name === 'μIU/ml' ? { id: x.id, verdict: 'map', to: 'u[IU]/mL', reason: 'μ = u' } : { id: x.id, verdict: 'unsure', to: null, reason: '不知道' })) }
      } else if (p.includes('独立的数据质量审查员')) {
        out = { r: tail('结论：').map((x) => ({ id: x.id, ok: true, reason: '' })) }
      } else if (p.includes('改写成检索要素')) {
        const EN = { 肌酐: ['Creatinine'], 葡萄糖: ['Glucose'], 胰岛素: ['Insulin'] }
        out = { r: tail('概念：').map((x) => ({ id: x.id, terms: EN[x.name] ?? [] })) }
      } else if (p.includes('你的选择与独立审查员')) {
        out = { r: JSON.parse(p.slice(p.indexOf('待复判：') + 4, p.indexOf('\n概念与候选：'))).map((x) => ({ id: x.id, revise: true, code: null, reason: '放弃' })) }
      } else if (p.includes('选出对应的代码')) {
        // 识别：肌酐按单位选 SCnc；葡萄糖故意给一个不在候选里的代码
        out = { r: tail('概念与候选：').map((x) => (x.name === '葡萄糖' && !p.includes('独立的术语审查员') ? { id: x.id, code: '1234-5' } : { id: x.id, code: x.candidates.find((c) => c.property === (x.context?.unit?.[0] === 'umol/L' ? 'SCnc' : 'MCnc'))?.code ?? null, equivalence: 'equivalent', reason: '按单位' })) }
      } else out = {}
      return { text: JSON.stringify(out), usage: { total_tokens: 10 }, ms: 1 }
    },
  }
}
const wait = async (svc, id) => { for (let i = 0; i < 800; i++) { const { run } = await svc.status(id); if (run.status !== 'running' && !svc.isRunning()) return run; await new Promise((r) => setTimeout(r, 25)) } throw new Error('timeout') }

test('校验位：LOINC mod10、SNOMED CT Verhoeff', () => {
  assert.ok(loincValid('2160-0')); assert.ok(!loincValid('2160-1')); assert.ok(!loincValid('1234-5'))
  assert.ok(snomedConceptValid('260385009')); assert.ok(!snomedConceptValid('260385008'))
})

test('模型：起草规格、补值域、找术语；插件校验拦下编造的代码；结果存本机、下次复用', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-model-')))
  await writeFictionalPatient(join(base, 'in', '病人A'))
  const log = []
  const loinc = join(base, 'Loinc.csv')
  await writeFile(loinc, ['"LOINC_NUM","COMPONENT","PROPERTY","TIME_ASPCT","SYSTEM","SCALE_TYP","METHOD_TYP","CLASS","STATUS","SHORTNAME","LONG_COMMON_NAME","EXAMPLE_UCUM_UNITS","COMMON_TEST_RANK"',
    '"2160-0","Creatinine","MCnc","Pt","Ser/Plas","Qn","","CHEM","ACTIVE","Creat SerPl-mCnc","Creatinine [Mass/volume] in Serum or Plasma","mg/dL","1"',
    '"14682-9","Creatinine","SCnc","Pt","Ser/Plas","Qn","","CHEM","ACTIVE","Creat SerPl-sCnc","Creatinine [Moles/volume] in Serum or Plasma","umol/L","20"',
    '"2345-7","Glucose","MCnc","Pt","Ser/Plas","Qn","","CHEM","ACTIVE","Glucose SerPl-mCnc","Glucose [Mass/volume] in Serum or Plasma","mg/dL","2"',
    '"6690-2","Leukocytes","NCnc","Pt","Bld","Qn","Automated count","HEM/BC","ACTIVE","WBC # Bld Auto","Leukocytes [#/volume] in Blood by Automated count","10*3/uL","3"'].join('\n'))
  const svc = createService({ config: { outputRoot: join(base, 'out'), baseURL: 'x', model: 'm', loincTable: loinc }, defaultDirectory: base, stateDir: join(base, 'state'), chatImpl: { suggest: mock('suggest', log), verify: mock('verify', log) } })
  const run = await wait(svc, (await svc.start({ inputDir: join(base, 'in') })).runId)
  assert.equal(run.error, undefined, run.error)
  assert.equal(run.model.configured, true)
  assert.equal(run.model.phases.schema.tables, 1)
  assert.equal(run.model.phases.schema.applied, 1)
  assert.equal(run.model.phases.values.confirmed, 1)
  assert.equal(run.model.phases.terms.confirmed, 1, '只有肌酐被采用')
  assert.ok(run.model.phases.terms.skipped.some((x) => /SNOMED/.test(x.target)), '没有代码表的标准不交给模型')
  const { openVocabStore } = await import('../lib/stages/vocabstore.js')
  const vs = await openVocabStore(join(base, 'state', 'vocab'))
  assert.equal(vs.kind, 'sqlite')
  assert.equal((await vs.specs()).length, 1, '起草的规格存进本机对照库')
  assert.ok((await vs.history('spec', 'some_followup_table.json')).some((x) => x.origin === 'model'), '改动有记录')

  const bundle = JSON.parse(await readFile(join(run.output, 'bundles', '病人A.json'), 'utf8'))
  const R = bundle.entry.map((e) => e.resource)
  assert.equal(R.filter((r) => r.resourceType === 'Basic').length, 0, '没有规格的表按模型起草的规格转换，不再是 Basic')
  const doc = R.find((r) => r.resourceType === 'DocumentReference' && r.description === '随访记录')
  assert.ok(doc, '随访表 → DocumentReference')
  assert.equal(doc.meta.tag[0].code, 'schema-model-drafted')
  assert.match(Buffer.from(doc.content[0].attachment.data, 'base64').toString(), /【随访结果】\n血压控制可/)
  const crea = R.find((r) => r.resourceType === 'Observation' && r.code.text === '肌酐')
  const lc = crea.code.coding.find((c) => c.system === 'http://loinc.org')
  assert.equal(lc.code, '14682-9', '按单位 umol/L 选物质的量浓度')
  assert.equal(lc.extension[0].valueCode, 'model-unreviewed', '模型给出、未复核的编码有标记')
  const glu = R.find((r) => r.resourceType === 'Observation' && r.code.text === '葡萄糖')
  assert.ok(!(glu.code.coding ?? []).some((c) => c.system === 'http://loinc.org'), '不在候选里的代码被拦下')
  const ins = R.find((r) => r.resourceType === 'Observation' && r.code.text === '胰岛素')
  assert.equal(ins.valueQuantity.code, 'u[IU]/mL', '模型补的单位对照生效')
  assert.equal(ins.valueQuantity.unit, 'μIU/ml', '原文保留')

  const tv = await svc.terminologyView(run.id)
  const g = tv.bindings.find((b) => b.id === 'lab-item').items.find((c) => c.display === '葡萄糖')
  assert.equal(g.current.status, 'pending')
  assert.ok(g.current.trail.some((x) => x.step === '插件校验'))
  const insu = tv.bindings.find((b) => b.id === 'lab-item').items.find((c) => c.display === '胰岛素')
  assert.match(insu.current.note, /检索不到候选/)
  const mv = await svc.modelView(run.id)
  assert.ok(mv.calls.length > 0)
  assert.ok(mv.calls.every((c) => !('prompt' in c) && !('reply' in c)), '调用记录不含内容')

  // 第二批：全部复用，不再问模型
  const before = log.length
  const run2 = await wait(svc, (await svc.rerun(run.id)).runId)
  assert.equal(run2.error, undefined, run2.error)
  assert.equal(log.length, before, '对照已在本机，不再调用模型')

  // 人工确认后不再带“未复核”标记
  await svc.confirmModel({ kind: 'term', id: 'lab-item', key: tv.bindings.find((b) => b.id === 'lab-item').items.find((c) => c.display === '肌酐').key })
  await svc.reviewDraft({ file: 'some_followup_table.json', action: 'confirm' })
  const run3 = await wait(svc, (await svc.rerun(run.id)).runId)
  const R3 = JSON.parse(await readFile(join(run3.output, 'bundles', '病人A.json'), 'utf8')).entry.map((e) => e.resource)
  assert.equal(R3.find((r) => r.resourceType === 'Observation' && r.code.text === '肌酐').code.coding.find((c) => c.system === 'http://loinc.org').extension, undefined)
  assert.equal(R3.find((r) => r.resourceType === 'DocumentReference' && r.description === '随访记录').meta.tag, undefined)
})

test('没有配置模型：行为与以前一致（无规格的表按 Basic 保留）', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-nomodel-')))
  await writeFictionalPatient(join(base, 'in', '病人A'))
  const svc = createService({ config: { outputRoot: join(base, 'out') }, defaultDirectory: base, stateDir: join(base, 'state') })
  const run = await wait(svc, (await svc.start({ inputDir: join(base, 'in') })).runId)
  assert.equal(run.model.configured, false)
  const R = JSON.parse(await readFile(join(run.output, 'bundles', '病人A.json'), 'utf8')).entry.map((e) => e.resource)
  assert.equal(R.filter((r) => r.resourceType === 'Basic').length, 1)
})

test('没有单独的核验模型：由识别模型盲审；盲审失败不算“结论一致”', async () => {
  const { reviewLoop } = await import('../lib/model/loop.js')
  const items = [{ id: 'a' }, { id: 'b' }]
  const r1 = await reviewLoop({ items, maxRounds: 2, batch: 2,
    propose: async (l) => new Map(l.map((x) => [x.id, { v: 1 }])), check: () => null,
    blind: async () => { throw new Error('未配置核验模型') }, adjudicate: async () => new Map() })
  assert.deepEqual(r1.results.map((x) => x.outcome), ['review', 'review'], '盲审失败转人工')
  assert.equal(r1.cross.reviewed, 0)

  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-same-')))
  await writeFictionalPatient(join(base, 'in', '病人A'))
  const log = []
  const svc = createService({ config: { outputRoot: join(base, 'out'), baseURL: 'x', model: 'm' }, defaultDirectory: base, stateDir: join(base, 'state'), chatImpl: { suggest: mock('suggest', log) } })
  const run = await wait(svc, (await svc.start({ inputDir: join(base, 'in') })).runId)
  assert.equal(run.model.sameModel, true)
  assert.equal(run.model.phases.schema.cross.reviewed, 1, '识别模型做了盲审')
  assert.ok(log.some((x) => x.name === 'suggest' && x.kind.includes('独立的数据映射审查员')))
  svc.dispose()
})
