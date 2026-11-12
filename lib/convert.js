/**
 * 一位病人的源记录 → FHIR R4 资源。
 *
 * 输入：records = [{ spec, row, file }]（spec 是映射规格里的一张表），全部属于同一病人。
 * 输出：{ resources, stats, issues }。
 *
 * 原则：
 *   - 构建器只认语义角色（见 mapping/roles.js），不认字段名。
 *   - 不改值：时间只做格式转换（无时区的本地时间标 +08:00），文本原样（仅去首尾空白），代码原样进本地代码体系。
 *   - 不丢数据：没被任何角色用到的非空字段，原样挂在资源的 source-field 扩展上。
 *   - 编号稳定：资源 id 由来源表与源记录主键派生，重跑不变。
 */
import { isBlank, str, parseTime, dateTime, date, instant, parseNumber, referenceRange, stableId, token, quantity, base64, clean } from './fhir/datatypes.js'
import * as T from './fhir/terms.js'

export function createContext({ namespace = 'http://dsh.local/fhir', timezone = '+08:00', profileId = 'source' } = {}) {
  const ns = namespace.replace(/\/+$/, '')
  return {
    ns, timezone, profileId,
    idSys: (name) => `${ns}/id/${name}`,
    csSys: (name, org) => `${ns}/CodeSystem/${name}${org ? `/org-${token(org)}` : ''}`,
    ext: (name) => `${ns}/StructureDefinition/${name}`,
  }
}

/** Read one role from a row: first non-blank of the assigned fields. Marks the field as used. */
function reader(spec, row) {
  const used = new Set()
  const fieldsOf = (role) => [].concat(spec.roles?.[role] ?? [])
  const get = (role) => {
    const fs = fieldsOf(role)
    for (const f of fs) {
      if (!isBlank(row[f])) {
        used.add(f)
        // 备选字段取值与选中的相同：不是新信息，不再单独保留
        for (const g of fs) if (g !== f && str(row[g]) === str(row[f])) used.add(g)
        return row[f]
      }
    }
    return undefined
  }
  const touch = (role) => { for (const f of fieldsOf(role)) used.add(f) }
  const field = (f) => { if (isBlank(row[f])) { used.add(f); return undefined } used.add(f); return row[f] }
  return { get, s: (role) => str(get(role)), touch, field, used, has: (role) => fieldsOf(role).length > 0 }
}

