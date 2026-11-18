/**
 * 演示用的虚构数据：每位病人一个目录，十张“没有映射规格”的表（字段名是自造的英文缩写，取值全部虚构）。
 * 只用于 README 动画和页面预览，和真实病历无关。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const pick = (arr, i) => arr[i % arr.length]
const pad = (n, w = 2) => String(n).padStart(w, '0')
const day = (i, d = 0) => `2025-${pad(1 + (i % 12))}-${pad(1 + ((i * 7 + d) % 27))}`

const ITEMS = [['GLU', '葡萄糖', 'mmol/L', '3.9-6.1'], ['CREA', '肌酐', 'umol/L', '57-111'], ['INS', '胰岛素', 'μIU/ml', '2.6-24.9'], ['WBC', '白细胞', '10^9/L', '3.5-9.5'], ['HB', '血红蛋白', 'g/L', '130-175'], ['ALT', '丙氨酸氨基转移酶', 'U/L', '9-50'], ['TSH', '促甲状腺激素', 'mIU/L', '0.27-4.2'], ['UA', '尿酸', 'umol/L', '208-428']]
const DRUGS = [['D01', '二甲双胍片', 0.5, 'g', '每日两次', '口服'], ['D02', '阿托伐他汀钙片', 20, 'mg', '每晚一次', '口服'], ['D03', '氨氯地平片', 5, 'mg', '每日一次', '口服'], ['D04', '胰岛素注射液', 8, 'U', '每日三次', '皮下注射']]
const DIAG = [['E11.900', '2型糖尿病'], ['I10.x00', '高血压'], ['E78.500', '高脂血症'], ['N18.300', '慢性肾脏病3期']]
const FEES = [['F01', '血常规', 1, 20], ['F02', '生化全套', 1, 120], ['F03', '门诊诊查费', 1, 15], ['F04', '西药费', 2, 36.5]]
const OPS = [['47.0100', '腹腔镜阑尾切除术'], ['36.0601', '冠状动脉支架置入术']]

async function put(dir, file, rows) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, file), JSON.stringify(rows, null, 1)) }

export async function writeDemoPatient(dir, i) {
  const h = (0xA1B2C3 + i * 7919).toString(16).toUpperCase().slice(-6)
  const P = { PATIENT_ID: `证件-${h}`, ORG_CD: `医院-${pick(['3A1F20', '7C0B11', '52D9E4'], i)}` }
  const vis = [0, 1, 2].map((k) => `门诊-${h}${k}`)
  const inh = `住院-${h}`
  await put(dir, '门诊挂号登记.json', vis.map((v, k) => ({ ...P, REC_ID: `R${h}${k}`, VISIT_NO: v, REG_TM: `${day(i, k * 30)} 08:${pad(10 + k)}:00`, DEPT_NM: pick(['内分泌科', '心内科', '肾内科'], i + k), DOCTOR_NM: `医生-${h.slice(0, 4)}${k}` })))
  await put(dir, '门诊诊断记录.json', vis.map((v, k) => ({ ...P, REC_ID: `D${h}${k}`, VISIT_NO: v, DIAG_CD: pick(DIAG, i + k)[0], DIAG_NM: pick(DIAG, i + k)[1], DIAG_TM: `${day(i, k * 30)} 09:00:00` })))
  await put(dir, '门诊检验结果.json', vis.flatMap((v, k) => [0, 1, 2].map((j) => { const it = pick(ITEMS, i + k * 3 + j); return { ...P, REC_ID: `L${h}${k}${j}`, VISIT_NO: v, RPT_NO: `报告-${h}${k}`, ITEM_CD: it[0], ITEM_NM: it[1], RSLT_VAL: String((5 + ((i * 13 + j * 7) % 40) / 3).toFixed(1)), RSLT_UNIT: it[2], REF_RANGE: it[3], TEST_TM: `${day(i, k * 30)} 10:${pad(20 + j)}:00` } })))
  await put(dir, '门诊处方明细.json', vis.slice(0, 2).map((v, k) => { const d = pick(DRUGS, i + k); return { ...P, REC_ID: `M${h}${k}`, VISIT_NO: v, DRUG_CD: d[0], DRUG_NM: d[1], DOSE: d[2], DOSE_UNIT: d[3], FREQ: d[4], ROUTE: d[5], PRESC_TM: `${day(i, k * 30)} 09:30:00` } }))
  await put(dir, '门诊费用明细.json', vis.flatMap((v, k) => [0, 1].map((j) => { const f = pick(FEES, i + k + j); return { ...P, REC_ID: `F${h}${k}${j}`, VISIT_NO: v, FEE_ITEM_CD: f[0], FEE_ITEM_NM: f[1], QTY: f[2], PRICE: f[3], AMOUNT: f[2] * f[3], FEE_TM: `${day(i, k * 30)} 11:00:00` } })))
  await put(dir, '住院入出院登记.json', [{ ...P, REC_ID: `A${h}`, INHOSP_NO: inh, ADM_TM: `${day(i, 90)} 14:00:00`, DIS_TM: `${day(i, 97)} 10:00:00`, DEPT_NM: '普外科' }])
  await put(dir, '住院手术记录.json', [{ ...P, REC_ID: `O${h}`, INHOSP_NO: inh, OPR_CD: pick(OPS, i)[0], OPR_NM: pick(OPS, i)[1], OPR_TM: `${day(i, 91)} 09:00:00`, SURGEON_NM: `医生-${h.slice(2)}` }])
  await put(dir, '住院出院小结.json', [{ ...P, REC_ID: `S${h}`, INHOSP_NO: inh, DOC_TM: `${day(i, 97)} 09:00:00`, SUMMARY_TXT: '入院情况：患者因腹痛2天入院。诊疗经过：完善检查后行手术治疗，术后恢复良好。出院情况：一般情况可，切口愈合良好。出院医嘱：注意休息，1周后门诊复查。（虚构演示文本）' }])
  await put(dir, '随访记录.json', [0, 1].map((k) => ({ ...P, REC_ID: `V${h}${k}`, FLW_TM: `${day(i, 120 + k * 30)} 15:00:00`, FLW_DCT: `医生-${h.slice(1, 5)}`, FLW_RESULT: pick(['血糖控制平稳，继续原方案治疗。', '血压偏高，建议调整用药并复查。'], i + k) })))
  await put(dir, '病人基本信息.json', [{ ...P, REC_ID: `P${h}`, NAME: `化名-${h}`, SEX_CD: pick(['1', '2'], i), BIRTH_DT: `19${50 + (i % 40)}-0${1 + (i % 9)}-1${i % 9}` }])
}
