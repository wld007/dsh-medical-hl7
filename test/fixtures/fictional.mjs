/**
 * 虚构的区域平台导出（全部是编出来的值，不来自任何真实病历）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const put = async (dir, rel, rows) => {
  const p = join(dir, rel)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, JSON.stringify(rows))
}

export async function writeFictionalPatient(dir, { id = '证件-AAAAAA', name = '化名-BBBBBB', extraText = '' } = {}) {
  const base = { ID_CRD_NO: id, MDC_ORG_CD: '医院-111111', MDC_ORG_NM: '医院-222222' }
  await put(dir, '人口信息学/病史/190001/p_doc_dwd_psn_rcd.json', [
    { _id: 'p1', PRM_KEY: '病历-000001', ID_CRD_NO: id, RSDNT_NM: name, GDR_CD: '1', GDR_NM: '男性', BTH_DT: '19500102', HYPTSN_MDC_HST_FLG: '1', HYPTSN_MDC_HST__SOURCE: '记录时间：2020-01-02 03:04:05' },
  ])
  await put(dir, '人口信息学/地理信息/现住址/202001/p_doc_dwd_curt_addr.json', [
    { _id: 'a1', PRM_KEY: '病历-000002', ID_CRD_NO: id, CURR_ADDR: '地址-333333', CURR_ADDR_PRV_CD: '330000000000', CURR_ADDR_CNTY_CD: '330109000000', RCD_TIME: '2020-01-05', SOURCE_TB: 'x.tb', SOURCE_NM: '虚构来源' },
  ])
  await put(dir, '就诊/就诊记录/202001/p_doc_fact_vst_infmt.json', [
    { ...base, _id: 'v1', PRM_KEY: '病历-000003', PID: '病历-444444', OTPT_EMG_NO: '就诊-555555', VST_TP: '1', VST_DT: 1578000000000, VST_DT_TM: 1578000000000, PTT_NM: name, GDR_CD: '1', GDR_NM: '男性', BTH_DT: -630000000000, VST_DPT_CD: '01', VST_DPT_NM: '肾内科', VST_DCT_CD: '医生-666666', SLF_TEL_NO: '电话-777777', CRT_TM: 1578000000000, MYSTERY_FIELD: '保留我' },
    { ...base, _id: 'v2', PRM_KEY: '病历-000004', PID: '病历-444444', INHOS_NO: '住院-888888', VST_TP: '2', ADMN_DT_TM: 1579000000000, DSCG_DT_TM: 1579600000000, ADMN_DPT_NM: '肾内科', PTT_NM: name, CRT_TM: 1579000000000 },
  ])
  await put(dir, '诊断/诊断记录/202001/p_doc_fact_diag_infmt.json', [
    { ...base, _id: 'd1', PRM_KEY: '病历-000005', VST_TP: 1, OTPT_EMG_NO: '就诊-555555', PID: '病历-444444', DIAG_CD: '123', DIAG_DT: 1578000100000, DIAG_ICD10_CD: 'N18.500', DIAG_ICD10_NM: '慢性肾脏病5期', DIAG_DSCPT: '慢性肾脏病5期', DIAG_DCT_CD: '医生-666666', CRT_TM: 1578000100000, INVLD_FLG: '0' },
    { ...base, _id: 'd2', PRM_KEY: '病历-000006', VST_TP: 2, INHOS_NO: '住院-999999', PID: '病历-444444', DIAG_CD: '124', DIAG_ICD10_CD: 'I10.x00', DIAG_ICD10_NM: '高血压', DIAG_DSCPT: '高血压', CRT_TM: 1579000100000, INVLD_FLG: '1' },
  ])
  await put(dir, '检验/检验记录/202001/p_doc_fact_test_rcd.json', [
    { ...base, _id: 'l1', PRM_KEY: '病历-000007', TEST_RCD_NO: '病历-R00001', TEST_RPT_NO: '病历-R00001', PID: '病历-444444', PTT_SRC_CD: '1', INHOS_NO: '住院-888888', TEST_ITM_CD: 'LIS1', TEST_ITM_NM: '肾功能', TEST_CHD_ITM_CD: '5049', TEST_CHD_ITM_NM: '肌酐', TEST_RSLT_VLU: '856.0', TEST_RSLT_VLU_UNT: 'umol/L', RFRC_VLU: '57-111', RSLT_FLG: '1', SPCM_CD: '2069', SPCM_NM: '血清', TEST_DT: 1579100000000, ADT_TM: 1579110000000, TEST_DCT_NM: '医生-AAAAA1', ADT_DCT_NM: '医生-AAAAA2', AGE: 70, CRT_TM: 1579100000000 },
    { ...base, _id: 'l2', PRM_KEY: '病历-000008', TEST_RCD_NO: '病历-R00001', TEST_RPT_NO: '病历-R00001', PID: '病历-444444', PTT_SRC_CD: '1', INHOS_NO: '住院-888888', TEST_ITM_CD: 'LIS1', TEST_ITM_NM: '肾功能', TEST_CHD_ITM_CD: '5050', TEST_CHD_ITM_NM: '尿酸', TEST_RSLT_VLU: '阴性', RFRC_VLU: '阴性', SPCM_NM: '血清', TEST_DT: 1579100000000, ADT_TM: 1579110000000, CRT_TM: 1579100000000 },
    { ...base, _id: 'l4', PRM_KEY: '病历-000017', TEST_RCD_NO: '病历-R00002', TEST_RPT_NO: '病历-R00002', PID: '病历-444444', TEST_ITM_NM: '血糖', TEST_CHD_ITM_NM: '胰岛素', TEST_RSLT_VLU: '12.1', TEST_RSLT_VLU_UNT: 'μIU/ml', TEST_DT: '2020-01-20 08:00:00', CRT_TM: 1579478400000 },
    { ...base, _id: 'l3', PRM_KEY: '病历-000009', TEST_RCD_NO: '病历-R00002', TEST_RPT_NO: '病历-R00002', PID: '病历-444444', TEST_ITM_NM: '血糖', TEST_CHD_ITM_NM: '葡萄糖', TEST_RSLT_VLU: '<0.5', TEST_RSLT_VLU_UNT: 'mmol/L', TEST_DT: '2020-01-20 08:00:00', CRT_TM: 1579478400000 },
  ])
  await put(dir, '检查/检查记录/202001/p_doc_fact_exam_rcd.json', [
    { ...base, _id: 'e1', PRM_KEY: '病历-000010', PID: '病历-444444', EXAM_RCD_NO: '病历-E00001', EXAM_ITM_TP_NM: 'CT', EXAM_ITM_NM: '胸部平扫CT', EXAM_RPT_RSLT_OBJCT: '两肺纹理清。', EXAM_RPT_RSLT_SBJCT: '未见异常\n请结合临床', EXAM_DT: '2020-01-21 10:00:00', EXAM_RPT_DT: '2020-01-21 11:00:00', INHOS_NO: '住院-888888', CRT_TM: '2020-01-21 11:00:00' },
  ])
  await put(dir, '一般治疗处置/手术记录/202001/p_doc_fact_oprt_rcd.json', [
    { ...base, _id: 's1', PRM_KEY: '病历-000011', INHOS_NO: '住院-888888', PID: '病历-444444', OPRT_CD: '39.2701', OPRT_NM: '动静脉造瘘术', OPRT_DCT_CD: '医生-BBBBB1', OPRT_DCT_NM: '医生-BBBBB2', OPRT_STRT_DT_TM: 1579200000000, OPRT_END_DT_TM: 1579203600000, OPRT_DT_TM: 1579190000000, ATHS_WAY_CD: '9', ATHS_WAY_NM: '局麻', OPRT_LVL_CD: '2', OPRT_LVL_NM: '二级手术', OPRT_PRCS_DSCPT: '虚构的手术经过。', ABO_CD: '5', CRT_TM: 1579203600000 },
  ])
  await put(dir, '病历记录/门诊病历/202001/p_doc_fact_otpt_emg_mdc_htr_rcd.json', [
    { ...base, _id: 'o1', PRM_KEY: '病历-000012', OTPT_EMG_NO: '就诊-555555', PID: '病历-444444', CHF_COMPLNT: '乏力1月。', PRST_ILLNS_HST: `虚构现病史。${extraText}`, PSQ_EXAM: 'BP 150/90mmHg', PSQ_EXAM_STLC_PRS: '150', PSQ_EXAM_DTLC_PRS: '90', PSQ_EXAM_HGT: '170', CRT_TM: 1578000200000, INVLD_FLG: '0' },
  ])
  await put(dir, '费用/门诊费用/202001/p_doc_fact_otpt_fee_dtl.json', [
    { ...base, _id: 'f1', PRM_KEY: '病历-000013', OTPT_EMG_NO: '就诊-555555', CHRG_RTRN_FLG: '1', CHRG_DT: 1578000300000, CHRG_ITM_CD: '100', CHRG_ITM_NM: '静脉采血', FEE_CGY_CD: '5', FEE_CGY_NM: '检查费', ITM_QTY: 1, ITM_UNT_PRICE: 5.8, ITM_FEE: 5.8, INVLD_FLG: '0' },
  ])
  await put(dir, '人口信息学/基本信息/身高/202001/p_doc_dwd_height.json', [
    { _id: 'h1', PRM_KEY: '病历-000014', ID_CRD_NO: id, HEIGHT: '170.0', RCD_TIME: 1578000000000, SOURCE_NM: '公卫体检', SOURCE_TB: 'x.h', SOURCE_ORG_CD: '医院-111111', SOURCE_ORG_NM: '医院-222222' },
  ])
  await put(dir, '人口信息学/家庭与生活方式/吸烟/202001/p_doc_dwd_smock.json', [
    { _id: 'k1', PRM_KEY: '病历-000015', ID_CRD_NO: id, SMK_FLG: '1', SMK_STTS_CD: '3', SMK_STTS_NM: '吸烟', SMK_QTY: '10', RCD_TIME: 1578000000000 },
  ])
  // 代码里带换行（真实导出里见过）
  await put(dir, '人口信息学/症状/202001/p_doc_dwd_smp.json', [
    { _id: 'y1', PRM_KEY: '病历-000016', ID_CRD_NO: id, SMP_CD: '乏力\r\nnone', SMP_NM: '乏力\r\nnone', RCD_TIME: 1578000000000, SOURCE_NM: 'x' },
  ])
  // 没有内置规格的表
  await put(dir, '其他/随访/202001/some_followup_table.json', [
    { REC_ID: 'x1', ID_CRD_NO: id, ORG_CD: '医院-111111', FLW_DCT: '医生-CCCCC1', FLW_TM: '2020-02-01 09:00:00', FLW_RESULT: '血压控制可', VISIT_NO: '就诊-555555' },
  ])
}

/** A checksum-valid but fictional 18-digit id-card number. */
export function fakeIdCard(prefix17 = '11010519491231002') {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let s = 0
  for (let i = 0; i < 17; i++) s += Number(prefix17[i]) * W[i]
  return prefix17 + '10X98765432'[s % 11]
}
