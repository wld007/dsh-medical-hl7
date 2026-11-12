/**
 * 标准术语：只放确知的对照。其余一律用本地代码体系原样保留。
 */
export const LOINC = 'http://loinc.org'
export const UCUM = 'http://unitsofmeasure.org'
export const V3_ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode'
export const V3_MARITAL = 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus'
export const V3_PARTICIPATION = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType'
export const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category'
export const COND_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category'
export const COND_VER = 'http://terminology.hl7.org/CodeSystem/condition-ver-status'
export const DIAG_ROLE = 'http://terminology.hl7.org/CodeSystem/diagnosis-role'
export const V2_0074 = 'http://terminology.hl7.org/CodeSystem/v2-0074'
export const DATA_ABSENT = 'http://terminology.hl7.org/CodeSystem/data-absent-reason'
export const DICOM_DCM = 'http://dicom.nema.org/resources/ontology/DCM'
export const ORG_TYPE = 'http://terminology.hl7.org/CodeSystem/organization-type'

/** 体征：LOINC + UCUM。血压收缩压/舒张压合成一条 85354-9 面板。 */
export const MEASURES = {
  height: { loinc: '8302-2', display: 'Body height', text: '身高', ucum: 'cm' },
  weight: { loinc: '29463-7', display: 'Body weight', text: '体重', ucum: 'kg' },
  bmi: { loinc: '39156-5', display: 'Body mass index (BMI) [Ratio]', text: '体重指数', ucum: 'kg/m2' },
  waist: { loinc: '8280-0', display: 'Waist Circumference at umbilicus by Tape measure', text: '腰围', ucum: 'cm' },
  temperature: { loinc: '8310-5', display: 'Body temperature', text: '体温', ucum: 'Cel' },
  pulse: { loinc: '8867-4', display: 'Heart rate', text: '脉率', ucum: '/min' },
  respiration: { loinc: '9279-1', display: 'Respiratory rate', text: '呼吸频率', ucum: '/min' },
  systolic: { loinc: '8480-6', display: 'Systolic blood pressure', text: '收缩压', ucum: 'mm[Hg]' },
  diastolic: { loinc: '8462-4', display: 'Diastolic blood pressure', text: '舒张压', ucum: 'mm[Hg]' },
  bloodPressure: { loinc: '85354-9', display: 'Blood pressure panel with all children optional', text: '血压' },
}
export const UCUM_DISPLAY = { cm: 'cm', kg: 'kg', 'kg/m2': 'kg/m2', Cel: '℃', '/min': '次/分', 'mm[Hg]': 'mmHg' }

/** GB/T 2261.1 性别代码 → FHIR administrative-gender。按名称兜底。 */
export function gender(code, display) {
  const c = code === undefined || code === null ? '' : String(code).trim()
  const d = display === undefined || display === null ? '' : String(display).trim()
  if (/^男/.test(d) || (c === '1' && !d)) return 'male'
  if (/^女/.test(d) || (c === '2' && !d)) return 'female'
  if (c === '1' && /男/.test(d)) return 'male'
  if (c === '2' && /女/.test(d)) return 'female'
  if (/未知|未说明|不详/.test(d) || c === '0' || c === '9') return 'unknown'
  if (/其他/.test(d)) return 'other'
  return undefined
}

/** GB/T 2261.2 婚姻状况（按名称）→ v3 MaritalStatus。 */
export function marital(display) {
  const d = String(display ?? '').trim()
  if (/^未婚/.test(d)) return { code: 'S', display: 'Never Married' }
  if (/^(已婚|初婚|再婚|复婚)/.test(d)) return { code: 'M', display: 'Married' }
  if (/^丧偶/.test(d)) return { code: 'W', display: 'Widowed' }
  if (/^离婚/.test(d)) return { code: 'D', display: 'Divorced' }
  return undefined
}

/** DICOM 设备类型（只认标准代码本身）。 */
export const DICOM_MODALITIES = new Set(['CT', 'MR', 'US', 'CR', 'DX', 'XA', 'NM', 'PT', 'RF', 'MG', 'ES', 'ECG', 'OT', 'IO', 'PX', 'OCT', 'OP', 'SM', 'XC', 'RG', 'BMD'])
