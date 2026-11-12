import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFictionalPatient, fakeIdCard } from './fixtures/fictional.mjs'
import { createService } from '../lib/service.js'
import { loadProfiles, findUnits, readUnit } from '../lib/source.js'
import { convertPatient, createContext } from '../lib/convert.js'
import { validateResources } from '../lib/fhir/validate.js'
import { parseTime, parseNumber, referenceRange } from '../lib/fhir/datatypes.js'
import { scanResidual } from '../lib/gates.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitDone(svc, id) {
  for (let i = 0; i < 400; i++) {
    const { run } = await svc.status(id)
    if (run && run.status !== 'running') return run
    await sleep(25)
  }
  throw new Error('timeout')
}

async function convertFixture(opts) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-conv-')))
  await writeFictionalPatient(join(base, 'in', '病人A'), opts)
  const profiles = await loadProfiles()
  const [unit] = await findUnits(join(base, 'in'), () => false, profiles)
  const r = await readUnit(unit, profiles, join(base, 'in'))
  const [[key, p]] = [...r.patients]
  return convertPatient(key, p.records, createContext({ profileId: 'regional-platform' }))
}
const find = (out, type, pred = () => true) => out.resources.filter((r) => r.resourceType === type && pred(r))
const fieldExt = (r, name) => r.extension?.find((e) => e.url.endsWith('/source-field') && e.extension[0].valueString === name)?.extension[1].valueString

test('时间、数值、参考范围解析', () => {
  assert.deepEqual(parseTime(1578000000000), { kind: 'dateTime', value: '2020-01-03T05:20:00+08:00' })
  assert.deepEqual(parseTime('19500102'), { kind: 'date', value: '1950-01-02' })
  assert.deepEqual(parseTime('2020-01-21 10:00:00'), { kind: 'dateTime', value: '2020-01-21T10:00:00+08:00' })
  assert.deepEqual(parseTime('2016-11-22'), { kind: 'date', value: '2016-11-22' })
  assert.deepEqual(parseTime('20241122132309'), { kind: 'dateTime', value: '2024-11-22T13:23:09+08:00' })
  assert.equal(parseTime(-910080000000).value.slice(0, 10), '1941-03-01', '与同一病人人口信息表的 19410301 一致')
  assert.equal(parseTime('2020-02-30'), undefined)
  assert.equal(parseTime('abc'), undefined)
  assert.deepEqual(parseNumber('<0.5'), { value: 0.5, comparator: '<', text: '0.5' })
  assert.equal(parseNumber('阴性'), undefined)
  assert.deepEqual(referenceRange('2.86-8.2', 'mmol/L'), { text: '2.86-8.2', low: { value: 2.86, unit: 'mmol/L' }, high: { value: 8.2, unit: 'mmol/L' } })
})

