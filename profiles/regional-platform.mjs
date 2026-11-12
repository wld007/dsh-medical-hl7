/**
 * 内置映射规格：区域平台导出（p_doc_*.json，按“类别/子类/年月”分文件）。
 * 只是数据：字段 → 语义角色。没写进规格的字段不会丢，按原样挂在资源的 source-field 扩展上。
 *
 * 取值对照（values）只写确知的含义。RSLT_FLG 等含义不明的代码原样保留在本地代码体系里，不换算成 FHIR 的 interpretation。
 */
const org = { 'org.code': 'MDC_ORG_CD', 'org.name': 'MDC_ORG_NM' }
const pat = { 'patient.id': 'ID_CRD_NO', 'patient.localId': 'PID', 'patient.name': 'PTT_NM', 'patient.gender.code': 'GDR_CD', 'patient.gender.display': 'GDR_NM', 'patient.birthDate': 'BTH_DT' }
const audit = { 'record.created': 'CRT_TM', 'record.updated': 'UPD_DT', 'actor.recorder.code': 'CRT_STFF_CD', 'actor.recorder.name': 'CRT_STFF_NM', 'actor.updater.code': 'UPD_STFF_CD', 'actor.updater.name': 'UPD_STFF_NM' }
const enc = { 'encounter.outpatientNo': 'OTPT_EMG_NO', 'encounter.inpatientNo': 'INHOS_NO' }
const src = { 'source.name': 'SOURCE_NM' }
const dwdOrg = { 'org.code': 'SOURCE_ORG_CD', 'org.name': 'SOURCE_ORG_NM' }
const invalid = { field: 'INVLD_FLG', values: ['1'] }

