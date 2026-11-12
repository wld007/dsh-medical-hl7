/**
 * 交付附带的定义（相当于一份最小的实施指南）：
 *   - 本批用到的每个扩展 → StructureDefinition（类型按实际取值推出）
 *   - 本批用到的每个本地代码体系 → CodeSystem（content=fragment，列出实际出现过的代码与最常见的名称）
 * 接收方拿到这些定义，官方校验器（-ig definitions/）和 FHIR 服务器都能识别本地扩展与代码。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const VALUE_TYPE = {
  valueString: 'string', valueDateTime: 'dateTime', valueReference: 'Reference', valueCoding: 'Coding',
  valueCodeableConcept: 'CodeableConcept', valueMoney: 'Money', valueBoolean: 'boolean', valueDecimal: 'decimal',
  valueInteger: 'integer', valueCode: 'code', valueDate: 'date', valueUri: 'uri', valueQuantity: 'Quantity',
}
const DESCRIPTIONS = {
  'source-field': '源数据里没有对应语义角色的字段，按原字段名与原值保留（name/value）。',
  'record-created': '源记录的创建时间。', 'record-updated': '源记录的更新时间。',
  department: '科室（Organization，partOf 医疗机构）。', organization: '记录所属医疗机构。',
  'address-kind': '地址类别（如户籍地址、现住址）。', 'admin-division-code': '行政区划代码（取最细一级）。',
  'source-system': '源数据的来源系统名称。', 'result-flag': '检验结果标志（源系统原值，含义未定义，未换算为 interpretation）。',
  'unit-as-recorded': '非数值结果所带的单位原文。', 'time-ordered': '申请时间。', 'time-scheduled': '计划时间（与实际开始时间不同）。',
  'period-end-as-recorded': '源数据里早于开始时间的结束时间原值。', 'reason-text': '检查原因（临床诊断）原文。',
  'status-as-recorded': '源系统状态原值。', 'unit-price': '单价。', 'total-price': '金额。', 'fee-category': '费用类别。',
  'death-place': '死亡地点类别。', encounter: '关联就诊（资源本身没有 encounter 元素时使用）。',
  'diagnosis-sequence': '诊断序号原值。', 'marital-status-at-visit': '就诊时登记的婚姻状况原文。',
  'procedure-level': '手术级别。', 'mapping-origin': '这个编码由模型给出（经插件校验和独立盲审），尚未经人工复核。', 'incision-class': '切口类别。', 'anesthesia-method': '麻醉方式。',
}

export function createDefinitionCollector(ns) {
  const exts = new Map() // url → { types:Set, targets:Set, complex:boolean }
  const systems = new Map() // url → Map(code → Map(display → count))
  const csPrefix = `${ns}/CodeSystem/`
  const extPrefix = `${ns}/StructureDefinition/`
  function visit(node) {
    if (Array.isArray(node)) { for (const x of node) visit(x); return }
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.extension)) {
      for (const e of node.extension) {
        if (!e?.url?.startsWith(extPrefix)) continue
        const x = exts.get(e.url) ?? { types: new Set(), targets: new Set(), complex: false }
        if (e.extension) x.complex = true
        for (const k of Object.keys(e)) if (VALUE_TYPE[k]) x.types.add(VALUE_TYPE[k])
        const ref = e.valueReference?.reference ?? (e.valueReference?.type)
        if (ref) x.targets.add(ref.split('/')[0])
        exts.set(e.url, x)
      }
    }
    if (typeof node.system === 'string' && node.system.startsWith(csPrefix) && typeof node.code === 'string') {
      const codes = systems.get(node.system) ?? new Map()
      const d = codes.get(node.code) ?? new Map()
      if (node.display) d.set(node.display, (d.get(node.display) ?? 0) + 1)
      codes.set(node.code, d)
      systems.set(node.system, codes)
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v)
  }
  return {
    add(resources) { for (const r of resources) visit(r) },
    async write(dir) {
      await mkdir(dir, { recursive: true })
      const written = { StructureDefinition: 0, CodeSystem: 0 }
      for (const [url, x] of exts) {
        const sd = extensionDefinition(url, url.slice(extPrefix.length), x)
        await writeFile(join(dir, `StructureDefinition-${sd.id}.json`), JSON.stringify(sd, null, 1))
        written.StructureDefinition++
      }
      const multiDisplay = []
      for (const [url, codes] of systems) {
        const id = url.slice(csPrefix.length).replace(/[^A-Za-z0-9.-]+/g, '-').slice(0, 64)
        const cs = {
          resourceType: 'CodeSystem', id, url,
          name: pascal(id).slice(0, 255), title: `本地代码：${url.slice(csPrefix.length)}`,
          status: 'active', experimental: false, caseSensitive: true,
          description: '源系统的本地代码，按本批数据实际出现的代码整理（fragment）。显示名取出现最多的写法；同一代码在源数据里出现过的其他写法列为同义名（designation），按原样保留。',
          content: 'fragment', count: codes.size,
          concept: [...codes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, d]) => {
            const names = [...d.entries()].sort((a, b) => b[1] - a[1])
            if (!names.length) return { code }
            if (names.length > 1) multiDisplay.push({ system: url.slice(csPrefix.length), code, names: names.map(([n, c]) => `${n}（${c}）`) })
            return {
              code, display: names[0][0],
              designation: names.length > 1 ? names.slice(1).map(([n]) => ({ language: 'zh', use: { system: 'http://snomed.info/sct', code: '900000000000013009', display: 'Synonym' }, value: n })) : undefined,
            }
          }).map((c) => (c.designation ? c : { code: c.code, ...(c.display ? { display: c.display } : {}) })),
        }
        await writeFile(join(dir, `CodeSystem-${id}.json`), JSON.stringify(cs, null, 1))
        written.CodeSystem++
      }
      written.multiDisplay = multiDisplay.length
      written.multiDisplaySample = multiDisplay.sort((a, b) => b.names.length - a.names.length).slice(0, 30)
      return written
    },
  }
}

const pascal = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/^[^A-Za-z]+/, '') || 'Local'

function extensionDefinition(url, name, x) {
  const id = name.replace(/[^A-Za-z0-9.-]+/g, '-').slice(0, 64)
  const desc = DESCRIPTIONS[name] ?? DESCRIPTIONS[name.replace(/^(flag|actor)-.*/, '$1')] ?? (name.startsWith('flag-') ? '源系统标志原值（含义未定义）。' : name.startsWith('actor-') ? '参与该记录的医务人员。' : '本地扩展。')
  const base = {
    resourceType: 'StructureDefinition', id, url, name: pascal(id), title: name, status: 'active', fhirVersion: '4.0.1',
    description: desc, kind: 'complex-type', abstract: false, context: [{ type: 'element', expression: 'Element' }],
    type: 'Extension', baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension', derivation: 'constraint',
  }
  if (x.complex) {
    const slice = (n) => [
      { id: `Extension.extension:${n}`, path: 'Extension.extension', sliceName: n, min: 1, max: '1' },
      { id: `Extension.extension:${n}.extension`, path: 'Extension.extension.extension', max: '0' },
      { id: `Extension.extension:${n}.url`, path: 'Extension.extension.url', fixedUri: n },
      { id: `Extension.extension:${n}.value[x]`, path: 'Extension.extension.value[x]', min: 1, type: [{ code: 'string' }] },
    ]
    return {
      ...base,
      differential: {
        element: [
          { id: 'Extension', path: 'Extension', short: desc, definition: desc },
          { id: 'Extension.extension', path: 'Extension.extension', slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'closed' }, min: 2 },
          ...slice('name'), ...slice('value'),
          { id: 'Extension.url', path: 'Extension.url', fixedUri: url },
          { id: 'Extension.value[x]', path: 'Extension.value[x]', max: '0' },
        ],
      },
    }
  }
  const types = [...x.types].map((code) => (code === 'Reference'
    ? { code, targetProfile: (x.targets.size ? [...x.targets] : ['Resource']).map((t) => `http://hl7.org/fhir/StructureDefinition/${t}`) }
    : { code }))
  return {
    ...base,
    differential: {
      element: [
        { id: 'Extension', path: 'Extension', short: desc, definition: desc },
        { id: 'Extension.extension', path: 'Extension.extension', max: '0' },
        { id: 'Extension.url', path: 'Extension.url', fixedUri: url },
        { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, type: types.length ? types : [{ code: 'string' }] },
      ],
    },
  }
}