test('区域平台：各类记录转成对应资源，值不变，未映射字段保留', async () => {
  const out = await convertFixture()
  const [patient] = find(out, 'Patient')
  assert.equal(patient.identifier[0].value, '证件-AAAAAA')
  assert.equal(patient.gender, 'male')
  assert.equal(patient.birthDate, '1950-01-02', '人口信息表优先于就诊表的出生日期')
  assert.equal(patient.name[0].text, '化名-BBBBBB')
  assert.equal(patient.telecom[0].value, '电话-777777')
  assert.equal(patient.address[0].text, '地址-333333')
  assert.ok(patient.identifier.some((i) => i.value === '病历-444444' && i.assigner), 'PID 作为机构内标识')

  const encs = find(out, 'Encounter', (e) => e.status === 'finished')
  assert.equal(encs.length, 2)
  const amb = encs.find((e) => e.class.code === 'AMB')
  assert.equal(amb.period.start, '2020-01-03T05:20:00+08:00')
  assert.equal(fieldExt(amb, 'MYSTERY_FIELD'), '保留我')
  const imp = encs.find((e) => e.class.code === 'IMP')
  assert.ok(imp.period.end)

  const conds = find(out, 'Condition', (c) => c.category[0].coding[0].code === 'encounter-diagnosis')
  assert.equal(conds.length, 2)
  const voided = conds.find((c) => c.verificationStatus)
  assert.equal(voided.verificationStatus.coding[0].code, 'entered-in-error')
  const stub = find(out, 'Encounter', (e) => `Encounter/${e.id}` === voided.encounter.reference)[0]
  assert.equal(stub.identifier[0].value, '住院-999999', '就诊表里没有的住院号：按号码建登记缺失的就诊')
  assert.equal(stub.status, 'unknown')
  assert.equal(stub.class.code, 'IMP')
  assert.equal(stub.period, undefined, '不编造时间')
  assert.equal(stub.meta.tag[0].code, 'encounter-not-registered')
  assert.equal(out.stats.unresolvedEncounters, 1)
  assert.ok(find(out, 'Condition', (c) => c.category[0].coding[0].code === 'problem-list-item').length, '病史标志 → 问题列表')

  const labs = find(out, 'Observation', (o) => o.category?.[0].coding[0].code === 'laboratory')
  const crea = labs.find((o) => o.code.text === '肌酐')
  assert.deepEqual(crea.valueQuantity, { value: 856, unit: 'umol/L', system: 'http://unitsofmeasure.org', code: 'umol/L' })
  assert.equal(crea.referenceRange[0].low.value, 57)
  assert.equal(crea.interpretation, undefined, '含义不明的结果标志不换算')
  assert.equal(crea.extension.find((e) => e.url.endsWith('/result-flag')).valueCoding.code, '1')
  assert.equal(fieldExt(crea, 'AGE'), '70')
  assert.equal(labs.find((o) => o.code.text === '尿酸').valueString, '阴性')
  assert.equal(labs.find((o) => o.code.text === '葡萄糖').valueQuantity.comparator, '<')
  const reports = find(out, 'DiagnosticReport', (d) => d.category?.[0].coding?.[0].code === 'LAB')
  assert.equal(reports.length, 2, '按报告号归并')
  assert.equal(reports.find((d) => d.result.length === 2).code.text, '肾功能')

  const img = find(out, 'DiagnosticReport', (d) => d.category?.[0].text === 'CT')[0]
  assert.equal(img.conclusion, '未见异常\n请结合临床')
  assert.match(Buffer.from(img.presentedForm[0].data, 'base64').toString(), /所见：两肺纹理清。/)

  const [proc] = find(out, 'Procedure')
  assert.equal(proc.code.coding[0].code, '39.2701')
  assert.match(proc.code.coding[0].system, /icd-9-cm-3-cn$/)
  assert.ok(proc.performedPeriod.end)
  assert.equal(fieldExt(proc, 'ABO_CD'), '5')

  const [doc] = find(out, 'DocumentReference')
  assert.equal(doc.type.coding[0].code, '34108-1')
  const text = Buffer.from(doc.content[0].attachment.data, 'base64').toString()
  assert.match(text, /【主诉】\n乏力1月。/)
  assert.equal(fieldExt(doc, 'PSQ_EXAM_STLC_PRS'), undefined, '体征字段已转成 Observation，不再重复保留')
  const bp = find(out, 'Observation', (o) => o.code.coding?.[0].code === '85354-9')[0]
  assert.equal(bp.component.length, 2)
  assert.equal(bp.derivedFrom[0].reference, `DocumentReference/${doc.id}`)

  const [height] = find(out, 'Observation', (o) => o.code.coding?.[0].code === '8302-2' && fieldExt(o, 'SOURCE_TB'))
  assert.equal(height.valueQuantity.value, 170)
  const smoke = find(out, 'Observation', (o) => o.code.coding?.some((c) => c.code === '72166-2'))[0]
  assert.equal(smoke.valueCodeableConcept.text, '吸烟')

  const sym = find(out, 'Observation', (o) => o.code.text === '症状')[0]
  assert.equal(sym.valueCodeableConcept.coding, undefined, '含换行的代码不进 coding')
  assert.equal(sym.valueCodeableConcept.text, '乏力\r\nnone')
  assert.equal(sym.extension.find((e) => e.url.endsWith('/code-as-recorded')).valueString, '乏力\r\nnone')

  const [charge] = find(out, 'ChargeItem')
  assert.equal(charge.extension.find((e) => e.url.endsWith('/total-price')).valueMoney.value, 5.8)

  const [basic] = find(out, 'Basic')
  assert.equal(fieldExt(basic, 'FLW_RESULT'), '血压控制可', '未知表全部字段保留')
  assert.equal(basic.subject.reference, `Patient/${patient.id}`)
  assert.equal(basic.author.reference.startsWith('Organization/'), true, '自动推断出机构')

  const v = validateResources(out.resources)
  assert.deepEqual(v.errors, [])
})