export default {
  id: 'regional-platform',
  name: '区域平台导出（p_doc_*）',
  version: '0.1.0',
  detect: { fileRe: '^p_doc_[a-z_]+\\.json$' },
  timezone: '+08:00',
  tables: [
    {
      id: 'person', match: { file: 'p_doc_dwd_psn_rcd.json' }, kind: 'patient', key: ['PRM_KEY'],
      roles: { 'patient.id': 'ID_CRD_NO', name: 'RSDNT_NM', 'gender.code': 'GDR_CD', 'gender.display': 'GDR_NM', birthDate: 'BTH_DT' },
      // 病史标志：每个标志一条 Condition（问题列表）
      items: [
        { field: 'HYPTSN_MDC_HST_FLG', when: '1', condition: { text: '高血压病史', local: 'hypertension-history' }, timeField: 'HYPTSN_MDC_HST__SOURCE' },
        { field: 'DBTZ_MDC_HST_FLG', when: '1', condition: { text: '糖尿病病史', local: 'diabetes-history' }, timeField: 'DBTZ_MDC_HST_SOURCE' },
      ],
    },
    {
      id: 'domicile', match: { file: 'p_doc_dwd_domicile.json' }, kind: 'address', key: ['PRM_KEY'], addressUse: 'home', addressKind: '户籍地址',
      roles: { 'patient.id': 'ID_CRD_NO', 'address.text': 'HRGST_ADDR', 'address.province.name': 'HRGST_ADDR_PRV_NM', 'address.city.name': 'HRGST_ADDR_CTY_NM', 'address.county.name': 'HRGST_ADDR_CNTY_NM', 'time.recorded': 'RCD_TIME', ...src },
    },
    {
      id: 'current-address', match: { file: 'p_doc_dwd_curt_addr.json' }, kind: 'address', key: ['PRM_KEY'], addressUse: 'home', addressKind: '现住址',
      roles: {
        'patient.id': 'ID_CRD_NO', 'address.text': 'CURR_ADDR',
        'address.province.code': 'CURR_ADDR_PRV_CD', 'address.province.name': 'CURR_ADDR_PRV_NM',
        'address.city.code': 'CURR_ADDR_CTY_CD', 'address.city.name': 'CURR_ADDR_CTY_NM',
        'address.county.code': 'CURR_ADDR_CNTY_CD', 'address.county.name': 'CURR_ADDR_CNTY_NM',
        'address.town.code': 'CURR_ADDR_TWN_CD', 'address.town.name': 'CURR_ADDR_TWN_NM',
        'address.village.code': 'CURR_ADDR_VLG_CD', 'address.village.name': 'CURR_ADDR_VLG_NM',
        'address.unit': 'CURR_ADDR_UNT', 'address.house': 'CURR_ADDR_HUS_NO', 'time.recorded': 'RCD_TIME', ...src,
      },
    },
    {
      id: 'visit', match: { file: 'p_doc_fact_vst_infmt.json' }, kind: 'encounter', key: ['PRM_KEY'],
      roles: {
        ...pat, ...org, ...enc, ...audit, 'patient.card': 'CRD_NO', 'patient.telecom': 'SLF_TEL_NO',
        'encounter.setting': 'VST_TP',
        'time.start': ['VST_DT_TM', 'ADMN_DT_TM', 'VST_STRT_TM', 'VST_DT'], 'time.end': 'DSCG_DT_TM',
        'dept.code': ['VST_DPT_CD', 'CURR_DPT_CD'], 'dept.name': ['VST_DPT_NM', 'ADMN_DPT_NM', 'CURR_DPT_NM'],
        'actor.attender.code': ['VST_DCT_CD', 'ATD_DCT_CD'], 'actor.attender.name': ['VST_DCT_NM', 'ATD_DCT_NM'],
        'actor.admitter.code': 'ADMN_DCT_CD', 'actor.admitter.name': 'ADMN_DCT_NM',
        'reason.text': 'ADMN_TNTTV_DIAG_DSCPT', 'location.ward': 'CURR_WRD_NM', 'location.bed': 'CURR_BED_NO',
        'dischargeDisposition.code': 'PTT_WHRABT_CD', 'dischargeDisposition.display': 'PTT_WHRABT_NM',
        'emergency.flag': 'EMG_FLG', 'firstVisit.flag': 'FST_VST_FLG',
        'maritalStatus.code': 'MRY_CDT_CD', 'maritalStatus.display': 'MRY_CDT_NM',
      },
      // VST_TP：1 门诊、2 住院、3 体检（事件还原插件已核对过）
      values: { 'encounter.setting': { 1: 'AMB', 2: 'IMP', 3: 'AMB' }, 'encounter.settingName': { 1: '门诊', 2: '住院', 3: '体检' } },
    },
    {
      id: 'diagnosis', match: { file: 'p_doc_fact_diag_infmt.json' }, kind: 'condition', key: ['PRM_KEY'], invalid,
      roles: {
        ...pat, ...org, ...enc, ...audit, 'encounter.setting': 'VST_TP',
        'code.code': 'DIAG_ICD10_CD', 'code.display': 'DIAG_ICD10_NM', 'code.local': 'DIAG_CD', text: 'DIAG_DSCPT',
        // DIAG_CGY_CD 与 DIAG_CGY_NM 的对应在不同机构间不一致；以含义明确的 NM（cbzd 等）为代码，CD 原样保留
        'time.recorded': ['DIAG_DT', 'CRT_TM'], 'category.display': 'DIAG_CGY_NM', 'main.flag': 'MAIN_DIAG_FLG',
        'tcm.flag': 'TCM_DIAG_FLG', 'tcm.code': ['TCM_SPTM_CD', 'TCM_DSES_CD'], 'tcm.display': ['TCM_SPTM_NM', 'TCM_DSES_NM'], order: 'DIAG_SRL_NO', note: 'RMRK',
        'dept.code': 'DIAG_DPT_CD', 'dept.name': 'DIAG_DPT_NM', 'actor.author.code': 'DIAG_DCT_CD', 'actor.author.name': 'DIAG_DCT_NM',
      },
      values: { 'encounter.setting': { 1: 'AMB', 2: 'IMP' }, 'category.display': { cbzd: '初步诊断', cyzd: '出院诊断', bczd: '补充诊断', xzzd: '修正诊断' } },
      codeSystems: { code: { name: 'icd-10-cn' }, local: { name: 'diagnosis-local', scope: 'org' } },
    },
    {
      id: 'lab', match: { file: 'p_doc_fact_test_rcd.json' }, kind: 'lab', key: ['PRM_KEY'], invalid,
      roles: {
        ...pat, ...org, ...audit, 'encounter.outpatientNo': ['OTPT_EMG_NO', 'TEST_OTPT_NO'], 'encounter.inpatientNo': ['INHOS_NO', 'TEST_INHOS_NO'], 'encounter.setting': 'PTT_SRC_CD',
        'report.no': ['TEST_RPT_NO', 'TEST_RCD_NO'], 'panel.code': 'TEST_ITM_CD', 'panel.display': 'TEST_ITM_NM',
        'item.code': 'TEST_CHD_ITM_CD', 'item.display': 'TEST_CHD_ITM_NM', 'item.stdCode': 'STD_TEST_CHD_ITM_CD', 'item.stdDisplay': 'STD_TEST_CHD_ITM_NM',
        value: 'TEST_RSLT_VLU', unit: 'TEST_RSLT_VLU_UNT', refRange: 'RFRC_VLU', flag: 'RSLT_FLG',
        'specimen.code': 'SPCM_CD', 'specimen.display': 'SPCM_NM',
        'time.effective': ['TEST_DT', 'CRT_TM'], 'time.issued': 'ADT_TM', 'time.ordered': 'APL_DT_TM', 'order.no': 'ELCTRNC_APL_NO', note: 'RMRK',
        'dept.code': 'DLVR_EXAM_DPT_CD', 'dept.name': 'DLVR_EXAM_DPT_NM',
        'actor.performer.name': 'TEST_DCT_NM', 'actor.verifier.name': 'ADT_DCT_NM', 'actor.requester.name': 'APL_DCT_NM', 'actor.collector.name': 'CLLT_SPCM_PSN_NM',
      },
      values: { 'encounter.setting': { 0: 'AMB', 1: 'IMP' } },
      codeSystems: { panel: { name: 'lab-panel', scope: 'org' }, item: { name: 'lab-item', scope: 'org' }, std: { name: 'lab-item-std' }, specimen: { name: 'specimen', scope: 'org' }, flag: { name: 'lab-result-flag' } },
    },
    {
      id: 'exam', match: { file: 'p_doc_fact_exam_rcd.json' }, kind: 'imaging', key: ['PRM_KEY'], invalid,
      roles: {
        ...pat, ...org, ...audit, 'encounter.outpatientNo': ['OTPT_EMG_NO', 'EXAM_OTPT_NO'], 'encounter.inpatientNo': ['INHOS_NO', 'EXAM_INHOS_NO'], 'encounter.setting': 'PTT_SRC_CD',
        'report.no': 'EXAM_RCD_NO', 'item.display': 'EXAM_ITM_NM', 'item.stdCode': 'STD_EXAM_ITM_CD', 'item.stdDisplay': 'STD_EXAM_ITM_NM', modality: 'EXAM_ITM_TP_NM',
        findings: 'EXAM_RPT_RSLT_OBJCT', conclusion: 'EXAM_RPT_RSLT_SBJCT', 'bodySite.text': 'EXAM_PRT_NM', 'reason.text': 'DIAG_DSCPT',
        'time.effective': 'EXAM_DT', 'time.issued': ['EXAM_RPT_DT', 'EXAM_ADT_DT_TM'], 'time.ordered': 'APL_DT_TM', 'order.no': 'ELCTRNC_APL_NO', status: 'EXAM_STTS_CD',
        'dept.code': 'APL_DPT_CD', 'dept.name': 'APL_DPT_NM',
        'actor.requester.code': 'APL_DCT_CD', 'actor.requester.name': 'APL_DCT_NM', 'actor.performer.code': 'EXAM_DCT_CD', 'actor.performer.name': 'EXAM_DCT_NM',
        'actor.author.code': 'RPT_DCT_CD', 'actor.author.name': 'RPT_DCT_NM', 'actor.verifier.code': 'ADT_DCT_CD', 'actor.verifier.name': ['ADT_DCT_SGNT'],
      },
      values: { 'encounter.setting': { 1: 'AMB', 2: 'IMP' } },
      codeSystems: { std: { name: 'exam-item-std' }, modality: { name: 'exam-modality' } },
    },
    {
      id: 'surgery', match: { file: 'p_doc_fact_oprt_rcd.json' }, kind: 'procedure', key: ['PRM_KEY'], invalid,
      roles: {
        ...pat, ...org, ...enc, ...audit,
        'code.code': 'OPRT_CD', 'code.display': 'OPRT_NM', 'time.start': 'OPRT_STRT_DT_TM', 'time.end': 'OPRT_END_DT_TM', 'time.performed': 'OPRT_DT_TM',
        'reason.code': 'POPRT_DIAG_CD', 'reason.text': 'POPRT_DIAG_NM', 'outcome.text': 'OPRT_AFTR_DIAG_NM', 'bodySite.text': 'OPRT_PRT_NM', note: 'OPRT_PRCS_DSCPT',
        'level.code': 'OPRT_LVL_CD', 'level.display': 'OPRT_LVL_NM', 'incision.code': 'OPRT_INCS_CGY_CD', 'incision.display': 'OPRT_INCS_CGY_NM',
        'anesthesia.code': 'ATHS_WAY_CD', 'anesthesia.display': 'ATHS_WAY_NM', 'order.no': 'ELCTRNC_APL_NO',
        'dept.code': 'OPRT_DPT_CD', 'dept.name': 'OPRT_DPT_NM',
        'actor.surgeon.code': 'OPRT_DCT_CD', 'actor.surgeon.name': 'OPRT_DCT_NM', 'actor.anesthetist.code': 'ATHS_DCT_CD', 'actor.anesthetist.name': 'ATHS_DCT_NM',
      },
      codeSystems: { code: { name: 'procedure-code', scope: 'org' }, reason: { name: 'icd-10-cn' } },
    },
    {
      id: 'outpatient-record', match: { file: 'p_doc_fact_otpt_emg_mdc_htr_rcd.json' }, kind: 'document', key: ['PRM_KEY'], invalid,
      document: { code: 'outpatient-record', display: '门（急）诊病历', loinc: '34108-1', loincDisplay: 'Outpatient Note' },
      roles: { ...pat, ...org, ...enc, ...audit, 'time.authored': ['RCD_DT_TM', 'CRT_TM'] },
      sections: [
        ['CHF_COMPLNT', '主诉'], ['PRST_ILLNS_HST', '现病史'], ['PAST_HST', '既往史'], ['OPRT_HST', '手术史'], ['TRSFS_BLD_HST', '输血史'], ['INFCT_HST', '传染病史'],
        ['ALGN_HST', '过敏史'], ['PSN_HST', '个人史'], ['MRTL_HST', '婚育史'], ['MST_HST', '月经史'], ['FML_HST_FLG', '家族史'],
        ['PSQ_EXAM', '体格检查'], ['AXLR_EXAM', '辅助检查'], ['EMG_RSC_RCD', '诊断'], ['HDL_SGST', '处理意见'], ['ATNT_ITM', '注意事项'],
      ],
      // 门诊病历里的结构化体征另出 Observation
      items: [
        { field: 'PSQ_EXAM_STLC_PRS', measure: 'systolic' }, { field: 'PSQ_EXAM_DTLC_PRS', measure: 'diastolic' },
        { field: 'PSQ_EXAM_HGT', measure: 'height' }, { field: 'PSQ_EXAM_WGT', measure: 'weight' },
        { field: 'PSQ_EXAM_TPR', measure: 'temperature' }, { field: 'PSQ_EXAM_PLS_RATE', measure: 'pulse' },
      ],
    },
    {
      id: 'admission-record', match: { file: 'p_doc_fact_admn_mdc_htr_rcd.json' }, kind: 'document', key: ['PRM_KEY'], invalid,
      document: { code: 'admission-record', display: '入院记录', loinc: '34117-2', loincDisplay: 'History and physical note' },
      roles: { ...pat, ...org, ...enc, ...audit, 'time.authored': ['RCD_DT_TM', 'CRT_TM'] },
      sections: [['CHF_COMPLNT', '主诉'], ['PST_ILLNS_HST', '正文']],
    },
    {
      id: 'discharge-record', match: { file: 'p_doc_fact_dscg_rcd.json' }, kind: 'document', key: ['PRM_KEY'], invalid,
      document: { code: 'discharge-record', display: '出院记录', loinc: '18842-5', loincDisplay: 'Discharge summary' },
      roles: { ...pat, ...org, ...enc, ...audit, 'time.authored': ['CRT_TM'] },
      sections: [['ADMN_CDT', '入院情况'], ['DSCG_CDT', '出院情况']],
    },
    {
      id: 'outpatient-fee', match: { file: 'p_doc_fact_otpt_fee_dtl.json' }, kind: 'charge', key: ['PRM_KEY'], invalid,
      roles: {
        ...pat, ...org, ...enc, ...audit,
        'item.code': 'CHRG_ITM_CD', 'item.display': 'CHRG_ITM_NM', quantity: 'ITM_QTY', unit: 'ITM_UNT', unitPrice: 'ITM_UNT_PRICE', total: 'ITM_FEE',
        'category.code': ['FEE_CGY_CD_STD', 'FEE_CGY_CD'], 'category.display': ['FEE_CGY_NM_STD', 'FEE_CGY_NM'], 'time.occurrence': 'CHRG_DT', 'refund.flag': 'CHRG_RTRN_FLG',
        'dept.code': 'OPN_DPT_CD', 'dept.name': 'OPN_DPT_NM',
      },
      codeSystems: { item: { name: 'charge-item', scope: 'org' }, category: { name: 'fee-category' } },
    },
    {
      id: 'death-certificate', match: { file: 'p_doc_pblc_dth_mdc_ctf.json' }, kind: 'death', key: ['PRM_KEY'],
      roles: {
        'patient.id': 'ID_CRD_NO', 'patient.name': 'SLF_NM', 'patient.gender.code': 'GDR_CD', 'patient.gender.display': 'GDR_NM', 'patient.birthDate': 'BTH_DT', ...org,
        'record.created': 'CRT_TM', 'record.updated': 'UPD_DT',
        'time.death': 'DTH_DT_TM', 'cause.code': ['FNDMTL_DTH_CAS_CD', 'DTH_MAX_DIAG_GST_CGY_CD'], 'cause.display': ['FNDMTL_DTH_CAS_NM', 'DTH_MAX_DIAG_GST_CGY_NM'],
        'cause.text': 'DTH_MLTPL_CAS_SQNC', 'place.display': 'DTH_LCT_CGY_NM',
      },
      codeSystems: { cause: { name: 'icd-10-cn' } },
    },
    // ---- 测量与问卷：每个字段一条 Observation ----
    obs('height', 'p_doc_dwd_height.json', [{ field: 'HEIGHT', measure: 'height' }]),
    obs('weight', 'p_doc_dwd_weight.json', [{ field: 'WEIGHT', measure: 'weight' }]),
    obs('bmi', 'p_doc_dwd_bmi.json', [{ field: 'BMI', measure: 'bmi' }]),
    obs('waist', 'p_doc_dwd_waist.json', [{ field: 'WAIST', measure: 'waist' }]),
    obs('blood-type', 'p_doc_dwd_blood.json', [
      { coded: { code: 'ABO_CD', display: 'ABO_NM' }, loinc: '883-9', loincDisplay: 'ABO group [Type] in Blood', local: 'abo', text: 'ABO血型', category: 'laboratory', unknownWhen: ['不详'] },
      { coded: { code: 'RH_CD', display: 'RH_NM' }, loinc: '10331-7', loincDisplay: 'Rh [Type] in Blood', local: 'rh', text: 'Rh血型', category: 'laboratory', unknownWhen: ['不详'] },
    ]),
    obs('smoking', 'p_doc_dwd_smock.json', [
      { coded: { code: 'SMK_STTS_CD', display: 'SMK_STTS_NM' }, loinc: '72166-2', loincDisplay: 'Tobacco smoking status', local: 'smoking-status', text: '吸烟状况', category: 'social-history' },
      { field: 'SMK_QTY', local: 'cigarettes-per-day', text: '日吸烟量', unit: '支/天', category: 'social-history' },
      { field: 'STRT_SMK_AGE', local: 'smoking-start-age', text: '开始吸烟年龄', unit: '岁', category: 'social-history' },
      { field: 'QUIT_SMK_AGE', local: 'smoking-quit-age', text: '戒烟年龄', unit: '岁', category: 'social-history' },
      { field: 'SMK_FLG', local: 'smoking-flag', text: '吸烟标志', category: 'social-history', asString: true },
    ]),
    obs('drinking', 'p_doc_dwd_drink.json', [
      { coded: { code: 'DRNK_STTS_CD', display: 'DRNK_STTS_NM' }, loinc: '11331-6', loincDisplay: 'History of Alcohol use', local: 'drinking-status', text: '饮酒状况', category: 'social-history' },
      { coded: { code: 'DRNK_FRQ_CD', display: 'DRNK_FRQ_NM' }, local: 'drinking-frequency', text: '饮酒频率', category: 'social-history' },
      { field: 'DRNK_QTY', local: 'drinking-amount', text: '日饮酒量', unit: '两/天', category: 'social-history' },
      { coded: { code: 'DRNK_TP_CD', display: 'DRNK_TP_NM' }, local: 'drinking-type', text: '饮酒种类', category: 'social-history' },
      { field: 'STRT_DRNK_AGE', local: 'drinking-start-age', text: '开始饮酒年龄', unit: '岁', category: 'social-history' },
      { field: 'ABSTNC_AGE', local: 'drinking-quit-age', text: '戒酒年龄', unit: '岁', category: 'social-history' },
      { field: 'DRNK_FLG', local: 'drinking-flag', text: '饮酒标志', category: 'social-history', asString: true },
    ]),
    obs('exercise', 'p_doc_dwd_sport.json', [
      { coded: { code: 'EXRC_FRQ_CD', display: 'EXRC_FRQ_NM' }, local: 'exercise-frequency', text: '锻炼频率', category: 'social-history' },
      { field: 'EXRC_DRT', local: 'exercise-duration', text: '每次锻炼时间', unit: 'min', category: 'social-history' },
      { field: 'INSST_EXRC_DRT_YEAR', local: 'exercise-years', text: '坚持锻炼时间', unit: '年', category: 'social-history' },
      { coded: { code: 'EXRC_WAY_CD', display: 'EXRC_WAY_NM' }, local: 'exercise-type', text: '锻炼方式', category: 'social-history' },
      { field: 'EXRC_FLG', local: 'exercise-flag', text: '锻炼标志', category: 'social-history', asString: true },
    ]),
    obs('occupation', 'p_doc_dwd_occp.json', [
      { coded: { code: 'STD_WRK_PFS_CD', display: 'STD_WRK_PFS_NM' }, loinc: '11341-5', loincDisplay: 'History of Occupation', local: 'occupation', text: '职业', category: 'social-history' },
    ]),
    obs('symptom', 'p_doc_dwd_smp.json', [
      { coded: { code: 'SMP_CD', display: 'SMP_NM' }, local: 'symptom', text: '症状', category: 'exam' },
    ]),
  ],
}

function obs(id, file, items) {
  return {
    id, match: { file }, kind: 'observation', key: ['PRM_KEY'], items,
    roles: { 'patient.id': 'ID_CRD_NO', ...dwdOrg, 'time.effective': 'RCD_TIME', ...src },
  }
}