export function convertPatient(patientKey, records, ctx, { patientIdSystem = 'id-card' } = {}) {
  const { idSys, csSys, ext, timezone: tz } = ctx
  const out = new Map() // "Type/id" → resource
  const issues = []
  const stats = { records: records.length, byKind: {}, byType: {}, leftoverFields: {}, unresolvedEncounters: 0, timeUnparsed: {}, invalidRecords: 0 }
  const add = (r) => {
    const k = `${r.resourceType}/${r.id}`
    if (!out.has(k)) out.set(k, r)
    return out.get(k)
  }
  const ref = (r) => ({ reference: `${r.resourceType}/${r.id}` })
  const note = (msg) => { if (issues.length < 500) issues.push(msg) }
  const PLACER = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC', display: 'Placer Identifier' }], text: '电子申请单号' }
  let curProfile = ctx.profileId // 当前记录所属规格（不同表可能来自不同规格）

  /* ------------------------------------------------------------ Patient */
  const patient = {
    resourceType: 'Patient', id: stableId('Patient', patientIdSystem, patientKey),
    identifier: [{ use: 'official', system: idSys(patientIdSystem), value: patientKey }],
  }
  add(patient)
  const pat = { names: new Map(), genders: [], births: [], telecoms: new Set(), addresses: [], marital: null, extra: [], identifiers: new Map() }
  const patientRef = ref(patient)

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
    const o = add({
      resourceType: 'Organization', id: stableId('Department', org?.id ?? '', c ?? `name:${n}`),
      identifier: c ? [{ system: org ? csSys('dept-code', org.id) : idSys('dept-code'), value: c }] : undefined,
      type: [{ coding: [{ system: T.ORG_TYPE, code: 'dept', display: 'Hospital Department' }] }],
      name: n, partOf: org ? ref(org) : undefined,
    })
    if (n && !o.name) o.name = n
    return o
  }
  function practitioner(org, code, name) {
    const c = str(code); const n = str(name)
    if (!c && !n) return undefined
    const p = add({
      resourceType: 'Practitioner', id: stableId('Practitioner', org?.id ?? '', c ?? `name:${n}`),
      identifier: c ? [{ system: idSys('staff-code'), value: c, assigner: org ? ref(org) : undefined }] : undefined,
      name: n ? [{ text: n }] : undefined,
    })
    if (n && !p.name) p.name = [{ text: n }]
    return p
  }
  /** All actors present on a row: [{ fn, practitioner }]. */
  function actors(spec, R, org) {
    const fns = new Set(Object.keys(spec.roles ?? {}).filter((r) => r.startsWith('actor.')).map((r) => r.split('.')[1]))
    const list = []
    for (const fn of fns) {
      const p = practitioner(org, R.get(`actor.${fn}.code`), R.get(`actor.${fn}.name`))
      if (p) list.push({ fn, practitioner: p })
    }
    return list
  }

  /* -------------------------------------------------------- Encounters */
  const encounters = new Map() // "O|no" / "I|no" → Encounter
  const encounterRows = new Map() // Encounter id → 首条登记的源行
  function encounterKeyOf(R, spec) {
    const setting = settingOf(R, spec)
    const o = R.s('encounter.outpatientNo'); const i = R.s('encounter.inpatientNo')
    if (setting === 'IMP' && i) return { key: `I|${i}`, no: i, sys: 'inpatient-no' }
    if (o) return { key: `O|${o}`, no: o, sys: 'outpatient-no' }
    if (i) return { key: `I|${i}`, no: i, sys: 'inpatient-no' }
    return undefined
  }
  function settingOf(R, spec) {
    const v = R.s('encounter.setting')
    if (v === undefined) return undefined
    return spec.values?.['encounter.setting']?.[v]
  }
  /**
   * 记录引用了就诊表里没有的就诊：按号码建一条“登记缺失”的 Encounter（状态 unknown，
   * 门诊/住院由号码类型决定，时间不填——不编造），让同一次就诊的记录在服务器上能归到一起。
   */
  function encounterRef(R, spec, org) {
    const k = encounterKeyOf(R, spec)
    if (!k) return undefined
    let e = encounters.get(k.key)
    if (!e) {
      stats.unresolvedEncounters++
      e = add({
        resourceType: 'Encounter', id: stableId('Encounter', patient.id, k.key),
        meta: { tag: [{ system: ext('tag'), code: 'encounter-not-registered', display: '就诊表里没有这次就诊，由其他记录引用的号码推出' }] },
        identifier: [clean({ system: idSys(k.sys), value: k.no, assigner: org ? ref(org) : undefined })],
        status: 'unknown',
        class: k.sys === 'inpatient-no' ? { system: T.V3_ACT_CODE, code: 'IMP', display: 'inpatient encounter' } : { system: T.V3_ACT_CODE, code: 'AMB', display: 'ambulatory' },
        subject: patientRef,
        serviceProvider: org ? ref(org) : undefined,
      })
      Object.assign(e, clean(e))
      encounters.set(k.key, e)
    }
    return ref(e)
  }

  /* ------------------------------------------------------------ helpers */
  const t = (role, R, fmt = dateTime) => {
    const v = R.get(role)
    if (v === undefined) return undefined
    const x = fmt(v, tz)
    if (x === undefined) { stats.timeUnparsed[role] = (stats.timeUnparsed[role] ?? 0) + 1 }
    return x
  }
  // FHIR code 不能含换行、制表符或连续空格。这样的源代码不放进 coding，原值记下来挂到资源扩展上
  let badCodes = []
  const coding = (system, code, display) => {
    const c = str(code); const d = str(display)
    if (!c) return undefined
    if (!/^[^\s]+( [^\s]+)*$/.test(c)) { badCodes.push({ system, code: String(code) }); return undefined }
    return { system, code: c, display: d }
  }
  const badCodeExts = () => {
    const list = badCodes.map((b) => ({ url: ext('code-as-recorded'), valueString: b.code.trim() || JSON.stringify(b.code) }))
    badCodes = []
    return list
  }
  const cc = (codings, text) => clean({ coding: codings.filter(Boolean), text: str(text) })
  const recordKey = (spec, row) => {
    const parts = (spec.key ?? []).map((f) => str(row[f])).filter(Boolean)
    return parts.length ? parts.join('|') : stableId(JSON.stringify(row))
  }
  const recordIdentifier = (spec, key) => ({ system: idSys(`record/${curProfile}/${spec.id}`), value: key })
  const metaOf = (file) => ({ source: `${ctx.ns}/source#${encodeURIComponent(file)}` })
  function leftovers(spec, row, R) {
    for (const f of spec.key ?? []) R.used.add(f)
    const list = []
    for (const [k, v] of Object.entries(row)) {
      if (R.used.has(k) || isBlank(v)) continue
      const value = str(v)
      if (!value) continue
      list.push({ url: ext('source-field'), extension: [{ url: 'name', valueString: k }, { url: 'value', valueString: value }] })
      const key = `${spec.id}.${k}`
      stats.leftoverFields[key] = (stats.leftoverFields[key] ?? 0) + 1
    }
    return list
  }
  const flagExt = (name, v) => (str(v) ? { url: ext(`flag-${name}`), valueString: str(v) } : undefined)
  const deptExt = (dept) => (dept ? { url: ext('department'), valueReference: ref(dept) } : undefined)
  const orgExt = (org) => (org ? { url: ext('organization'), valueReference: ref(org) } : undefined)
  /** Code system for a local code role, per spec.codeSystems (scoped to the organisation when configured). */
  const sysFor = (spec, key, fallbackName, org) => {
    const c = spec.codeSystems?.[key]
    const name = `${curProfile}/${c?.name ?? fallbackName}`
    return csSys(name, c?.scope === 'org' ? org?.id : undefined)
  }

  /** Common processing; returns everything a builder needs. */
  function common(rec) {
    const { spec, row } = rec
    const R = reader(spec, row)
    // patient-level enrichment (any table)
    const pn = R.s('patient.name'); if (pn) pat.names.set(pn, (pat.names.get(pn) ?? 0) + 1)
    const g = T.gender(R.get('patient.gender.code'), R.get('patient.gender.display'))
    if (g) pat.genders.push({ g, primary: spec.kind === 'patient' })
    const b = t('patient.birthDate', R, date); if (b) pat.births.push({ b, primary: spec.kind === 'patient' })
    const tel = R.s('patient.telecom'); if (tel) pat.telecoms.add(tel)
    R.touch('patient.id')
    const org = organization(R.get('org.code'), R.get('org.name'))
    const lid = R.s('patient.localId')
    if (lid) pat.identifiers.set(`pid|${org?.id ?? ''}|${lid}`, { use: 'secondary', system: idSys('patient-local-id'), value: lid, assigner: org ? ref(org) : undefined })
    const card = R.s('patient.card')
    if (card) pat.identifiers.set(`card|${org?.id ?? ''}|${card}`, { use: 'secondary', system: idSys('patient-card'), value: card, assigner: org ? ref(org) : undefined })
    const dept = department(org, R.get('dept.code'), R.get('dept.name'))
    const acts = actors(spec, R, org)
    const key = recordKey(spec, row)
    const invalid = spec.invalid && spec.invalid.values.includes(str(R.field(spec.invalid.field)))
    if (invalid) stats.invalidRecords++
    const created = t('record.created', R); const updated = t('record.updated', R)
    return { spec, row, file: rec.file, R, org, dept, acts, key, invalid, created, updated }
  }
  const actor = (c, ...fns) => c.acts.find((a) => fns.includes(a.fn))?.practitioner
  const auditExt = (c) => [
    c.created && { url: ext('record-created'), valueDateTime: c.created },
    c.updated && { url: ext('record-updated'), valueDateTime: c.updated },
    ...c.acts.filter((a) => ['recorder', 'updater', 'other', 'collector'].includes(a.fn)).map((a) => ({ url: ext(`actor-${a.fn}`), valueReference: ref(a.practitioner) })),
  ].filter(Boolean)
  const finish = (c, resource, extra = []) => {
    resource.meta = metaOf(c.file)
    const exts = [...extra.filter(Boolean), ...badCodeExts(), ...auditExt(c), ...leftovers(c.spec, c.row, c.R)]
    if (exts.length) resource.extension = [...(resource.extension ?? []), ...exts]
    const r = add(clean(resource))
    stats.byKind[c.spec.kind] = (stats.byKind[c.spec.kind] ?? 0) + 1
    return r
  }

  /* ============================================================ builders */
  const builders = {
    patient(c) {
      const { R } = c
      const n = R.s('name'); if (n) pat.names.set(n, (pat.names.get(n) ?? 0) + 100)
      const g = T.gender(R.get('gender.code'), R.get('gender.display')); if (g) pat.genders.push({ g, primary: true })
      const b = t('birthDate', R, date); if (b) pat.births.push({ b, primary: true })
      const tel = R.s('telecom'); if (tel) pat.telecoms.add(tel)
      const m = R.s('maritalStatus.display'); R.touch('maritalStatus.code')
      if (m) pat.marital = { display: m, code: R.s('maritalStatus.code'), at: t('time.recorded', R) ?? '' }
      for (const item of c.spec.items ?? []) {
        const v = str(c.row[item.field]); c.R.used.add(item.field)
        if (item.timeField) c.R.used.add(item.timeField)
        if (v === undefined || (item.when !== undefined && v !== String(item.when))) continue
        const when = c.row[item.timeField] ? /\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?/.exec(String(c.row[item.timeField]))?.[0] : undefined
        add(clean({
          resourceType: 'Condition', id: stableId('Condition', c.spec.id, c.key, item.field),
          meta: metaOf(c.file),
          identifier: [recordIdentifier(c.spec, `${c.key}#${item.field}`)],
          category: [{ coding: [{ system: T.COND_CATEGORY, code: 'problem-list-item', display: 'Problem List Item' }] }],
          code: cc([coding(sysFor(c.spec, 'history', 'history-flag'), item.condition.local, item.condition.text)], item.condition.text),
          subject: patientRef,
          recordedDate: when ? dateTime(when, tz) : undefined,
          extension: [{ url: ext('source-field'), extension: [{ url: 'name', valueString: item.field }, { url: 'value', valueString: v }] }],
        }))
        stats.byKind.patient = (stats.byKind.patient ?? 0) + 1
      }
      pat.extra.push(...auditExt(c), ...leftovers(c.spec, c.row, R))
    },

    address(c) {
      const { R, spec } = c
      const part = (k) => R.s(`address.${k}.name`) ?? R.s(`address.${k}.code`)
      for (const k of ['province', 'city', 'county', 'town', 'village']) { R.touch(`address.${k}.code`); R.touch(`address.${k}.name`) }
      const codes = ['village', 'town', 'county', 'city', 'province'].map((k) => R.s(`address.${k}.code`)).filter(Boolean)
      const srcName = R.s('source.name')
      const body = {
        use: spec.addressUse ?? 'home',
        text: R.s('address.text'),
        line: [R.s('address.town.name'), R.s('address.village.name'), R.s('address.unit'), R.s('address.house')].filter(Boolean),
        district: part('county'), city: part('city'), state: part('province'), postalCode: R.s('address.postalCode'),
        period: (() => { const s = t('time.recorded', R); return s ? { start: s } : undefined })(),
      }
      const a = clean({
        extension: [
          spec.addressKind && { url: ext('address-kind'), valueString: spec.addressKind },
          codes[0] && { url: ext('admin-division-code'), valueString: codes[0] },
          srcName && { url: ext('source-system'), valueString: srcName },
          ...auditExt(c),
          ...leftovers(spec, c.row, R),
        ].filter(Boolean),
        ...body,
      })
      if (a) pat.addresses.push(a)
      stats.byKind.address = (stats.byKind.address ?? 0) + 1
    },

    encounter(c) {
      const { R, spec } = c
      const k = encounterKeyOf(R, spec)
      const setting = settingOf(R, spec)
      const rawSetting = R.s('encounter.setting')
      const start = t('time.start', R); const end = t('time.end', R)
      const id = k ? stableId('Encounter', patient.id, k.key) : stableId('Encounter', spec.id, c.key)
      const existing = out.get(`Encounter/${id}`)
      if (existing) {
        // 同一就诊号的多条登记：合并时间段，追加来源标识
        existing.identifier.push(recordIdentifier(spec, c.key))
        if (start && (!existing.period?.start || start < existing.period.start)) existing.period = { ...existing.period, start }
        if (end && (!existing.period?.end || end > existing.period.end)) existing.period = { ...existing.period, end }
        // 与首条登记取值相同的字段不重复保留；不同的原样挂扩展
        const first = encounterRows.get(id) ?? {}
        for (const [f, v] of Object.entries(c.row)) if (str(first[f]) === str(v)) R.used.add(f)
        existing.extension = [...(existing.extension ?? []), ...leftovers(spec, c.row, R)]
        return
      }
      const emergency = str(R.get('emergency.flag'))
      const cls = setting ?? 'AMB'
      const period = clean({ start, end })
      if (period?.start && period?.end && period.end < period.start) {
        note(`就诊 ${k?.no ?? c.key}：结束时间早于开始时间，结束时间放在扩展里`)
        delete period.end
      }
      const disp = R.s('dischargeDisposition.display') ?? R.s('dischargeDisposition.code')
      R.touch('dischargeDisposition.code')
      const ward = R.s('location.ward'); const bed = R.s('location.bed')
      const m = R.s('maritalStatus.display'); R.touch('maritalStatus.code')
      if (m && (!pat.marital || (start ?? '') >= pat.marital.at)) pat.marital = { display: m, at: start ?? '' }
      const enc = {
        resourceType: 'Encounter', id,
        identifier: [k && { system: idSys(k.sys), value: k.no, assigner: c.org ? ref(c.org) : undefined }, recordIdentifier(spec, c.key)].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'finished',
        class: { system: T.V3_ACT_CODE, code: cls, display: { AMB: 'ambulatory', IMP: 'inpatient encounter', EMER: 'emergency' }[cls] },
        type: rawSetting ? [cc([coding(sysFor(spec, 'setting', 'encounter-setting'), rawSetting, spec.values?.['encounter.settingName']?.[rawSetting])], spec.values?.['encounter.settingName']?.[rawSetting])] : undefined,
        subject: patientRef,
        participant: c.acts.filter((a) => ['attender', 'admitter', 'performer', 'author'].includes(a.fn)).map((a) => ({
          type: [{ coding: [{ system: T.V3_PARTICIPATION, ...({ attender: { code: 'ATND', display: 'attender' }, admitter: { code: 'ADM', display: 'admitter' } }[a.fn] ?? { code: 'PART', display: 'Participation' }) }] }],
          individual: ref(a.practitioner),
        })),
        period,
        reasonCode: R.s('reason.text') ? [{ text: R.s('reason.text') }] : undefined,
        hospitalization: disp ? { dischargeDisposition: { text: disp } } : undefined,
        location: ward || bed ? [{ location: { display: [ward, bed].filter(Boolean).join(' ') } }] : undefined,
        serviceProvider: c.dept ? ref(c.dept) : c.org ? ref(c.org) : undefined,
      }
      const r = finish(c, enc, [
        flagExt('emergency', emergency), flagExt('first-visit', R.get('firstVisit.flag')),
        m && { url: ext('marital-status-at-visit'), valueString: m },
        start && end && end < start && { url: ext('period-end-as-recorded'), valueDateTime: end },
      ])
      if (k) encounters.set(k.key, r)
      encounterRows.set(id, c.row)
    },

    condition(c) {
      const { R, spec } = c
      const icd = R.s('code.code'); const icdName = R.s('code.display'); const localC = R.s('code.local')
      const tcm = str(R.get('tcm.flag'))
      const catCode = R.s('category.code'); const catRaw = R.s('category.display')
      const catName = spec.values?.['category.display']?.[catRaw] ?? catRaw
      const cond = {
        resourceType: 'Condition', id: stableId('Condition', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key)],
        verificationStatus: c.invalid ? { coding: [{ system: T.COND_VER, code: 'entered-in-error', display: 'Entered in Error' }] } : undefined,
        category: [{ coding: [{ system: T.COND_CATEGORY, code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
        code: cc([
          coding(sysFor(spec, 'code', 'diagnosis-code'), icd, icdName),
          coding(sysFor(spec, 'local', 'diagnosis-local', c.org), localC, icdName),
          tcm === '1' ? coding(sysFor(spec, 'tcm', 'tcm-diagnosis', c.org), R.s('tcm.code'), R.s('tcm.display')) : undefined,
        ], R.s('text') ?? icdName),
        subject: patientRef,
        encounter: encounterRef(R, spec, c.org),
        recordedDate: t('time.recorded', R),
        onsetDateTime: t('time.onset', R),
        asserter: actor(c, 'author') ? ref(actor(c, 'author')) : undefined,
        recorder: actor(c, 'recorder') ? ref(actor(c, 'recorder')) : undefined,
        note: R.s('note') ? [{ text: R.s('note') }] : undefined,
      }
      if (tcm !== '1') { R.touch('tcm.code'); R.touch('tcm.display') }
      const r = finish(c, cond, [
        // 本地诊断类别（初步/出院/补充…）：Condition.category 是可扩展绑定，本地编码放扩展更合规
        (catCode || catRaw) && { url: ext('diagnosis-category'), valueCodeableConcept: cc([coding(sysFor(spec, 'category', 'diagnosis-category'), catCode ?? catRaw, catName)], catName) },
        flagExt('main-diagnosis', R.get('main.flag')), flagExt('tcm', tcm), R.s('order') && { url: ext('diagnosis-sequence'), valueString: R.s('order') },
        orgExt(c.org), deptExt(c.dept),
      ])
      // 诊断挂回就诊（不定 use/rank：源数据未写明含义）
      const e = cond.encounter?.reference && out.get(cond.encounter.reference)
      if (e && !c.invalid) { e.diagnosis = e.diagnosis ?? []; e.diagnosis.push({ condition: ref(r) }) }
    },

    lab(c) {
      const { R, spec } = c
      const reportNo = R.s('report.no')
      const unit = R.s('unit')
      const rawValue = R.get('value')
      const num = parseNumber(rawValue)
      const specimenName = R.s('specimen.display'); const specimenCode = R.s('specimen.code')
      let specimen
      if (specimenName || specimenCode) {
        specimen = add(clean({
          resourceType: 'Specimen', id: stableId('Specimen', patient.id, c.org?.id ?? '', reportNo ?? c.key, specimenCode ?? specimenName),
          type: cc([coding(sysFor(spec, 'specimen', 'specimen', c.org), specimenCode, specimenName)], specimenName),
          subject: patientRef,
        }))
      }
      const flagRaw = R.s('flag')
      const flagMap = spec.values?.flag?.[flagRaw]
      const obs = {
        resourceType: 'Observation', id: stableId('Observation', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: 'laboratory', display: 'Laboratory' }] }],
        code: cc([
          coding(sysFor(spec, 'item', 'lab-item', c.org), R.s('item.code'), R.s('item.display')),
          coding(sysFor(spec, 'std', 'lab-item-std'), R.s('item.stdCode'), R.s('item.stdDisplay')),
        ], R.s('item.display') ?? R.s('item.stdDisplay') ?? '检验项目'),
        subject: patientRef,
        encounter: encounterRef(R, spec, c.org),
        effectiveDateTime: t('time.effective', R),
        issued: t('time.issued', R, instant),
        performer: [c.org && ref(c.org), actor(c, 'performer') && ref(actor(c, 'performer'))].filter(Boolean),
        valueQuantity: num ? quantity(num, unit) : undefined,
        valueString: !num && str(rawValue) !== undefined ? str(rawValue) : undefined,
        dataAbsentReason: str(rawValue) === undefined ? { coding: [{ system: T.DATA_ABSENT, code: 'unknown', display: 'Unknown' }] } : undefined,
        interpretation: flagMap ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: flagMap }] }] : undefined,
        note: R.s('note') ? [{ text: R.s('note') }] : undefined,
        specimen: specimen ? ref(specimen) : undefined,
        referenceRange: (() => { const rr = referenceRange(R.get('refRange'), num ? unit : undefined); return rr ? [rr] : undefined })(),
      }
      if (!num && unit) obs.extension = [{ url: ext('unit-as-recorded'), valueString: unit }]
      R.touch('panel.code'); R.touch('panel.display'); R.touch('time.ordered'); R.touch('order.no'); R.touch('report.no')
      const r = finish(c, obs, [
        flagRaw && !flagMap && { url: ext('result-flag'), valueCoding: { system: sysFor(spec, 'flag', 'lab-result-flag'), code: flagRaw } },
        deptExt(c.dept),
        actor(c, 'verifier') && { url: ext('actor-verifier'), valueReference: ref(actor(c, 'verifier')) },
        actor(c, 'requester') && { url: ext('actor-requester'), valueReference: ref(actor(c, 'requester')) },
      ])
      // 按报告号归并
      const groupKey = reportNo ?? `${t('time.effective', R) ?? ''}|${R.s('panel.code') ?? R.s('panel.display') ?? ''}`
      const repId = stableId('DiagnosticReport', 'lab', patient.id, c.org?.id ?? '', groupKey)
      let rep = out.get(`DiagnosticReport/${repId}`)
      if (!rep) {
        rep = add({
          resourceType: 'DiagnosticReport', id: repId, meta: metaOf(c.file),
          identifier: [reportNo && { system: idSys('lab-report-no'), value: reportNo, assigner: c.org ? ref(c.org) : undefined }, R.s('order.no') && { type: PLACER, system: idSys('order-no'), value: R.s('order.no') }].filter(Boolean),
          status: 'final',
          category: [{ coding: [{ system: T.V2_0074, code: 'LAB', display: 'Laboratory' }] }],
          code: cc([coding(sysFor(spec, 'panel', 'lab-panel', c.org), R.s('panel.code'), R.s('panel.display'))], R.s('panel.display') ?? '检验报告'),
          subject: patientRef, encounter: r.encounter,
          effectiveDateTime: r.effectiveDateTime, issued: r.issued,
          performer: c.org ? [ref(c.org)] : undefined,
          resultsInterpreter: actor(c, 'verifier') ? [ref(actor(c, 'verifier'))] : undefined,
          specimen: [], result: [], _invalid: 0, _ordered: t('time.ordered', R),
        })
        if (rep._ordered) rep.extension = [{ url: ext('time-ordered'), valueDateTime: rep._ordered }]
        stats.byKind.labReport = (stats.byKind.labReport ?? 0) + 1
      }
      rep.result.push(ref(r))
      if (c.invalid) rep._invalid++
      if (specimen && !rep.specimen.some((s) => s.reference === `Specimen/${specimen.id}`)) rep.specimen.push(ref(specimen))
      if (r.effectiveDateTime && (!rep.effectiveDateTime || r.effectiveDateTime < rep.effectiveDateTime)) rep.effectiveDateTime = r.effectiveDateTime
      if (r.issued && (!rep.issued || r.issued > rep.issued)) rep.issued = r.issued
    },

    imaging(c) {
      const { R, spec } = c
      const modality = R.s('modality')
      const item = R.s('item.display') ?? R.s('item.stdDisplay') ?? '检查报告'
      const findings = str(R.get('findings')); const conclusion = str(R.get('conclusion'))
      const text = [['检查项目', item], ['部位', R.s('bodySite.text')], ['所见', R.get('findings')], ['结论', R.get('conclusion')]]
        .filter(([, v]) => !isBlank(v)).map(([k, v]) => `${k}：${String(v)}`).join('\n')
      const rep = {
        resourceType: 'DiagnosticReport', id: stableId('DiagnosticReport', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key), R.s('report.no') && { system: idSys('exam-report-no'), value: R.s('report.no'), assigner: c.org ? ref(c.org) : undefined }, R.s('order.no') && { type: PLACER, system: idSys('order-no'), value: R.s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'final',
        category: modality ? [cc([coding(sysFor(spec, 'modality', 'exam-modality'), modality, modality), T.DICOM_MODALITIES.has(modality) ? { system: T.DICOM_DCM, code: modality } : undefined], modality)] : undefined,
        code: cc([coding(sysFor(spec, 'item', 'exam-item', c.org), R.s('item.code'), item), coding(sysFor(spec, 'std', 'exam-item-std'), R.s('item.stdCode'), R.s('item.stdDisplay'))], item),
        subject: patientRef,
        encounter: encounterRef(R, spec, c.org),
        effectiveDateTime: t('time.effective', R),
        issued: t('time.issued', R, instant),
        performer: [c.org && ref(c.org), actor(c, 'performer') && ref(actor(c, 'performer')), actor(c, 'author') && ref(actor(c, 'author'))].filter(Boolean),
        resultsInterpreter: actor(c, 'verifier') ? [ref(actor(c, 'verifier'))] : undefined,
        conclusion,
        presentedForm: text ? [{ contentType: 'text/plain; charset=utf-8', language: 'zh-CN', data: base64(text), title: item }] : undefined,
      }
      void findings
      R.touch('findings'); R.touch('bodySite.text')
      finish(c, rep, [
        R.s('reason.text') && { url: ext('reason-text'), valueString: R.s('reason.text') },
        R.s('status') && { url: ext('status-as-recorded'), valueString: R.s('status') },
        (() => { const o = t('time.ordered', R); return o && { url: ext('time-ordered'), valueDateTime: o } })(),
        actor(c, 'requester') && { url: ext('actor-requester'), valueReference: ref(actor(c, 'requester')) },
        deptExt(c.dept),
      ])
    },

    procedure(c) {
      const { R, spec } = c
      const code = R.s('code.code'); const name = R.s('code.display')
      const icd9 = code && /^\d{2}\.\d/.test(code)
      const start = t('time.start', R); const end = t('time.end', R); const at = t('time.performed', R)
      const badPeriod = start && end && end < start
      if (badPeriod) note(`手术 ${c.key}：结束时间早于开始时间，结束时间放在扩展里`)
      const reasonCode = R.s('reason.code'); const reasonText = R.s('reason.text')
      const proc = {
        resourceType: 'Procedure', id: stableId('Procedure', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key), R.s('order.no') && { type: PLACER, system: idSys('order-no'), value: R.s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'completed',
        code: cc([icd9 ? coding(csSys(`${curProfile}/icd-9-cm-3-cn`), code, name) : coding(sysFor(spec, 'code', 'procedure-code', c.org), code, name)], name ?? code),
        subject: patientRef,
        encounter: encounterRef(R, spec, c.org),
        performedPeriod: start ? clean({ start, end: badPeriod ? undefined : end }) : undefined,
        performedDateTime: !start ? at : undefined,
        performer: [
          ...c.acts.filter((a) => ['surgeon', 'assistant', 'anesthetist', 'performer'].includes(a.fn)).map((a) => ({
            function: { text: { surgeon: '主刀医师', assistant: '助手', anesthetist: '麻醉医师', performer: '操作者' }[a.fn] }, actor: ref(a.practitioner), onBehalfOf: c.org ? ref(c.org) : undefined,
          })),
        ],
        reasonCode: reasonCode || reasonText ? [cc([coding(sysFor(spec, 'reason', 'diagnosis-code'), reasonCode, reasonText)], reasonText)] : undefined,
        outcome: R.s('outcome.text') ? { text: R.s('outcome.text') } : undefined,
        bodySite: R.s('bodySite.text') ? [{ text: R.s('bodySite.text') }] : undefined,
        note: R.s('note') ? [{ text: R.s('note') }] : undefined,
      }
      const coded = (role, name2) => {
        const cd = R.s(`${role}.code`); const dp = R.s(`${role}.display`)
        if (!cd && !dp) return undefined
        return { url: ext(name2), valueCodeableConcept: cc([coding(sysFor(spec, role, name2, c.org), cd ?? dp, dp)], dp) }
      }
      finish(c, proc, [
        coded('level', 'procedure-level'), coded('incision', 'incision-class'), coded('anesthesia', 'anesthesia-method'),
        start && at && at !== start && { url: ext('time-scheduled'), valueDateTime: at },
        badPeriod && { url: ext('period-end-as-recorded'), valueDateTime: end },
        deptExt(c.dept),
      ])
      if (start) R.touch('time.performed')
    },

    document(c) {
      const { R, spec } = c
      const parts = []
      for (const [f, title] of spec.sections ?? []) {
        const v = c.R.field(f)
        if (v === undefined || isBlank(v)) continue
        parts.push(`【${title}】\n${String(v)}`)
      }
      const doc = spec.document ?? { code: spec.id, display: spec.id }
      const authored = t('time.authored', R)
      const dr = {
        resourceType: 'DocumentReference', id: stableId('DocumentReference', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key)],
        status: c.invalid ? 'entered-in-error' : 'current',
        type: cc([doc.loinc && { system: T.LOINC, code: doc.loinc, display: doc.loincDisplay }, coding(csSys(`${curProfile}/document-type`), doc.code, doc.display)], doc.display),
        subject: patientRef,
        date: authored && /T/.test(authored) ? authored : undefined,
        author: [actor(c, 'author', 'recorder') && ref(actor(c, 'author', 'recorder')), c.org && ref(c.org)].filter(Boolean),
        custodian: c.org ? ref(c.org) : undefined,
        description: R.s('title') ?? doc.display,
        content: [{ attachment: { contentType: 'text/plain; charset=utf-8', language: 'zh-CN', data: base64(parts.join('\n\n')), title: doc.display, creation: authored } }],
        context: (() => { const e = encounterRef(R, spec, c.org); return e ? { encounter: [e] } : undefined })(),
      }
      // 文书里的结构化体征先出 Observation（先消耗这些字段，免得又进 source-field）
      observationItems(c, spec.items ?? [], authored, dr)
      finish(c, dr, [deptExt(c.dept)])
    },

    observation(c) {
      const made = observationItems(c, c.spec.items ?? [], t('time.effective', c.R), null)
      c.R.touch('source.name')
      const exts = [...auditExt(c), ...leftovers(c.spec, c.row, c.R)]
      // 本行其余字段挂在本行生成的第一条 Observation 上；一条都没生成时挂在 Patient 上
      if (!exts.length) return
      if (made[0]) made[0].extension = [...(made[0].extension ?? []), ...exts]
      else pat.extra.push(...exts)
    },

    medication(c) {
      const { R, spec } = c
      const dose = parseNumber(R.get('dose.value'))
      const qty = parseNumber(R.get('quantity'))
      const mr = {
        resourceType: 'MedicationRequest', id: stableId('MedicationRequest', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key), R.s('order.no') && { type: PLACER, system: idSys('order-no'), value: R.s('order.no') }].filter(Boolean),
        status: c.invalid ? 'entered-in-error' : 'unknown', intent: 'order',
        medicationCodeableConcept: cc([coding(sysFor(spec, 'drug', 'drug', c.org), R.s('drug.code'), R.s('drug.display'))], R.s('drug.display') ?? R.s('drug.code') ?? '药品'),
        subject: patientRef, encounter: encounterRef(R, spec, c.org),
        authoredOn: t('time.authored', R) ?? t('time.start', R),
        requester: actor(c, 'requester', 'author') ? ref(actor(c, 'requester', 'author')) : undefined,
        dosageInstruction: [clean({
          text: [R.s('dose.value') && `${R.s('dose.value')}${R.s('dose.unit') ?? ''}`, R.s('route.display'), R.s('frequency.display')].filter(Boolean).join(' '),
          route: R.s('route.display') ? { text: R.s('route.display') } : undefined,
          timing: R.s('frequency.display') ? { code: { text: R.s('frequency.display') } } : undefined,
          doseAndRate: dose ? [{ doseQuantity: quantity(dose, R.s('dose.unit')) }] : undefined,
        })].filter(Boolean),
        dispenseRequest: clean({
          quantity: qty ? quantity(qty, R.s('quantity.unit')) : undefined,
          validityPeriod: clean({ start: t('time.start', R), end: t('time.end', R) }),
        }),
        note: R.s('note') ? [{ text: R.s('note') }] : undefined,
      }
      finish(c, mr, [deptExt(c.dept)])
    },

    charge(c) {
      const { R, spec } = c
      const qty = parseNumber(R.get('quantity'))
      const money = (role, name) => { const n = parseNumber(R.get(role)); return n ? { url: ext(name), valueMoney: { value: n.value, currency: 'CNY' } } : undefined }
      const cat = R.s('category.display') ?? R.s('category.code')
      const ci = {
        resourceType: 'ChargeItem', id: stableId('ChargeItem', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key)],
        status: c.invalid ? 'entered-in-error' : 'billable',
        code: cc([coding(sysFor(spec, 'item', 'charge-item', c.org), R.s('item.code'), R.s('item.display'))], R.s('item.display') ?? R.s('item.code') ?? '收费项目'),
        subject: patientRef,
        context: encounterRef(R, spec, c.org),
        occurrenceDateTime: t('time.occurrence', R),
        performingOrganization: c.org ? ref(c.org) : undefined,
        requestingOrganization: c.dept ? ref(c.dept) : undefined,
        quantity: qty ? clean({ value: qty.value, unit: R.s('unit') }) : undefined,
        enterer: actor(c, 'recorder') ? ref(actor(c, 'recorder')) : undefined,
      }
      R.touch('unit')
      finish(c, ci, [
        money('unitPrice', 'unit-price'), money('total', 'total-price'),
        cat && { url: ext('fee-category'), valueCodeableConcept: cc([coding(sysFor(spec, 'category', 'fee-category'), R.s('category.code') ?? cat, R.s('category.display'))], R.s('category.display')) },
        flagExt('refund', R.get('refund.flag')),
      ])
      R.touch('category.code')
    },

    death(c) {
      const { R, spec } = c
      const when = t('time.death', R)
      if (when) patient.deceasedDateTime = when
      else patient.deceasedBoolean = true
      const causeCode = R.s('cause.code'); const causeName = R.s('cause.display')
      finish(c, {
        resourceType: 'Observation', id: stableId('Observation', spec.id, c.key, 'cause'),
        identifier: [recordIdentifier(spec, c.key)],
        status: c.invalid ? 'entered-in-error' : 'final',
        code: cc([coding(csSys(`${curProfile}/observation`), 'cause-of-death', '根本死因')], '根本死因'),
        subject: patientRef,
        effectiveDateTime: when,
        performer: c.org ? [ref(c.org)] : undefined,
        valueCodeableConcept: cc([coding(sysFor(spec, 'cause', 'diagnosis-code'), causeCode, causeName)], causeName ?? causeCode),
        note: R.s('cause.text') ? [{ text: R.s('cause.text') }] : undefined,
      }, [R.s('place.display') && { url: ext('death-place'), valueString: R.s('place.display') }])
    },

    generic(c) {
      const { spec, R } = c
      const when = t('time.recorded', R)
      finish(c, {
        resourceType: 'Basic', id: stableId('Basic', spec.id, c.key),
        identifier: [recordIdentifier(spec, c.key)],
        code: cc([coding(csSys(`${curProfile}/source-table`), spec.id, spec.name ?? spec.id)], spec.name ?? spec.id),
        subject: patientRef,
        created: when ? when.slice(0, 10) : undefined,
        author: c.org ? ref(c.org) : undefined,
      }, [encounterRef(R, spec, c.org) && { url: ext('encounter'), valueReference: encounterRef(R, spec, c.org) }])
    },
  }

  /** observation items shared by `observation` and `document` kinds. */
  function observationItems(c, items, effective, derivedFrom) {
    const { spec, row, R } = c
    const vit = {}
    const made = []
    for (const item of items) {
      const v = R.field(item.field ?? item.coded?.code)
      if (item.coded?.display) R.field(item.coded.display)
      const display = item.coded?.display ? str(row[item.coded.display]) : undefined
      const raw = item.coded ? (str(v) ?? display) : str(v)
      if (raw === undefined) continue
      if (item.measure === 'systolic' || item.measure === 'diastolic') { vit[item.measure] = { raw, field: item.field }; continue }
      const m = item.measure ? T.MEASURES[item.measure] : undefined
      const num = parseNumber(raw)
      const id = stableId('Observation', spec.id, c.key, item.local ?? item.measure ?? item.field)
      const category = m ? 'vital-signs' : item.category ?? 'survey'
      const obs = {
        resourceType: 'Observation', id,
        meta: metaOf(c.file),
        identifier: [recordIdentifier(spec, `${c.key}#${item.local ?? item.measure ?? item.field}`)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: category, display: { 'vital-signs': 'Vital Signs', 'social-history': 'Social History', laboratory: 'Laboratory', exam: 'Exam', survey: 'Survey' }[category] }] }],
        code: cc([
          m && { system: T.LOINC, code: m.loinc, display: m.display },
          item.loinc && { system: T.LOINC, code: item.loinc, display: item.loincDisplay },
          coding(csSys(`${curProfile}/observation`), item.local ?? item.measure ?? item.field, item.text ?? m?.text),
        ], item.text ?? m?.text ?? item.field),
        subject: patientRef,
        encounter: encounterRef(R, spec, c.org),
        effectiveDateTime: effective,
        performer: c.org ? [ref(c.org)] : undefined,
        derivedFrom: derivedFrom ? [ref(derivedFrom)] : undefined,
      }
      if (item.coded) {
        obs.valueCodeableConcept = cc([coding(csSys(`${curProfile}/${item.local ?? item.coded.code}`), str(v), display)], display ?? str(v))
      } else if (m && num) {
        obs.valueQuantity = { value: num.value, unit: T.UCUM_DISPLAY[m.ucum] ?? m.ucum, system: T.UCUM, code: m.ucum, ...(num.comparator ? { comparator: num.comparator } : {}) }
      } else if (num && !item.asString) {
        obs.valueQuantity = clean({ value: num.value, comparator: num.comparator, unit: item.unit })
      } else {
        obs.valueString = raw
      }
      const src = R.s('source.name')
      obs.extension = [src && { url: ext('source-system'), valueString: src }, ...badCodeExts()].filter(Boolean)
      made.push(add(clean(obs)))
      stats.byKind[spec.kind] = (stats.byKind[spec.kind] ?? 0) + 1
    }
    if (vit.systolic || vit.diastolic) {
      const comp = (k) => {
        const m = T.MEASURES[k]; const n = vit[k] && parseNumber(vit[k].raw)
        if (!vit[k]) return undefined
        return {
          code: { coding: [{ system: T.LOINC, code: m.loinc, display: m.display }], text: m.text },
          ...(n ? { valueQuantity: { value: n.value, unit: 'mmHg', system: T.UCUM, code: 'mm[Hg]' } } : { valueString: vit[k].raw }),
        }
      }
      const bp = T.MEASURES.bloodPressure
      made.push(add(clean({
        resourceType: 'Observation', id: stableId('Observation', spec.id, c.key, 'blood-pressure'),
        meta: metaOf(c.file),
        identifier: [recordIdentifier(spec, `${c.key}#blood-pressure`)],
        status: c.invalid ? 'entered-in-error' : 'final',
        category: [{ coding: [{ system: T.OBS_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
        code: { coding: [{ system: T.LOINC, code: bp.loinc, display: bp.display }], text: bp.text },
        subject: patientRef, encounter: encounterRef(R, spec, c.org), effectiveDateTime: effective,
        performer: c.org ? [ref(c.org)] : undefined,
        derivedFrom: derivedFrom ? [ref(derivedFrom)] : undefined,
        component: [comp('systolic'), comp('diastolic')].filter(Boolean),
      })))
      stats.byKind[spec.kind] = (stats.byKind[spec.kind] ?? 0) + 1
    }
    return made
  }

  /* ================================================================ run */
  // 就诊先建，其他记录才能挂上去
  const ordered = [...records].sort((a, b) => (a.spec.kind === 'encounter' ? 0 : 1) - (b.spec.kind === 'encounter' ? 0 : 1))
  for (const rec of ordered) {
    curProfile = rec.profileId ?? ctx.profileId
    badCodes = []
    const c = common(rec)
    const build = builders[rec.spec.kind] ?? builders.generic
    build(c)
  }

  /* ---------------------------------------------------- finish Patient */
  const names = [...pat.names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  if (names.length) patient.name = names.map((n, i) => ({ use: i === 0 ? 'official' : 'old', text: n }))
  const primaryG = pat.genders.filter((x) => x.primary).map((x) => x.g)
  const pool = primaryG.length ? primaryG : pat.genders.map((x) => x.g)
  const definite = pool.filter((g) => g === 'male' || g === 'female')
  const gset = new Set(definite)
  if (gset.size > 1) note(`性别记录不一致：${[...gset].join('/')}，取出现最多的`)
  const pick = (arr) => { const n = new Map(); for (const x of arr) n.set(x, (n.get(x) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] }
  patient.gender = pick(definite.length ? definite : pool)
  const primaryB = pat.births.filter((x) => x.primary).map((x) => x.b)
  const bpool = primaryB.length ? primaryB : pat.births.map((x) => x.b)
  if (new Set(bpool).size > 1) note(`出生日期记录不一致：${[...new Set(bpool)].join('/')}，取出现最多的`)
  patient.birthDate = pick(bpool)
  if (pat.telecoms.size) patient.telecom = [...pat.telecoms].map((v) => ({ system: 'phone', value: v }))
  for (const idf of pat.identifiers.values()) patient.identifier.push(clean(idf))
  // 地址：同一地址文本只留一条，记最早的记录时间
  const byText = new Map()
  for (const a of pat.addresses) {
    const k = JSON.stringify([a.text, a.state, a.city, a.district, a.line, a.extension?.find((e) => e.url.endsWith('address-kind'))?.valueString])
    const prev = byText.get(k)
    if (!prev) byText.set(k, a)
    else if (a.period?.start && (!prev.period?.start || a.period.start < prev.period.start)) prev.period = a.period
  }
  if (byText.size) patient.address = [...byText.values()]
  if (pat.marital) {
    const m = T.marital(pat.marital.display)
    patient.maritalStatus = cc([m && { system: T.V3_MARITAL, ...m }], pat.marital.display)
  }
  if (pat.extra.length) patient.extension = [...(patient.extension ?? []), ...pat.extra]
  Object.assign(patient, clean(patient))

  // DiagnosticReport 收尾：全部作废才算作废；去掉内部字段
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