test('编号稳定：两次转换的资源 id 完全一致', async () => {
  const a = await convertFixture(); const b = await convertFixture()
  assert.deepEqual(a.resources.map((r) => `${r.resourceType}/${r.id}`).sort(), b.resources.map((r) => `${r.resourceType}/${r.id}`).sort())
})

test('残留身份证号检查', () => {
  const id = fakeIdCard()
  const hits = scanResidual([{ resourceType: 'Basic', id: 'x', note: `号码 ${id} 在这里`, other: '20位申请单号16560558228160723488不算' }])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, '身份证号')
  assert.ok(!hits[0].value.includes(id.slice(2, 10)), '报告里只记遮盖后的值')
})

test('批次：交付布局、源文件只读、暂扣、报告、Bulk NDJSON', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-svc-')))
  const input = join(base, 'cohort')
  await writeFictionalPatient(join(input, '病人A'))
  await writeFictionalPatient(join(input, '病人B'), { id: '证件-CCCCCC', name: '化名-DDDDDD', extraText: `联系电话13912345678` })
  const src = join(input, '病人A', '检验/检验记录/202001/p_doc_fact_test_rcd.json')
  const before = await stat(src)
  const svc = createService({ config: { outputRoot: join(base, 'out') }, defaultDirectory: base, stateDir: join(base, 'state') })
  const { runId } = await svc.start({ inputDir: input })
  const run = await waitDone(svc, runId)
  assert.equal(run.error, undefined, run.error)
  assert.equal(run.status, 'review', '有暂扣的病人')
  assert.equal(run.totals.patients, 2)
  assert.equal(run.totals.held, 1)
  assert.equal(run.output, join(base, 'out', 'cohort'))
  assert.deepEqual((await readdir(join(run.output, 'bundles'))).sort(), ['病人A.json'])
  assert.deepEqual(await readdir(join(run.runDir, 'held')), ['病人B.json'])
  const bundle = JSON.parse(await readFile(join(run.output, 'bundles', '病人A.json'), 'utf8'))
  assert.equal(bundle.type, 'transaction')
  assert.ok(bundle.entry.every((e) => e.request.method === 'PUT' && e.fullUrl.endsWith(`${e.resource.resourceType}/${e.resource.id}`)))
  const manifest = JSON.parse(await readFile(join(run.output, 'manifest.json'), 'utf8'))
  assert.ok(manifest.output.some((o) => o.type === 'Patient' && o.count === 1))
  const obs = (await readFile(join(run.output, 'ndjson', 'Observation.ndjson'), 'utf8')).trim().split('\n')
  assert.ok(obs.length > 3)
  const after = await stat(src)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(run.sourceCheck.changed, 0)
  const rep = (await svc.report(runId)).markdown
  assert.match(rep, /HL7 FHIR 转换报告/)
  assert.match(rep, /残留手机号/)
  assert.ok(!rep.includes('13912345678'), '报告不含原值')
  assert.match(rep, /自动推断/)
  assert.equal((await svc.list()).runs.length, 1)
})

test('输出根目录不能与输入相同或包含输入', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hl7-guard-')))
  await writeFictionalPatient(join(base, 'in'))
  const svc = createService({ defaultDirectory: base })
  await assert.rejects(svc.start({ inputDir: join(base, 'in'), outputRoot: join(base, 'in') }), /不能与输入相同/)
  await assert.rejects(svc.start({ inputDir: join(base, 'in'), outputRoot: base }), /不能包含输入/)
  await assert.rejects(svc.start({ inputDir: join(base, 'in'), outputRoot: join(base, 'in', 'x') }), /不能放在输入目录里面/)
})
