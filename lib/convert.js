/**
 * ④ FHIR 组装：一位病人的“归一记录”→ FHIR R4 资源。只拼装，不解析任何取值。
 *
 * 输入：records = [{ spec, N }]，N 是经过 Schema 同构、值域归一、术语对照的记录（见 stages/）。
 * 输出：{ patient, resources, stats, issues }。
 *
 * 取值规则：
 *   - 值域归一状态为 normalized 的，用规范值（并保留原代码作为第二个 coding、原文作为 text）；
 *   - 其他状态（待确认、无对照、不属于本值域、无法解析）一律用原值，不猜；
 *   - 术语对照已确认的，另加一个标准编码；
 *   - 同构阶段没对上角色的字段（extras），原样挂 source-field 扩展。
 * 编号稳定：资源 id 由来源表与源记录主键派生，重跑不变。
 */
import { isBlank, str, stableId, token, base64, clean } from './fhir/datatypes.js'
import * as T from './fhir/terms.js'

export function createContext({ namespace = 'http://dsh.local/fhir', timezone = '+08:00', profileId = 'source' } = {}) {
  const ns = namespace.replace(/\/+$/, '')
  return {
    ns, timezone, profileId,
    idSys: (name) => `${ns}/id/${name}`,
    csSys: (name, org) => `${ns}/CodeSystem/${name}${org ? `/org-${token(org)}` : ''}`,
    ext: (name) => `${ns}/StructureDefinition/${name}`,
    resolve: (system) => (system ? system.replace('{ns}', ns) : system),
  }
}

const ACT_DISPLAY = { AMB: 'ambulatory', IMP: 'inpatient encounter', EMER: 'emergency' }
const INTERP_DISPLAY = { L: 'Low', H: 'High', N: 'Normal', LL: 'Critical low', HH: 'Critical high', A: 'Abnormal' }

