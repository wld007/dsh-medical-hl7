import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinkStats } from '../lib/model/links.js'
import { pseudonymPatientField, bindingFit, CONCEPT_DOMAINS } from '../lib/model/schema.js'
import { loadVocab } from '../lib/stages/vocab.js'

test('就诊号关联：按数据核对，纠正模型挑错的字段', () => {
  const reg = { id: 'reg', kind: 'encounter', drafted: true, name: '门诊挂号', roles: { 'encounter.outpatientNo': 'ORG' } }
  const lab = { id: 'lab', kind: 'lab', drafted: true, name: '门诊检验', roles: { 'encounter.outpatientNo': 'REQ_NO', 'encounter.inpatientNo': 'JUNK' } }
  const L = createLinkStats()
  for (let p = 0; p < 3; p++) {
    const recs = []
    for (let v = 0; v < 5; v++) {
      const no = `MZ${p}${v}0001`
      recs.push({ spec: reg, row: { ORG: 'H0001', VISIT_NO: no } })
      for (let k = 0; k < 2; k++) recs.push({ spec: lab, row: { REQ_NO: `SQ${p}${v}${k}999`, VST: no, JUNK: `X${p}${v}${k}000` } })
    }
    L.add(recs)
  }
  const fixes = L.decide(new Map([['reg', reg], ['lab', lab]]))
  const f = (t, r) => fixes.find((x) => x.table === t && x.role === r)
  assert.equal(f('reg', 'encounter.outpatientNo').field, 'VISIT_NO')
  assert.equal(f('lab', 'encounter.outpatientNo').field, 'VST')
  assert.equal(f('lab', 'encounter.inpatientNo').field, null, '对不上的就诊号拿掉')
})

test('病人编号：多个证件号假名时取同一病人文件里不变的', () => {
  const t = { fields: [{ name: 'DOC_ID', pseudonym: '证件', fill: 100 }, { name: 'PT_ID', pseudonym: '证件', fill: 100 }] }
  const rows = [{ DOC_ID: '证件-AAAAAA', PT_ID: '证件-111111' }, { DOC_ID: '证件-BBBBBB', PT_ID: '证件-111111' }, { DOC_ID: '证件-CCCCCC', PT_ID: '证件-111111' }]
  assert.equal(pseudonymPatientField(t, rows, [0, 0, 0]), 'PT_ID')
})

test('值域绑定：意思对不上的不放行，取值认不出的判为绑错', async () => {
  assert.ok(!CONCEPT_DOMAINS['encounter.setting'])
  const vocab = await loadVocab(null)
  const rows = Array.from({ length: 10 }, (_, i) => ({ AGE: String(60 + i) }))
  const [x] = bindingFit({ roles: { 'patient.gender.code': 'AGE' }, domains: { 'patient.gender': 'gender' } }, rows, vocab.domains)
  assert.equal(x.ok, false)
})