export function convertPatient(patientKey, records, ctx, { patientIdSystem = 'id-card' } = {}) {
  const { idSys, csSys, ext, resolve } = ctx
  const out = new Map()
  const issues = []
  const stats = { records: records.length, byKind: {}, byType: {}, leftoverFields: {}, unresolvedEncounters: 0, timeUnparsed: {}, invalidRecords: 0 }
  const add = (r) => { const k = `${r.resourceType}/${r.id}`; if (!out.has(k)) out.set(k, r); return out.get(k) }
  const ref = (r) => ({ reference: `${r.resourceType}/${r.id}` })
  const note = (msg) => { if (issues.length < 500) issues.push(msg) }
  const PLACER = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC', display: 'Placer Identifier' }], text: '电子申请单号' }
  let cur = null // { spec, N, profile }

  /* ------------------------------------------------------------ Patient */
  const patient = { resourceType: 'Patient', id: stableId('Patient', patientIdSystem, patientKey), identifier: [{ use: 'official', system: idSys(patientIdSystem), value: patientKey }] }
  add(patient)
  const pat = { names: new Map(), genders: [], births: [], telecoms: new Set(), addresses: [], marital: null, extra: [], identifiers: new Map() }
  const patientRef = ref(patient)
  /** 婚姻状况：取最近一次已归一的登记；都没有归一时取最近一次登记的原值。 */
  const noteMarital = (concept, at) => {
    const slot = concept.status === 'normalized' ? 'maritalNorm' : 'maritalRaw'
    if (!pat[slot] || at >= pat[slot].at) pat[slot] = { concept, at }
    pat.marital = pat.maritalNorm ?? pat.maritalRaw
  }

  /* ----------------------------------------------------- record accessors */
  const raw = (role) => cur.N.roles[role]?.raw
  const s = (role) => str(raw(role))
  const val = (role) => { const v = cur.N.values[role]; return v?.status === 'normalized' ? v.value : undefined }
  const dt = (role) => { const v = val(role); if (cur.N.values[role] && !v) stats.timeUnparsed[role] = (stats.timeUnparsed[role] ?? 0) + 1; return v?.value }
  const d = (role) => dt(role)?.slice(0, 10)
  const inst = (role) => { const v = val(role); return v?.kind === 'dateTime' ? v.value : undefined }
  const num = (role) => val(role)
  const concept = (name) => cur.N.concepts[name]
  const conceptTo = (name) => (concept(name)?.status === 'normalized' ? concept(name).to : undefined)
  const terms = (binding) => cur.N.terms?.[binding]?.codings ?? []

  /* -------------------------------------------------------- codings */
  let badCodes = []
  const coding = (system, code, display) => {
    const c = str(code); const dsp = str(display)
    if (!c) return undefined
    if (!/^[^\s]+( [^\s]+)*$/.test(c)) { badCodes.push(String(code)); return undefined }
    return { system, code: c, display: dsp }
  }
  const badCodeExts = () => { const l = badCodes.map((b) => ({ url: ext('code-as-recorded'), valueString: b.trim() || JSON.stringify(b) })); badCodes = []; return l }
  // 模型给出、未经人工复核的编码：在 coding 上标 mapping-origin 扩展
  const markModel = (c) => {
    if (!c || typeof c !== 'object' || !('_origin' in c)) return c
    const { _origin, ...rest } = c
    return _origin === 'model' ? { ...rest, extension: [{ url: ext('mapping-origin'), valueCode: 'model-unreviewed' }] } : rest
  }
  const cc = (codings, text) => clean({ coding: codings.filter(Boolean).map(markModel), text: str(text) })
  const sysFor = (key, fallbackName, org) => {
    const c = cur.spec.codeSystems?.[key]
    return csSys(`${cur.profile}/${c?.name ?? fallbackName}`, c?.scope === 'org' ? org?.id : undefined)
  }
  /** Enum concept → CodeableConcept: normalized coding first, then the original local coding; text = original name. */
  const conceptCC = (name, sysKey, fallbackName, org) => {
    const c = concept(name)
    if (!c) return undefined
    const norm = c.status === 'normalized' && c.value?.code ? { system: resolve(c.value.system), code: c.value.code, display: c.value.display, _origin: c.origin } : undefined
    // text：已归一用规范名称，否则用原文；原代码/原名称保留在本地 coding 里
    return cc([norm, coding(sysFor(sysKey, fallbackName, org), c.code ?? c.display, c.display ?? c.label)], c.value?.label ?? c.display ?? c.label ?? c.code)
  }
  const recordIdentifier = (key) => ({ system: idSys(`record/${cur.profile}/${cur.N.table}`), value: key })
  const metaOf = (file) => ({ source: `${ctx.ns}/source#${encodeURIComponent(file)}`, ...(cur?.spec?.drafted && !cur.spec.reviewed ? { tag: [{ system: ext('tag'), code: 'schema-model-drafted', display: '按模型起草、未经人工复核的映射规格转换' }] } : {}) })
  function leftovers(N = cur.N, skip) {
    const list = []
    for (const e of N.extras) {
      if (skip?.has(e.field)) continue
      list.push({ url: ext('source-field'), extension: [{ url: 'name', valueString: e.field }, { url: 'value', valueString: e.raw }] })
      const k = `${N.table}.${e.field}`
      stats.leftoverFields[k] = (stats.leftoverFields[k] ?? 0) + 1
    }
    return list
  }
  /** Flag concept → extension: normalized yes/no → boolean, otherwise the original value. */
  const flagExt = (name, urlName) => {
    const c = concept(name)
    if (!c) { const r = s(name); return r ? { url: ext(`flag-${urlName}`), valueString: r } : undefined }
    if (c.status === 'normalized' && (c.to === 'Y' || c.to === 'N')) return { url: ext(`flag-${urlName}`), valueBoolean: c.to === 'Y' }
    return { url: ext(`flag-${urlName}`), valueString: c.code ?? c.display }
  }
  const deptExt = (dept) => (dept ? { url: ext('department'), valueReference: ref(dept) } : undefined)
  const orgExt = (org) => (org ? { url: ext('organization'), valueReference: ref(org) } : undefined)

  /* -------------------------------------------- Organization / Practitioner */
  function organization(code, name) {
    const c = str(code); const n = str(name)
    if (!c && !n) return undefined
    const o = add({ resourceType: 'Organization', id: stableId('Organization', c ?? `name:${n}`), identifier: c ? [{ system: idSys('org-code'), value: c }] : undefined, name: n })
    if (n && !o.name) o.name = n
    return o
  }
  function department(org, code, name) {
    const c = str(code); const n = str(name)
    if (!c && !n) return undefined
    const std = terms('department')
    const o = add({
      resourceType: 'Organization', id: stableId('Department', org?.id ?? '', c ?? `name:${n}`),
      identifier: c ? [{ system: org ? csSys('dept-code', org.id) : idSys('dept-code'), value: c }] : undefined,
      type: [{ coding: [{ system: T.ORG_TYPE, code: 'dept', display: 'Hospital Department' }] }, ...(std.length ? [{ coding: std.map(markModel) }] : [])],
      name: n, partOf: org ? ref(org) : undefined,
    })
    if (n && !o.name) o.name = n
    return o
  }
  function practitioner(org, code, name) {
    const c = str(code); const n = str(name)
    if (!c && !n) return undefined
    const p = add({ resourceType: 'Practitioner', id: stableId('Practitioner', org?.id ?? '', c ?? `name:${n}`), identifier: c ? [{ system: idSys('staff-code'), value: c, assigner: org ? ref(org) : undefined }] : undefined, name: n ? [{ text: n }] : undefined })
    if (n && !p.name) p.name = [{ text: n }]
    return p
  }

  /* -------------------------------------------------------- Encounters */
  const encounters = new Map()
  const encounterFirst = new Map() // Encounter id → first record's extras (field → raw)
  function encounterKeyOf() {
    const setting = conceptTo('encounter.setting')
    const o = s('encounter.outpatientNo'); const i = s('encounter.inpatientNo')
    if (setting === 'IMP' && i) return { key: `I|${i}`, no: i, sys: 'inpatient-no' }
    if (o) return { key: `O|${o}`, no: o, sys: 'outpatient-no' }
    if (i) return { key: `I|${i}`, no: i, sys: 'inpatient-no' }
    return undefined
  }
  function encounterRef(org) {
    const k = encounterKeyOf()
    if (!k) return undefined
    let e = encounters.get(k.key)
    if (!e) {
      stats.unresolvedEncounters++
      e = add(clean({
        resourceType: 'Encounter', id: stableId('Encounter', patient.id, k.key),
        meta: { tag: [{ system: ext('tag'), code: 'encounter-not-registered', display: '就诊表里没有这次就诊，由其他记录引用的号码推出' }] },
        identifier: [clean({ system: idSys(k.sys), value: k.no, assigner: org ? ref(org) : undefined })],
        status: 'unknown',
        class: k.sys === 'inpatient-no' ? { system: T.V3_ACT_CODE, code: 'IMP', display: 'inpatient encounter' } : { system: T.V3_ACT_CODE, code: 'AMB', display: 'ambulatory' },
        subject: patientRef, serviceProvider: org ? ref(org) : undefined,
      }))
      encounters.set(k.key, e)
    }
    return ref(e)
  }

  /* ------------------------------------------------------------ common */
  function common() {
    const pn = s('patient.name'); if (pn) pat.names.set(pn, (pat.names.get(pn) ?? 0) + 1)
    const g = conceptTo('patient.gender'); if (g) pat.genders.push({ g, primary: cur.spec.kind === 'patient' })
    const b = d('patient.birthDate'); if (b) pat.births.push({ b, primary: cur.spec.kind === 'patient' })
    const tel = s('patient.telecom'); if (tel) pat.telecoms.add(tel)
    const org = organization(raw('org.code'), raw('org.name'))
    const lid = s('patient.localId')
    if (lid) pat.identifiers.set(`pid|${org?.id ?? ''}|${lid}`, { use: 'secondary', system: idSys('patient-local-id'), value: lid, assigner: org ? ref(org) : undefined })
    const card = s('patient.card')
    if (card) pat.identifiers.set(`card|${org?.id ?? ''}|${card}`, { use: 'secondary', system: idSys('patient-card'), value: card, assigner: org ? ref(org) : undefined })
    const dept = department(org, raw('dept.code'), raw('dept.name'))
    const fns = new Set(Object.keys(cur.spec.roles ?? {}).filter((r) => r.startsWith('actor.')).map((r) => r.split('.')[1]))
    const acts = []
    for (const fn of fns) { const p = practitioner(org, raw(`actor.${fn}.code`), raw(`actor.${fn}.name`)); if (p) acts.push({ fn, practitioner: p }) }
    if (cur.N.invalid) stats.invalidRecords++
    return { org, dept, acts, key: cur.N.key, invalid: cur.N.invalid, file: cur.N.file, created: dt('record.created'), updated: dt('record.updated') }
  }
  const actor = (c, ...fns) => c.acts.find((a) => fns.includes(a.fn))?.practitioner
  const auditExt = (c) => [
    c.created && { url: ext('record-created'), valueDateTime: c.created },
    c.updated && { url: ext('record-updated'), valueDateTime: c.updated },
    ...c.acts.filter((a) => ['recorder', 'updater', 'other', 'collector'].includes(a.fn)).map((a) => ({ url: ext(`actor-${a.fn}`), valueReference: ref(a.practitioner) })),
  ].filter(Boolean)
  const finish = (c, resource, extra = [], skip) => {
    const mo = metaOf(c.file)
    resource.meta = { ...(resource.meta ?? {}), ...mo, ...(mo.tag || resource.meta?.tag ? { tag: [...(resource.meta?.tag ?? []), ...(mo.tag ?? [])] } : {}) }
    const exts = [...extra.filter(Boolean), ...badCodeExts(), ...auditExt(c), ...leftovers(cur.N, skip)]
    if (exts.length) resource.extension = [...(resource.extension ?? []), ...exts]
    const r = add(clean(resource))
    stats.byKind[cur.spec.kind] = (stats.byKind[cur.spec.kind] ?? 0) + 1
    return r
  }

  /* ============================================================ builders */
  const builders = {
    patient(c) {
      const n = s('name'); if (n) pat.names.set(n, (pat.names.get(n) ?? 0) + 100)
      const g = conceptTo('gender'); if (g) pat.genders.push({ g, primary: true })
      const b = d('birthDate'); if (b) pat.births.push({ b, primary: true })
      const tel = s('telecom'); if (tel) pat.telecoms.add(tel)
      if (concept('maritalStatus')) noteMarital(concept('maritalStatus'), dt('time.recorded') ?? '')
      for (const it of cur.N.items) {
        const item = cur.spec.items[it.index]
        const v = str(it.raw)
        if (v === undefined || (item.when !== undefined && v !== String(item.when))) continue
        add(clean({
          resourceType: 'Condition', id: stableId('Condition', cur.spec.id, c.key, item.field),
          meta: metaOf(c.file), identifier: [recordIdentifier(`${c.key}#${item.field}`)],
          category: [{ coding: [{ system: T.COND_CATEGORY, code: 'problem-list-item', display: 'Problem List Item' }] }],
          code: cc([coding(sysFor('history', 'history-flag'), item.condition.local, item.condition.text)], item.condition.text),
          subject: patientRef, recordedDate: it.time?.value,
          extension: [{ url: ext('source-field'), extension: [{ url: 'name', valueString: item.field }, { url: 'value', valueString: v }] }],
        }))
        stats.byKind.patient = (stats.byKind.patient ?? 0) + 1
      }
      pat.extra.push(...auditExt(c), ...leftovers())
    },

    address(c) {
      const part = (k) => s(`address.${k}.name`) ?? s(`address.${k}.code`)
      const codes = ['village', 'town', 'county', 'city', 'province'].map((k) => s(`address.${k}.code`)).filter(Boolean)
      const srcName = s('source.name')
      const a = clean({
        extension: [
          cur.spec.addressKind && { url: ext('address-kind'), valueString: cur.spec.addressKind },
          codes[0] && { url: ext('admin-division-code'), valueString: codes[0] },
          srcName && { url: ext('source-system'), valueString: srcName },
          ...auditExt(c), ...leftovers(),
        ].filter(Boolean),
        use: cur.spec.addressUse ?? 'home',
        text: s('address.text'),
        line: [s('address.town.name'), s('address.village.name'), s('address.unit'), s('address.house')].filter(Boolean),
        district: part('county'), city: part('city'), state: part('province'), postalCode: s('address.postalCode'),
        period: (() => { const x = dt('time.recorded'); return x ? { start: x } : undefined })(),
      })
      if (a) pat.addresses.push(a)
      stats.byKind.address = (stats.byKind.address ?? 0) + 1
    },

    encounter(c) {
      const k = encounterKeyOf()
      const start = dt('time.start'); const end = dt('time.end')
      const id = k ? stableId('Encounter', patient.id, k.key) : stableId('Encounter', cur.spec.id, c.key)
      const existing = out.get(`Encounter/${id}`)
      if (existing && existing.status !== 'unknown') {
        existing.identifier.push(recordIdentifier(c.key))
        if (start && (!existing.period?.start || start < existing.period.start)) existing.period = { ...existing.period, start }
        if (end && (!existing.period?.end || end > existing.period.end)) existing.period = { ...existing.period, end }
        // 与首条登记取值相同的字段不重复保留；不同的（含角色字段）原样挂 source-field
        const first = encounterFirst.get(id) ?? new Map()
        const skip = new Set(cur.N.extras.filter((e) => first.get(e.field) === e.raw).map((e) => e.field))
        const roleDiff = Object.entries(cur.N.roles)
          .filter(([role, v]) => !['time.start', 'time.end', 'patient.id'].includes(role) && first.get(v.field) !== str(v.raw))
          .map(([, v]) => ({ url: ext('source-field'), extension: [{ url: 'name', valueString: v.field }, { url: 'value', valueString: str(v.raw) }] }))
        existing.extension = [...(existing.extension ?? []), ...roleDiff, ...leftovers(cur.N, skip)]
        return
      }
      // 就诊类别：就诊类型已归一的用它；否则看就诊号种类（只有住院号的是住院）
      const cls = ['AMB', 'IMP', 'EMER'].includes(conceptTo('encounter.setting')) ? conceptTo('encounter.setting') : k?.sys === 'inpatient-no' ? 'IMP' : 'AMB'
      const period = clean({ start, end })
      if (period?.start && period?.end && period.end < period.start) { note(`就诊 ${k?.no ?? c.key}：结束时间早于开始时间，结束时间放在扩展里`); delete period.end }
      const disp = concept('dischargeDisposition')
      const ward = s('location.ward'); const bed = s('location.bed')
      const m = concept('maritalStatus')
      if (m) noteMarital(m, start ?? '')
      const setting = concept('encounter.setting')
      const settingName = setting?.label ?? undefined // 来源上的原意（如 3 = 体检），见值域条目的 label
      const enc = {
        resourceType: 'Encounter', id,
        identifier: [k && { system: idSys(k.sys), value: k.no, assigner: c.org ? ref(c.org) : undefined }, recordIdentifier(c.key)].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'finished',
        class: { system: T.V3_ACT_CODE, code: cls, display: ACT_DISPLAY[cls] },
        type: setting ? [cc([coding(sysFor('setting', 'encounter-setting'), setting.code, setting.display ?? settingName)], setting.display ?? settingName)] : undefined,
        subject: patientRef,
        participant: c.acts.filter((a) => ['attender', 'admitter', 'performer', 'author'].includes(a.fn)).map((a) => ({
          type: [{ coding: [{ system: T.V3_PARTICIPATION, ...({ attender: { code: 'ATND', display: 'attender' }, admitter: { code: 'ADM', display: 'admitter' } }[a.fn] ?? { code: 'PART', display: 'Participation' }) }] }],
          individual: ref(a.practitioner),
        })),
        period,
        reasonCode: s('reason.text') ? [{ text: s('reason.text') }] : undefined,
        hospitalization: disp ? { dischargeDisposition: conceptCC('dischargeDisposition', 'discharge', 'discharge-disposition') } : undefined,
        location: ward || bed ? [{ location: { display: [ward, bed].filter(Boolean).join(' ') } }] : undefined,
        serviceProvider: c.dept ? ref(c.dept) : c.org ? ref(c.org) : undefined,
      }
      // 之前被其他记录按号码补建的同一就诊：用登记信息替换
      if (existing) { out.delete(`Encounter/${id}`); stats.unresolvedEncounters-- }
      const r = finish(c, enc, [
        flagExt('emergency.flag', 'emergency'), flagExt('firstVisit.flag', 'first-visit'),
        m && { url: ext('marital-status-at-visit'), valueString: m.display ?? m.code },
        start && end && end < start && { url: ext('period-end-as-recorded'), valueDateTime: end },
      ])
      if (existing?.diagnosis) r.diagnosis = existing.diagnosis
      if (k) encounters.set(k.key, r)
      encounterFirst.set(id, new Map([...cur.N.extras.map((e) => [e.field, e.raw]), ...Object.values(cur.N.roles).map((v) => [v.field, str(v.raw)])]))
    },

    condition(c) {
      const icdV = cur.N.values['code.code']
      const icd = icdV?.status === 'normalized' ? icdV.value : undefined
      const icdName = s('code.display')
      const tcm = concept('tcm.flag')
      const tcmYes = tcm ? (tcm.status === 'normalized' ? tcm.to === 'Y' : tcm.code === '1') : false
      // 无法识别的诊断代码不进 ICD 代码体系，只作为原值保留（code-as-recorded）
      const icdCoding = icd
        ? coding(icd.system === 'icd-10-cn' ? sysFor('code', 'diagnosis-code') : csSys(`${cur.profile}/${icd.system}`), icd.code, icdName)
        : undefined
      const cond = {
        resourceType: 'Condition', id: stableId('Condition', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key)],
        verificationStatus: c.invalid ? { coding: [{ system: T.COND_VER, code: 'entered-in-error', display: 'Entered in Error' }] } : undefined,
        category: [{ coding: [{ system: T.COND_CATEGORY, code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
        code: cc([
          icdCoding,
          coding(sysFor('local', 'diagnosis-local', c.org), s('code.local'), icdName),
          tcmYes ? coding(sysFor('tcm', 'tcm-diagnosis', c.org), s('tcm.code'), s('tcm.display')) : undefined,
        ], s('text') ?? icdName),
        subject: patientRef,
        encounter: encounterRef(c.org),
        recordedDate: dt('time.recorded'),
        onsetDateTime: dt('time.onset'),
        asserter: actor(c, 'author') ? ref(actor(c, 'author')) : undefined,
        recorder: actor(c, 'recorder') ? ref(actor(c, 'recorder')) : undefined,
        note: s('note') ? [{ text: s('note') }] : undefined,
      }
      const cat = concept('category')
      const r = finish(c, cond, [
        icd?.asterisk && { url: ext('icd-asterisk-code'), valueCoding: { system: sysFor('code', 'diagnosis-code'), code: icd.asterisk } },
        icdV && icdV.status !== 'normalized' && s('code.code') && { url: ext('code-as-recorded'), valueString: s('code.code') },
        cat && { url: ext('diagnosis-category'), valueCodeableConcept: conceptCC('category', 'category', 'diagnosis-category') },
        concept('main.flag') ? flagExt('main.flag', 'main-diagnosis') : (s('main.flag') && { url: ext('flag-main-diagnosis'), valueString: s('main.flag') }),
        tcm && flagExt('tcm.flag', 'tcm'),
        s('order') && { url: ext('diagnosis-sequence'), valueString: s('order') },
        // 不是中医诊断却填了证候代码：原样保留
        !tcmYes && s('tcm.code') && { url: ext('source-field'), extension: [{ url: 'name', valueString: cur.N.roles['tcm.code'].field }, { url: 'value', valueString: s('tcm.code') }] },
        !tcmYes && s('tcm.display') && { url: ext('source-field'), extension: [{ url: 'name', valueString: cur.N.roles['tcm.display'].field }, { url: 'value', valueString: s('tcm.display') }] },
        orgExt(c.org), deptExt(c.dept),
      ])
      const e = cond.encounter?.reference && out.get(cond.encounter.reference)
      if (e && !c.invalid) { e.diagnosis = e.diagnosis ?? []; e.diagnosis.push({ condition: ref(r) }) }
    },

    lab(c) {
      const reportNo = s('report.no')
      const unitC = concept('unit')
      const unitRaw = s('unit')
      const v = cur.N.values.value
      const specimenName = s('specimen.display'); const specimenCode = s('specimen.code')
      let specimen
      if (specimenName || specimenCode) {
        specimen = add(clean({
          resourceType: 'Specimen', id: stableId('Specimen', patient.id, c.org?.id ?? '', reportNo ?? c.key, specimenCode ?? specimenName),
          type: cc([coding(sysFor('specimen', 'specimen', c.org), specimenCode, specimenName), ...terms('specimen')], specimenName),
          subject: patientRef,
        }))
      }
      const quantity = () => {
        const n = v.value
        const q = { value: n.value }
        if (n.comparator) q.comparator = n.comparator
        if (unitRaw) {
          q.unit = unitRaw
          if (unitC?.status === 'normalized') { q.system = T.UCUM; q.code = unitC.to }
        }
        return q
      }
      const interp = [concept('flag'), concept('flag.decision')].find((x) => x?.status === 'normalized')
      const isQty = v?.status === 'normalized' && v.value?.type === 'quantity'
      const isCoded = v?.status === 'normalized' && v.value?.type === 'coded'
      const obs = {
        resourceType: 'Observation', id: stableId('Observation', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: 'laboratory', display: 'Laboratory' }] }],
        code: cc([
          coding(sysFor('item', 'lab-item', c.org), s('item.code'), s('item.display')),
          coding(sysFor('std', 'lab-item-std'), s('item.stdCode'), s('item.stdDisplay')),
          ...terms('lab-item'),
        ], s('item.display') ?? s('item.stdDisplay') ?? '检验项目'),
        subject: patientRef,
        encounter: encounterRef(c.org),
        effectiveDateTime: dt('time.effective'),
        issued: inst('time.issued'),
        performer: [c.org && ref(c.org), actor(c, 'performer') && ref(actor(c, 'performer'))].filter(Boolean),
        valueQuantity: isQty ? quantity() : undefined,
        valueCodeableConcept: isCoded ? cc([{ system: resolve(v.value.system), code: v.value.code, display: v.value.display, _origin: v.origin }, ...terms('qualitative-result')], str(v.raw)) : undefined,
        valueString: v && !isQty && !isCoded ? str(v.raw) : undefined,
        dataAbsentReason: !v ? { coding: [{ system: T.DATA_ABSENT, code: 'unknown', display: 'Unknown' }] } : undefined,
        interpretation: interp ? [cc([{ system: resolve(interp.value.system), code: interp.to, display: INTERP_DISPLAY[interp.to], _origin: interp.origin }], interp.value.label)] : undefined,
        note: s('note') ? [{ text: s('note') }] : undefined,
        specimen: specimen ? ref(specimen) : undefined,
        referenceRange: (() => {
          const rr = cur.N.values.refRange
          if (!rr) return undefined
          const r = rr.value ?? { text: str(rr.raw) }
          const u = isQty && unitRaw ? { unit: unitRaw, ...(unitC?.status === 'normalized' ? { system: T.UCUM, code: unitC.to } : {}) } : {}
          return [clean({ low: r.low ? { value: r.low.value, ...u } : undefined, high: r.high ? { value: r.high.value, ...u } : undefined, text: r.text })]
        })(),
      }
      if (!isQty && unitRaw) obs.extension = [{ url: ext('unit-as-recorded'), valueString: unitRaw }]
      const flagExt2 = (name, urlName, sysName) => { const x = concept(name); return x ? { url: ext(urlName), valueCoding: { system: sysFor(name, sysName), code: x.code ?? x.display } } : undefined }
      const r = finish(c, obs, [
        flagExt2('flag', 'result-flag', 'lab-result-flag'), flagExt2('flag.decision', 'result-decision', 'lab-result-decision'),
        deptExt(c.dept),
        actor(c, 'verifier') && { url: ext('actor-verifier'), valueReference: ref(actor(c, 'verifier')) },
        actor(c, 'requester') && { url: ext('actor-requester'), valueReference: ref(actor(c, 'requester')) },
      ])
      const groupKey = reportNo ?? `${dt('time.effective') ?? ''}|${s('panel.code') ?? s('panel.display') ?? ''}`
      const repId = stableId('DiagnosticReport', 'lab', patient.id, c.org?.id ?? '', groupKey)
      let rep = out.get(`DiagnosticReport/${repId}`)
      if (!rep) {
        rep = add({
          resourceType: 'DiagnosticReport', id: repId, meta: metaOf(c.file),
          identifier: [reportNo && { system: idSys('lab-report-no'), value: reportNo, assigner: c.org ? ref(c.org) : undefined }, s('order.no') && { type: PLACER, system: idSys('order-no'), value: s('order.no') }].filter(Boolean),
          status: 'final',
          category: [{ coding: [{ system: T.V2_0074, code: 'LAB', display: 'Laboratory' }] }],
          code: cc([coding(sysFor('panel', 'lab-panel', c.org), s('panel.code'), s('panel.display')), ...terms('lab-panel')], s('panel.display') ?? '检验报告'),
          subject: patientRef, encounter: r.encounter,
          effectiveDateTime: r.effectiveDateTime, issued: r.issued,
          performer: c.org ? [ref(c.org)] : undefined,
          resultsInterpreter: actor(c, 'verifier') ? [ref(actor(c, 'verifier'))] : undefined,
          specimen: [], result: [], _invalid: 0, _ordered: dt('time.ordered'),
        })
        if (rep._ordered) rep.extension = [{ url: ext('time-ordered'), valueDateTime: rep._ordered }]
        stats.byKind.labReport = (stats.byKind.labReport ?? 0) + 1
      }
      rep.result.push(ref(r))
      if (c.invalid) rep._invalid++
      if (specimen && !rep.specimen.some((x) => x.reference === `Specimen/${specimen.id}`)) rep.specimen.push(ref(specimen))
      if (r.effectiveDateTime && (!rep.effectiveDateTime || r.effectiveDateTime < rep.effectiveDateTime)) rep.effectiveDateTime = r.effectiveDateTime
      if (r.issued && (!rep.issued || r.issued > rep.issued)) rep.issued = r.issued
    },

    imaging(c) {
      const mod = concept('modality')
      const item = s('item.display') ?? s('item.stdDisplay') ?? '检查报告'
      const text = [['检查项目', item], ['部位', s('bodySite.text')], ['所见', raw('findings')], ['结论', raw('conclusion')]]
        .filter(([, x]) => !isBlank(x)).map(([k, x]) => `${k}：${String(x)}`).join('\n')
      const st = concept('status')
      const rep = {
        resourceType: 'DiagnosticReport', id: stableId('DiagnosticReport', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key), s('report.no') && { system: idSys('exam-report-no'), value: s('report.no'), assigner: c.org ? ref(c.org) : undefined }, s('order.no') && { type: PLACER, system: idSys('order-no'), value: s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : st?.status === 'normalized' ? st.to : 'final',
        category: mod ? [cc([coding(sysFor('modality', 'exam-modality'), mod.display ?? mod.code, mod.display ?? mod.code), mod.status === 'normalized' ? { system: T.DICOM_DCM, code: mod.to } : undefined], mod.display ?? mod.code)] : undefined,
        code: cc([coding(sysFor('item', 'exam-item', c.org), s('item.code'), item), coding(sysFor('std', 'exam-item-std'), s('item.stdCode'), s('item.stdDisplay')), ...terms('exam-item')], item),
        subject: patientRef,
        encounter: encounterRef(c.org),
        effectiveDateTime: dt('time.effective'),
        issued: inst('time.issued'),
        performer: [c.org && ref(c.org), actor(c, 'performer') && ref(actor(c, 'performer')), actor(c, 'author') && ref(actor(c, 'author'))].filter(Boolean),
        resultsInterpreter: actor(c, 'verifier') ? [ref(actor(c, 'verifier'))] : undefined,
        conclusion: s('conclusion'),
        presentedForm: text ? [{ contentType: 'text/plain; charset=utf-8', language: 'zh-CN', data: base64(text), title: item }] : undefined,
      }
      finish(c, rep, [
        s('reason.text') && { url: ext('reason-text'), valueString: s('reason.text') },
        st && { url: ext('status-as-recorded'), valueString: st.code ?? st.display },
        (() => { const o = dt('time.ordered'); return o && { url: ext('time-ordered'), valueDateTime: o } })(),
        actor(c, 'requester') && { url: ext('actor-requester'), valueReference: ref(actor(c, 'requester')) },
        deptExt(c.dept),
      ])
    },

    procedure(c) {
      const cv = cur.N.values['code.code']
      const code = s('code.code'); const name = s('code.display')
      const icd9 = cv?.status === 'normalized' && cv.value.system === 'icd-9-cm-3-cn'
      const start = dt('time.start'); const end = dt('time.end'); const at = dt('time.performed')
      const badPeriod = start && end && end < start
      if (badPeriod) note(`手术 ${c.key}：结束时间早于开始时间，结束时间放在扩展里`)
      const rv = cur.N.values['reason.code']
      const reasonText = s('reason.text')
      const reasonCode = rv?.status === 'normalized' ? rv.value.code : s('reason.code')
      const proc = {
        resourceType: 'Procedure', id: stableId('Procedure', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key), s('order.no') && { type: PLACER, system: idSys('order-no'), value: s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'completed',
        code: cc([icd9 ? coding(csSys(`${cur.profile}/icd-9-cm-3-cn`), code, name) : coding(sysFor('code', 'procedure-code', c.org), code, name)], name ?? code),
        subject: patientRef,
        encounter: encounterRef(c.org),
        performedPeriod: start ? clean({ start, end: badPeriod ? undefined : end }) : undefined,
        performedDateTime: !start ? at : undefined,
        performer: c.acts.filter((a) => ['surgeon', 'assistant', 'anesthetist', 'performer'].includes(a.fn)).map((a) => ({
          function: { text: { surgeon: '主刀医师', assistant: '助手', anesthetist: '麻醉医师', performer: '操作者' }[a.fn] }, actor: ref(a.practitioner), onBehalfOf: c.org ? ref(c.org) : undefined,
        })),
        reasonCode: reasonCode || reasonText ? [cc([coding(sysFor('reason', 'diagnosis-code'), reasonCode, reasonText)], reasonText)] : undefined,
        outcome: s('outcome.text') ? { text: s('outcome.text') } : undefined,
        bodySite: s('bodySite.text') ? [{ text: s('bodySite.text') }] : undefined,
        note: s('note') ? [{ text: s('note') }] : undefined,
      }
      const coded = (name2, urlName) => (concept(name2) ? { url: ext(urlName), valueCodeableConcept: conceptCC(name2, name2, urlName, c.org) } : undefined)
      finish(c, proc, [
        coded('level', 'procedure-level'), coded('incision', 'incision-class'), coded('anesthesia', 'anesthesia-method'),
        start && at && at !== start && { url: ext('time-scheduled'), valueDateTime: at },
        badPeriod && { url: ext('period-end-as-recorded'), valueDateTime: end },
        deptExt(c.dept),
      ])
    },

    document(c) {
      const parts = cur.N.sections.map((x) => `【${x.title}】\n${String(x.raw)}`)
      const doc = cur.spec.document ?? { code: cur.spec.id, display: cur.spec.id }
      const authored = dt('time.authored')
      const dr = {
        resourceType: 'DocumentReference', id: stableId('DocumentReference', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key)],
        status: c.invalid ? 'entered-in-error' : 'current',
        type: cc([doc.loinc && { system: T.LOINC, code: doc.loinc, display: doc.loincDisplay }, coding(csSys(`${cur.profile}/document-type`), doc.code, doc.display)], doc.display),
        subject: patientRef,
        date: authored && /T/.test(authored) ? authored : undefined,
        author: [actor(c, 'author', 'recorder') && ref(actor(c, 'author', 'recorder')), c.org && ref(c.org)].filter(Boolean),
        custodian: c.org ? ref(c.org) : undefined,
        description: s('title') ?? doc.display,
        content: [{ attachment: { contentType: 'text/plain; charset=utf-8', language: 'zh-CN', data: base64(parts.join('\n\n')), title: doc.display, creation: authored } }],
        context: (() => { const e = encounterRef(c.org); return e ? { encounter: [e] } : undefined })(),
      }
      observationItems(c, authored, dr)
      finish(c, dr, [deptExt(c.dept)])
    },

    observation(c) {
      const made = observationItems(c, dt('time.effective'), null)
      const exts = [...auditExt(c), ...leftovers()]
      if (!exts.length) return
      if (made[0]) made[0].extension = [...(made[0].extension ?? []), ...exts]
      else pat.extra.push(...exts)
    },

    medication(c) {
      const dose = num('dose.value'); const qty = num('quantity')
      const q = (n, unitRole) => { const u = s(unitRole); const uc = concept(unitRole); return clean({ value: n.value, comparator: n.comparator, unit: u, system: uc?.status === 'normalized' ? T.UCUM : undefined, code: uc?.status === 'normalized' ? uc.to : undefined }) }
      const mr = {
        resourceType: 'MedicationRequest', id: stableId('MedicationRequest', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key), s('order.no') && { type: PLACER, system: idSys('order-no'), value: s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'unknown', intent: 'order',
        medicationCodeableConcept: cc([coding(sysFor('drug', 'drug', c.org), s('drug.code'), s('drug.display'))], s('drug.display') ?? s('drug.code') ?? '药品'),
        subject: patientRef, encounter: encounterRef(c.org),
        authoredOn: dt('time.authored') ?? dt('time.start'),
        requester: actor(c, 'requester', 'author') ? ref(actor(c, 'requester', 'author')) : undefined,
        dosageInstruction: [clean({
          text: [s('dose.value') && `${s('dose.value')}${s('dose.unit') ?? ''}`, s('route.display'), s('frequency.display')].filter(Boolean).join(' '),
          route: s('route.display') ? { text: s('route.display') } : undefined,
          timing: s('frequency.display') ? { code: { text: s('frequency.display') } } : undefined,
          doseAndRate: dose ? [{ doseQuantity: q(dose, 'dose.unit') }] : undefined,
        })].filter(Boolean),
        dispenseRequest: clean({ quantity: qty ? q(qty, 'quantity.unit') : undefined, validityPeriod: clean({ start: dt('time.start'), end: dt('time.end') && dt('time.start') && dt('time.end') < dt('time.start') ? undefined : dt('time.end') }) }),
        note: s('note') ? [{ text: s('note') }] : undefined,
      }
      const badEnd = dt('time.end') && dt('time.start') && dt('time.end') < dt('time.start')
      finish(c, mr, [deptExt(c.dept), badEnd && { url: ext('period-end-as-recorded'), valueDateTime: dt('time.end') }])
    },

    charge(c) {
      const qty = num('quantity')
      const money = (role, name) => { const n = num(role); return n ? { url: ext(name), valueMoney: { value: n.value, currency: 'CNY' } } : undefined }
      const ci = {
        resourceType: 'ChargeItem', id: stableId('ChargeItem', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key)],
        status: c.invalid ? 'entered-in-error' : 'billable',
        code: cc([coding(sysFor('item', 'charge-item', c.org), s('item.code'), s('item.display')), ...terms('charge-item')], s('item.display') ?? s('item.code') ?? '收费项目'),
        subject: patientRef,
        context: encounterRef(c.org),
        occurrenceDateTime: dt('time.occurrence'),
        performingOrganization: c.org ? ref(c.org) : undefined,
        requestingOrganization: c.dept ? ref(c.dept) : undefined,
        quantity: qty ? clean({ value: qty.value, unit: s('unit') }) : undefined,
        enterer: actor(c, 'recorder') ? ref(actor(c, 'recorder')) : undefined,
      }
      const refund = concept('refund.flag')
      finish(c, ci, [
        money('unitPrice', 'unit-price'), money('total', 'total-price'),
        concept('category') && { url: ext('fee-category'), valueCodeableConcept: conceptCC('category', 'category', 'fee-category') },
        refund ? (refund.status === 'normalized' ? { url: ext('charge-refund'), valueCodeableConcept: conceptCC('refund.flag', 'refund', 'charge-refund') } : { url: ext('flag-refund'), valueString: refund.code ?? refund.display }) : (s('refund.flag') && { url: ext('flag-refund'), valueString: s('refund.flag') }),
      ])
    },

    death(c) {
      const when = dt('time.death')
      if (when) patient.deceasedDateTime = when
      else patient.deceasedBoolean = true
      const cv = cur.N.values['cause.code']
      const causeCode = cv?.status === 'normalized' ? cv.value.code : s('cause.code'); const causeName = s('cause.display')
      finish(c, {
        resourceType: 'Observation', id: stableId('Observation', cur.spec.id, c.key, 'cause'),
        identifier: [recordIdentifier(c.key)],
        status: c.invalid ? 'entered-in-error' : 'final',
        code: cc([coding(csSys(`${cur.profile}/observation`), 'cause-of-death', '根本死因')], '根本死因'),
        subject: patientRef, effectiveDateTime: when, performer: c.org ? [ref(c.org)] : undefined,
        valueCodeableConcept: cc([coding(sysFor('cause', 'diagnosis-code'), causeCode, causeName)], causeName ?? causeCode),
        note: s('cause.text') ? [{ text: s('cause.text') }] : undefined,
      }, [s('place.display') && { url: ext('death-place'), valueString: s('place.display') }])
    },

    generic(c) {
      const when = dt('time.recorded')
      finish(c, {
        resourceType: 'Basic', id: stableId('Basic', cur.spec.id, c.key),
        identifier: [recordIdentifier(c.key)],
        code: cc([coding(csSys(`${cur.profile}/source-table`), cur.spec.id, cur.spec.name ?? cur.spec.id)], cur.spec.name ?? cur.spec.id),
        subject: patientRef, created: when ? when.slice(0, 10) : undefined, author: c.org ? ref(c.org) : undefined,
      }, [encounterRef(c.org) && { url: ext('encounter'), valueReference: encounterRef(c.org) }])
    },
  }

  /** Observation per item (measurement / survey) — shared by `observation` and `document`. */
  function observationItems(c, effective, derivedFrom) {
    const vit = {}
    const made = []
    const src = s('source.name')
    for (const it of cur.N.items) {
      const item = cur.spec.items[it.index]
      const rawV = item.coded ? (str(it.raw) ?? str(it.display)) : str(it.raw)
      if (rawV === undefined) continue
      if (item.measure === 'systolic' || item.measure === 'diastolic') { vit[item.measure] = it; continue }
      const res = it.result
      // 体征 LOINC 代码会触发 FHIR 体征规范（必须有测量时间、值必须是 UCUM 数量）：条件不满足时只用本地代码
      const vitalOk = Boolean(item.measure && T.MEASURES[item.measure] && effective && !item.coded && res?.status === 'normalized' && res.value?.type !== 'coded' && Number.isFinite(res.value?.value))
      const m = vitalOk ? T.MEASURES[item.measure] : undefined
      const localCode = item.local ?? item.measure ?? item.field
      const category = m ? 'vital-signs' : item.category ?? (item.measure ? 'exam' : 'survey')
      const obs = {
        resourceType: 'Observation', id: stableId('Observation', cur.spec.id, c.key, localCode),
        meta: metaOf(c.file),
        identifier: [recordIdentifier(`${c.key}#${localCode}`)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: category, display: { 'vital-signs': 'Vital Signs', 'social-history': 'Social History', laboratory: 'Laboratory', exam: 'Exam', survey: 'Survey' }[category] }] }],
        code: cc([m && { system: T.LOINC, code: m.loinc, display: m.display }, item.loinc && { system: T.LOINC, code: item.loinc, display: item.loincDisplay }, coding(csSys(`${cur.profile}/observation`), localCode, item.text ?? m?.text)], item.text ?? m?.text ?? item.field),
        subject: patientRef,
        encounter: encounterRef(c.org),
        effectiveDateTime: effective,
        performer: c.org ? [ref(c.org)] : undefined,
        derivedFrom: derivedFrom ? [ref(derivedFrom)] : undefined,
      }
      if (item.coded) {
        const norm = res?.status === 'normalized' && res.value?.code ? { system: resolve(res.value.system), code: res.value.code, display: res.value.display, _origin: res.origin } : undefined
        const tm = item.local && cur.N.terms?.[item.local]?.codings ? cur.N.terms[item.local].codings : []
        obs.valueCodeableConcept = cc([norm, coding(csSys(`${cur.profile}/${localCode}`), str(it.raw), str(it.display)), ...tm], str(it.display) ?? str(it.raw))
      } else if (res?.status === 'normalized' && m) {
        obs.valueQuantity = { value: res.value.value, unit: T.UCUM_DISPLAY[m.ucum] ?? m.ucum, system: T.UCUM, code: m.ucum, ...(res.value.comparator ? { comparator: res.value.comparator } : {}) }
      } else if (res?.status === 'normalized' && res.domain === 'yes-no') {
        obs.valueBoolean = res.to === 'Y'
      } else if (res?.status === 'normalized' && Number.isFinite(res.value?.value)) {
        obs.valueQuantity = clean({ value: res.value.value, comparator: res.value.comparator, unit: item.unit ?? (item.measure ? T.MEASURES[item.measure]?.ucum : undefined) })
      } else {
        obs.valueString = rawV
      }
      obs.extension = [src && { url: ext('source-system'), valueString: src }, ...badCodeExts()].filter(Boolean)
      made.push(add(clean(obs)))
      stats.byKind[cur.spec.kind] = (stats.byKind[cur.spec.kind] ?? 0) + 1
    }
    const bpOk = effective && ['systolic', 'diastolic'].every((k) => vit[k]?.result?.status === 'normalized' && Number.isFinite(vit[k].result.value?.value))
    if ((vit.systolic || vit.diastolic) && !bpOk) {
      // 不满足血压规范：收缩压 / 舒张压各自按本地代码记录
      for (const k of ['systolic', 'diastolic']) {
        const it = vit[k]; if (!it) continue
        const v = it.result?.status === 'normalized' && Number.isFinite(it.result.value?.value) ? { valueQuantity: { value: it.result.value.value, unit: 'mmHg', system: T.UCUM, code: 'mm[Hg]' } } : { valueString: str(it.raw) }
        made.push(add(clean({
          resourceType: 'Observation', id: stableId('Observation', cur.spec.id, c.key, k), meta: metaOf(c.file), identifier: [recordIdentifier(`${c.key}#${k}`)],
          status: c.invalid ? 'entered-in-error' : 'final', category: [{ coding: [{ system: T.OBS_CATEGORY, code: 'exam', display: 'Exam' }] }],
          code: cc([coding(csSys(`${cur.profile}/observation`), k, T.MEASURES[k].text)], T.MEASURES[k].text), subject: patientRef, encounter: encounterRef(c.org), effectiveDateTime: effective,
          performer: c.org ? [ref(c.org)] : undefined, derivedFrom: derivedFrom ? [ref(derivedFrom)] : undefined, ...v,
        })))
      }
    }
    if (bpOk) {
      const comp = (k) => {
        const m = T.MEASURES[k]; const it = vit[k]
        if (!it) return undefined
        const ok = it.result?.status === 'normalized'
        return { code: { coding: [{ system: T.LOINC, code: m.loinc, display: m.display }], text: m.text }, ...(ok ? { valueQuantity: { value: it.result.value.value, unit: 'mmHg', system: T.UCUM, code: 'mm[Hg]' } } : { valueString: str(it.raw) }) }
      }
      const bp = T.MEASURES.bloodPressure
      made.push(add(clean({
        resourceType: 'Observation', id: stableId('Observation', cur.spec.id, c.key, 'blood-pressure'),
        meta: metaOf(c.file), identifier: [recordIdentifier(`${c.key}#blood-pressure`)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
        code: { coding: [{ system: T.LOINC, code: bp.loinc, display: bp.display }], text: bp.text },
        subject: patientRef, encounter: encounterRef(c.org), effectiveDateTime: effective,
        performer: c.org ? [ref(c.org)] : undefined, derivedFrom: derivedFrom ? [ref(derivedFrom)] : undefined,
        component: [comp('systolic'), comp('diastolic')].filter(Boolean),
      })))
      stats.byKind[cur.spec.kind] = (stats.byKind[cur.spec.kind] ?? 0) + 1
    }
    return made
  }

  /* ================================================================ run */
  const ordered = [...records].sort((a, b) => (a.spec.kind === 'encounter' ? 0 : 1) - (b.spec.kind === 'encounter' ? 0 : 1))
  for (const r of ordered) {
    cur = { spec: r.spec, N: r.N, profile: r.N.profile ?? ctx.profileId }
    badCodes = []
    const c = common()
    ;(builders[r.spec.kind] ?? builders.generic)(c)
  }

  /* ---------------------------------------------------- finish Patient */
  const names = [...pat.names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  if (names.length) patient.name = names.map((n, i) => ({ use: i === 0 ? 'official' : 'old', text: n }))
  const primaryG = pat.genders.filter((x) => x.primary).map((x) => x.g)
  const pool = primaryG.length ? primaryG : pat.genders.map((x) => x.g)
  const definite = pool.filter((g) => g === 'male' || g === 'female')
  if (new Set(definite).size > 1) note(`性别记录不一致：${[...new Set(definite)].join('/')}，取出现最多的`)
  const pick = (arr) => { const n = new Map(); for (const x of arr) n.set(x, (n.get(x) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] }
  patient.gender = pick(definite.length ? definite : pool)
  const primaryB = pat.births.filter((x) => x.primary).map((x) => x.b)
  const bpool = primaryB.length ? primaryB : pat.births.map((x) => x.b)
  if (new Set(bpool).size > 1) note(`出生日期记录不一致：${[...new Set(bpool)].join('/')}，取出现最多的`)
  patient.birthDate = pick(bpool)
  if (pat.telecoms.size) patient.telecom = [...pat.telecoms].map((v) => ({ system: 'phone', value: v }))
  for (const idf of pat.identifiers.values()) patient.identifier.push(clean(idf))
  const byText = new Map()
  for (const a of pat.addresses) {
    const k = JSON.stringify([a.text, a.state, a.city, a.district, a.line, a.extension?.find((e) => e.url.endsWith('address-kind'))?.valueString])
    const prev = byText.get(k)
    if (!prev) byText.set(k, a)
    else if (a.period?.start && (!prev.period?.start || a.period.start < prev.period.start)) prev.period = a.period
  }
  if (byText.size) patient.address = [...byText.values()]
  if (pat.marital) {
    const m = pat.marital.concept
    const norm = m.status === 'normalized' && m.value?.code ? { system: resolve(m.value.system), code: m.value.code, display: m.value.display, _origin: m.origin } : undefined
    patient.maritalStatus = cc([norm], m.display ?? m.value?.label ?? m.code)
  }
  if (pat.extra.length) patient.extension = [...(patient.extension ?? []), ...pat.extra]
  Object.assign(patient, clean(patient))

  for (const r of out.values()) {
    if (r.resourceType === 'DiagnosticReport' && '_invalid' in r) {
      if (r._invalid && r._invalid === r.result.length) r.status = 'entered-in-error'
      delete r._invalid; delete r._ordered
      Object.assign(r, clean(r))
    }
  }
  const resources = [...out.values()].map((r) => clean(r))
  for (const r of resources) stats.byType[r.resourceType] = (stats.byType[r.resourceType] ?? 0) + 1
  return { patient: resources.find((r) => r.resourceType === 'Patient'), resources, stats, issues }
}
