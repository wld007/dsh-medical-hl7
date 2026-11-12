# 按人存储（bundles/）字段说明

适用版本：dsh-medical-hl7 0.4.x，FHIR R4（4.0.1）。处理流程（Schema 同构 → 值域归一 → 术语对照 → FHIR 组装）见 [pipeline.md](pipeline.md)。
「来源字段」一栏以内置规格 `regional-platform`（区域平台 `p_doc_*.json`）为准。换成其他数据源时，来源字段名会变，但资源结构和各元素的含义不变。

文中 `{ns}` 指设置里的命名空间，默认是 `http://dsh.local/fhir`。

---

## 1. 文件

`bundles/<病人>.json`：每位病人一个文件，是一个 FHIR **transaction Bundle**。

| 元素 | 含义 |
|---|---|
| `resourceType` | 固定为 `Bundle` |
| `id` | 等于这位病人 Patient 的 id |
| `type` | 固定为 `transaction`，可以整份 POST 到 FHIR 服务器的根地址 |
| `timestamp`、`meta.lastUpdated` | 生成时间 |
| `entry[]` | 每条一个资源，排列顺序：机构 → 医务人员 → 病人 → 就诊 → 标本 → 诊断 → 观察 → 报告 → 手术 → 医嘱 → 文书 → 费用 → 通用 |
| `entry[].fullUrl` | `{ns}/<资源类型>/<id>` |
| `entry[].resource` | 资源本身，见第 3 节 |
| `entry[].request` | `{ "method": "PUT", "url": "<资源类型>/<id>" }`。用 PUT 意味着重复导入时覆盖原资源，不会产生重复数据 |

病人文件里包含他用到的机构（Organization）和医务人员（Practitioner）。同一家医院、同一位医生在不同病人的文件里 id 相同，导入服务器后会合并成一条。

---

## 2. 通用约定

### 2.1 编号与追溯

| 元素 | 含义 |
|---|---|
| `id` | 32 位十六进制，由"资源类型 + 来源表 + 源记录主键（`PRM_KEY`）"计算得出。**同一条源记录每次转换得到的 id 都相同** |
| `meta.source` | 来源文件：`{ns}/source#<相对路径>`，例如 `…#病人A%2F检验%2F检验记录%2F202104%2Fp_doc_fact_test_rcd.json` |
| `identifier`（记录标识） | `system = {ns}/id/record/<规格>/<表>`，`value = 源记录主键`。凭它可以回查到源记录 |
| `subject` | 一律指向本文件里的 Patient：`{ "reference": "Patient/<id>" }` |
| 引用 | 一律写成 `"<资源类型>/<id>"`，被引用的资源都在同一个文件里 |

### 2.2 取值

- **时间**：只转换格式，不改值。源数据里的毫秒时间戳、`YYYYMMDD`、`YYYY-MM-DD HH:mm:ss` 等，统一转成 FHIR 的 `dateTime`，例如 `2021-04-25T15:11:18+08:00`。源数据没写时区的，按设置里的时区补上（默认 `+08:00`）。`issued` 要求精确到秒；只有日期的值不会写进 `issued`。
- **文本**：只去掉首尾空白。
- **姓名、证件号、医院、医生、电话、地址等**：都是匿名化插件生成的假名（如 `证件-EC5158`、`医生-55CC0B`），原样保留。
- **作废记录**（源数据 `INVLD_FLG = 1`）：照常输出，但状态标为 `entered-in-error`（Condition 在 `verificationStatus` 里标）。

### 2.3 代码

**一个 CodeableConcept 里 coding 的顺序**（凡是经过值域归一或术语对照的元素都如此）：

1. 规范值（值域归一已确认时才有）：标准体系（如 v3-MaritalStatus、v3-ActCode、DICOM、UCUM）或规范值体系 `{ns}/CodeSystem/canonical/<值域>`；
2. 原代码：本地代码体系，代码和名称都是源数据原值；
3. 标准术语编码（术语对照已确认时才有）：LOINC、SNOMED CT 等。

`text`：已归一时是规范值的中文名称，否则是源数据原文（检验定性结果的 `text` 始终是原文）。值域归一状态不是“已归一”的（待确认、无对照、不属于本值域）一律只有原代码，不猜。

- **标准代码**：只在含义确定时才加，包括：体征和部分观察项的 LOINC、单位的 UCUM、性别、婚姻状况、就诊类别（v3 ActCode）、各类分类代码。
- **本地代码**：一律原样放进本地代码体系，`system = {ns}/CodeSystem/<规格>/<名称>`。
  - 机构自编的代码（检验项目、收费项目、标本、科室等）在后面再加 `/org-<10位>`，用来区分不同医院；`org-` 后面是该医院 Organization id 的哈希。
  - 每个本地代码体系的完整代码表在交付目录 `definitions/CodeSystem-*.json` 里。
- 含义不明的代码（如检验结果标志 `RSLT_FLG`）**不换算**成 FHIR 标准值，原样放在扩展里。
- FHIR 不允许代码里有换行或连续空格。这样的源代码不放进 `coding`，原值放在扩展 `code-as-recorded` 里，`text` 仍保留原文。

### 2.4 扩展

扩展的 `url` 都是 `{ns}/StructureDefinition/<名称>`，定义文件在 `definitions/StructureDefinition-*.json`。常见的几个：

| 扩展 | 值类型 | 含义 |
|---|---|---|
| `source-field` | 子扩展 `name` + `value`（string） | **没有对应 FHIR 元素的源字段，原样保留**。`name` 是源字段名，`value` 是原值 |
| `record-created` / `record-updated` | dateTime | 源记录的创建时间（`CRT_TM`）、更新时间（`UPD_DT`） |
| `actor-recorder` / `actor-updater` | Reference(Practitioner) | 源记录的创建人（`CRT_STFF_*`）、更新人（`UPD_STFF_*`） |
| `department` | Reference(Organization) | 科室 |
| `organization` | Reference(Organization) | 医疗机构（只在资源本身没有放机构的元素时使用） |

第 4 节列出全部扩展。

---

## 3. 各类资源

### 3.1 Patient（病人）

每个文件一条。人口信息、就诊、检验等多张表里关于病人的信息，最后都汇总到这里。

| 元素 | 含义 | 来源字段 | 说明 |
|---|---|---|---|
| `identifier[0]` | 主标识，`use = official`，`system = {ns}/id/id-card` | `ID_CRD_NO` | 证件号假名，也是病人分组的依据 |
| `identifier[]` | 机构内病人号，`use = secondary`，`system = {ns}/id/patient-local-id`，`assigner` 指向机构 | `PID` | 同一个人在不同医院可能有多个 |
| `identifier[]` | 就诊卡号，`system = {ns}/id/patient-card` | `CRD_NO` | |
| `name[].text` | 姓名（假名） | `RSDNT_NM`、`PTT_NM`、`SLF_NM` | 出现最多的那个标 `official`，其余标 `old` |
| `gender` | `male` / `female` / `other` / `unknown` | `GDR_CD` + `GDR_NM` | 以人口信息表为准；没有人口信息表时取出现最多的值。不一致时会在报告里提示 |
| `birthDate` | 出生日期 | `BTH_DT` | 同上 |
| `telecom[]` | 电话，`system = phone` | `SLF_TEL_NO` | 假名 |
| `address[]` | 地址 | 户籍地址表、现住址表 | 同一地址只保留一条 |
| `address[].text` | 完整地址 | `HRGST_ADDR`、`CURR_ADDR` | |
| `address[].state` / `city` / `district` | 省 / 市 / 区县 | `*_PRV_*`、`*_CTY_*`、`*_CNTY_*` | 有名称用名称，没有名称用代码 |
| `address[].line[]` | 乡镇、村、单元、门牌 | `*_TWN_NM`、`*_VLG_NM`、`CURR_ADDR_UNT`、`CURR_ADDR_HUS_NO` | |
| `address[].period.start` | 这条地址的记录时间 | `RCD_TIME` | |
| `address[].extension` | `address-kind`（户籍地址/现住址）、`admin-division-code`（最细一级的行政区划代码）、`source-system`（`SOURCE_NM`） | | |
| `maritalStatus` | 婚姻状况 | 就诊表 `MRY_CDT_CD` / `MRY_CDT_NM` | 取最近一次**已归一**的登记（都没归一时取最近一次原值）。值域 `marital`：已确认的加 v3 MaritalStatus 编码（“未知”用 v3-NullFlavor `UNK`） |
| `deceasedDateTime` | 死亡时间 | 死亡报卡 `DTH_DT_TM` | |
| `extension` | 人口信息表里没有对应元素的字段（`source-field`），以及记录时间 | | |

### 3.2 Encounter（就诊）

来源：就诊表 `p_doc_fact_vst_infmt`。同一个门诊号或住院号只生成一条 Encounter，多条登记会合并。

| 元素 | 含义 | 来源字段 | 说明 |
|---|---|---|---|
| `identifier[]` | 门诊号 `{ns}/id/outpatient-no` 或住院号 `{ns}/id/inpatient-no`，`assigner` 指向机构 | `OTPT_EMG_NO` / `INHOS_NO` | 住院就诊取住院号 |
| `identifier[]` | 记录标识（见 2.1） | `PRM_KEY` | 合并了几条登记就有几个 |
| `status` | `finished`；作废记录为 `entered-in-error`；登记缺失的就诊（见下）为 `unknown` | | |
| `class` | v3 ActCode：`AMB` 门诊、`IMP` 住院 | `VST_TP` | 值域 `regional-platform/visit-type`：1 门诊 → AMB，2 住院 → IMP，3 体检 → AMB；未归一时默认 AMB |
| `type[]` | 就诊类型原值，本地代码体系 `encounter-setting` | `VST_TP` | 显示为来源原意（门诊 / 住院 / 体检） |
| `participant[]` | 接诊医生 `ATND`、收治医生 `ADM`（v3 ParticipationType） | `VST_DCT_*`、`ATD_DCT_*`、`ADMN_DCT_*` | |
| `period.start` | 开始时间 | `VST_DT_TM` → `ADMN_DT_TM` → `VST_STRT_TM` → `VST_DT`，取第一个有值的 | |
| `period.end` | 结束（出院）时间 | `DSCG_DT_TM` | 如果早于开始时间，不写在这里，原值放进扩展 `period-end-as-recorded` |
| `reasonCode[].text` | 入院诊断原文 | `ADMN_TNTTV_DIAG_DSCPT` | |
| `hospitalization.dischargeDisposition` | 离院方式（原代码 + 名称；值域 `regional-platform/discharge-disposition`） | `PTT_WHRABT_CD` / `PTT_WHRABT_NM` | |
| `location[].location.display` | 病区、床号 | `CURR_WRD_NM`、`CURR_BED_NO` | |
| `serviceProvider` | 科室（没有科室时为机构） | `VST_DPT_*` / `ADMN_DPT_NM` 等；`MDC_ORG_*` | |
| `diagnosis[].condition` | 这次就诊的诊断 | | 由诊断表回挂，不含作废的诊断。源数据没有写明诊断用途和排序，所以没有 `use` / `rank` |
| `extension` | `flag-emergency`（`EMG_FLG`）、`flag-first-visit`（`FST_VST_FLG`）：值域 `yes-no` 已归一时为 `valueBoolean`，否则 `valueString` 原值；`marital-status-at-visit`、记录时间、`source-field` | | 同一就诊号的后续登记里与首条不同的字段（含角色字段）原样挂 `source-field` |

**登记缺失的就诊**：检验、诊断等记录写了门诊号或住院号，但就诊表里找不到这次就诊时，会按号码生成一条 Encounter，并加上标记：

- `meta.tag[].code = encounter-not-registered`
- `status = unknown`
- `class` 按号码类型定（门诊号 → AMB，住院号 → IMP）
- **不填时间**

这样同一次就诊的记录仍能归到一起。

### 3.3 Condition（诊断）

来源：诊断表 `p_doc_fact_diag_infmt`，每条记录一条。

| 元素 | 含义 | 来源字段 | 说明 |
|---|---|---|---|
| `identifier[]` | 记录标识 | `PRM_KEY` | |
| `verificationStatus` | 作废记录才有，值为 `entered-in-error` | `INVLD_FLG` | |
| `category[]` | 固定为 `encounter-diagnosis` | | |
| `code.coding[]` | ① ICD-10（国家临床版，含扩展码），代码体系 `icd-10-cn` | `DIAG_ICD10_CD` / `DIAG_ICD10_NM` | 经“ICD-10 代码”值域清洗：剑号星号组合（`N18.900x012+D63.8*`）只放剑号码，星号码放扩展 `icd-asterisk-code`；中医代码归 `tcm-disease` / `tcm-syndrome`；无法识别的（如 `1\|G47.900,`）不进 coding，原值放 `code-as-recorded` |
| | ② 机构内诊断代码，代码体系 `diagnosis-local/org-…` | `DIAG_CD` | |
| | ③ 中医证候（仅中医诊断），代码体系 `tcm-diagnosis/org-…` | `TCM_SPTM_*` / `TCM_DSES_*` | 条件是 `TCM_DIAG_FLG = 1` |
| `code.text` | 诊断描述原文 | `DIAG_DSCPT` | |
| `encounter` | 所属就诊 | `OTPT_EMG_NO` / `INHOS_NO` | |
| `recordedDate` | 诊断时间 | `DIAG_DT`，没有时取 `CRT_TM` | |
| `asserter` | 诊断医生 | `DIAG_DCT_*` | |
| `recorder` | 记录人 | `CRT_STFF_*` | |
| `note[].text` | 备注 | `RMRK` | |
| `extension` | `diagnosis-category`（值域 `regional-platform/diagnosis-category`：ryzd 入院、cbzd 初步、cyzd 出院、bczd 补充、xzzd 修正；规范值 + 原代码）、`flag-main-diagnosis`（`MAIN_DIAG_FLG`：1/0 → boolean，N 待确认 → 原值）、`flag-tcm`（boolean）、`diagnosis-sequence`（`DIAG_SRL_NO`）、`organization`、`department`、`source-field` 等 | | 诊断类别以 `DIAG_CGY_NM` 为准，`DIAG_CGY_CD` 在不同机构间对应不一致，原样保留 |

另有一类 Condition 来自人口信息表的病史标志（`HYPTSN_MDC_HST_FLG`、`DBTZ_MDC_HST_FLG`）：`category` 为 `problem-list-item`，`code` 为本地代码 `history-flag`（高血压病史 / 糖尿病病史），`recordedDate` 取标志附带的记录时间。

### 3.4 Observation（观察：检验、体征、生活方式等）

#### a) 检验结果

来源：检验表 `p_doc_fact_test_rcd`，每个检验子项一条。

| 元素 | 含义 | 来源字段 | 说明 |
|---|---|---|---|
| `identifier[]` | 记录标识 | `PRM_KEY` | |
| `status` | `final`；作废记录为 `entered-in-error` | | |
| `category[]` | `laboratory` | | |
| `code.coding[]` | ① 机构内检验子项代码，代码体系 `lab-item/org-…` | `TEST_CHD_ITM_CD` / `TEST_CHD_ITM_NM` | 术语对照 `lab-item` 已确认时另加 LOINC |
| | ② 平台标准项目代码，代码体系 `lab-item-std` | `STD_TEST_CHD_ITM_CD` / `STD_TEST_CHD_ITM_NM` | |
| `code.text` | 项目名称 | `TEST_CHD_ITM_NM` | |
| `encounter` | 所属就诊 | `INHOS_NO` / `OTPT_EMG_NO`；`PTT_SRC_CD`（0 门诊、1 住院） | |
| `effectiveDateTime` | 检验时间 | `TEST_DT`，没有时取 `CRT_TM` | |
| `issued` | 审核时间 | `ADT_TM` | |
| `performer[]` | 检验机构、检验者 | `MDC_ORG_*`、`TEST_DCT_NM` | |
| `valueQuantity` | 数值结果：`value`、`comparator`（`<` `>` `<=` `>=`，全角写法已统一）、`unit` | `TEST_RSLT_VLU`、`TEST_RSLT_VLU_UNT` | 单位经值域 `ucum-unit` 归一后另加 UCUM 的 `system` / `code`，`unit` 保留原文 |
| `valueCodeableConcept` | 定性结果（阴性、阳性、弱阳性、1+…）：规范值（`canonical/qualitative-result`）+ 已确认的 SNOMED CT；`text` 是原文 | `TEST_RSLT_VLU` | 值域 `qualitative-result` 已归一时 |
| `valueString` | 其他非数值结果（颜色、性状、待确认的写法） | `TEST_RSLT_VLU` | 这时单位放在扩展 `unit-as-recorded` |
| `interpretation` | 结果解释（v3 ObservationInterpretation L / N / H / LL / HH） | `RSLT_FLG` / `RSLT_DCD_CD` | **只有值域复核确认后才有**；内置对照里两者都是“待确认” |
| `dataAbsentReason` | 结果为空时为 `unknown` | | |
| `referenceRange[]` | 参考范围：`text` 是原文；能解析的另填 `low` / `high` | `RFRC_VLU` | |
| `specimen` | 标本 | `SPCM_*` | 见 3.6 |
| `extension` | `result-flag`（`RSLT_FLG` 原值）、`result-decision`（`RSLT_DCD_CD` 原值）、`actor-verifier`（`ADT_DCT_NM`）、`actor-requester`（`APL_DCT_NM`）、`actor-collector`（`CLLT_SPCM_PSN_NM`）、`department`（送检科室）、`source-field`（如 `AGE`、`RSLT_DCD_CD`） | | |

#### b) 体征与测量

来源：身高、体重、BMI、腰围表，以及门诊病历里的结构化体征。

| 项目 | `code` | 单位（UCUM） | 来源字段 |
|---|---|---|---|
| 身高 | LOINC 8302-2 | cm | `HEIGHT`、`PSQ_EXAM_HGT` |
| 体重 | LOINC 29463-7 | kg | `WEIGHT`、`PSQ_EXAM_WGT` |
| BMI | LOINC 39156-5 | kg/m2 | `BMI` |
| 腰围 | LOINC 8280-0 | cm | `WAIST` |
| 体温 | LOINC 8310-5 | Cel | `PSQ_EXAM_TPR` |
| 脉率 | LOINC 8867-4 | /min | `PSQ_EXAM_PLS_RATE` |
| 血压 | LOINC 85354-9（面板） | — | `component[]`：收缩压 8480-6 ← `PSQ_EXAM_STLC_PRS`，舒张压 8462-4 ← `PSQ_EXAM_DTLC_PRS`，单位 mm[Hg] |

- `category` 为 `vital-signs`。
- `code` 里还有一条本地代码（`observation` 体系），`text` 是中文名称。
- `effectiveDateTime`：测量表取 `RCD_TIME`，门诊病历取病历的记录时间。
- `performer`：来源机构（`SOURCE_ORG_*`）。
- 门诊病历里的体征带 `derivedFrom`，指向对应的 DocumentReference。
- 扩展 `source-system` 记录来源系统（`SOURCE_NM`，如"公卫体检"）。

#### c) 生活方式、职业、症状、血型

| 来源表 | 项目（`code.text`） | LOINC | 值 |
|---|---|---|---|
| 吸烟 | 吸烟状况、日吸烟量、开始吸烟年龄、戒烟年龄、吸烟标志 | 吸烟状况 72166-2 | 状况为 `valueCodeableConcept`（规范值 + 原代码）；数量为 `valueQuantity`；标志经 `yes-no` 归一为 `valueBoolean` |
| 饮酒 | 饮酒状况、饮酒频率、日饮酒量、饮酒种类、开始饮酒年龄、戒酒年龄、饮酒标志 | 饮酒状况 11331-6 | 同上 |
| 运动 | 锻炼频率、每次锻炼时间、坚持锻炼时间、锻炼方式、锻炼标志 | — | 同上 |
| 职业 | 职业 | 11341-5 | `valueCodeableConcept`（`STD_WRK_PFS_*`；术语对照 `occupation` 已确认时另加 GB/T 6565） |
| 症状 | 症状 | — | `valueCodeableConcept`（`SMP_*`；术语对照 `symptom` 已确认时另加 SNOMED CT） |
| 血型 | ABO血型、Rh血型 | 883-9、10331-7 | `valueCodeableConcept`（`ABO_*`、`RH_*`） |

- 吸烟、饮酒、运动、职业的 `category` 为 `social-history`，症状为 `exam`，血型为 `laboratory`。
- 每行源记录的其余字段（`SOURCE_TB`、`SOURCE_PRM` 等）挂在这一行生成的第一条 Observation 上。

#### d) 根本死因

来源：死亡报卡。

| 元素 | 内容 | 来源字段 |
|---|---|---|
| `code` | 本地代码 `cause-of-death`（根本死因） | |
| `valueCodeableConcept` | ICD-10 | `FNDMTL_DTH_CAS_CD/NM` |
| `effectiveDateTime` | 死亡时间 | `DTH_DT_TM` |
| `note` | 死因链原文 | `DTH_MLTPL_CAS_SQNC` |
| 扩展 `death-place` | 死亡地点 | `DTH_LCT_CGY_NM` |

### 3.5 DiagnosticReport（报告）

#### a) 检验报告

同一份报告的检验结果归到一起：同一机构内，`TEST_RPT_NO`（没有时用 `TEST_RCD_NO`）相同的归为一份。

| 元素 | 含义 | 来源字段 |
|---|---|---|
| `identifier[]` | 报告号 `{ns}/id/lab-report-no`；电子申请单号 `{ns}/id/order-no`（`type` 为 v2-0203 `PLAC`） | `TEST_RPT_NO`；`ELCTRNC_APL_NO` |
| `status` | `final`；所有结果都作废时为 `entered-in-error` | |
| `category[]` | v2-0074 `LAB` | |
| `code` | 检验组合项目，代码体系 `lab-panel/org-…` | `TEST_ITM_CD` / `TEST_ITM_NM` |
| `effectiveDateTime` / `issued` | 各结果中最早的检验时间 / 最晚的审核时间 | |
| `performer` / `resultsInterpreter` | 检验机构 / 审核医生 | |
| `specimen[]` / `result[]` | 标本 / 各项检验结果（Observation） | |
| 扩展 `time-ordered` | 申请时间 | `APL_DT_TM` |

#### b) 检查报告（影像、超声、内镜等）

来源：检查表 `p_doc_fact_exam_rcd`，每条记录一条。

| 元素 | 含义 | 来源字段 |
|---|---|---|
| `identifier[]` | 记录标识、检查记录号 `{ns}/id/exam-report-no`、电子申请单号 | `PRM_KEY`、`EXAM_RCD_NO`、`ELCTRNC_APL_NO` |
| `category[]` | 检查类型，代码体系 `exam-modality`；是 DICOM 标准代码（CT、MR、US、CR…）的另加 DICOM 编码 | `EXAM_ITM_TP_NM` |
| `code` | 检查项目，`text` 为项目名称；有平台标准代码的加 `exam-item-std` | `EXAM_ITM_NM`；`STD_EXAM_ITM_CD/NM` |
| `effectiveDateTime` | 检查时间 | `EXAM_DT` |
| `issued` | 报告时间 | `EXAM_RPT_DT` / `EXAM_ADT_DT_TM` |
| `performer` / `resultsInterpreter` | 机构、检查医生、报告医生 / 审核医生 | `EXAM_DCT_*`、`RPT_DCT_*`、`ADT_DCT_*` |
| `conclusion` | 检查结论（印象）原文 | `EXAM_RPT_RSLT_SBJCT` |
| `presentedForm[]` | 报告全文：`text/plain; charset=utf-8`，`data` 是 base64 编码，解码后为"检查项目 / 部位 / 所见 / 结论"四段 | `EXAM_ITM_NM`、`EXAM_PRT_NM`、`EXAM_RPT_RSLT_OBJCT`、`EXAM_RPT_RSLT_SBJCT` |
| 扩展 | `reason-text`（临床诊断，`DIAG_DSCPT`）、`status-as-recorded`（`EXAM_STTS_CD`）、`time-ordered`、`actor-requester`、`department` | |

### 3.6 Specimen（标本）

检验时生成，同一份报告里同一种标本只有一条。

| 元素 | 含义 | 来源字段 |
|---|---|---|
| `type` | 标本类型，代码体系 `specimen/org-…`，`text` 为名称；术语对照 `specimen`（按名称）已确认时另加 SNOMED CT | `SPCM_CD` / `SPCM_NM` |
| `subject` | 病人 | |

注意：标本代码在同一机构内存在一码多名，报告的"一码多名"一节有列出。

### 3.7 Procedure（手术操作）

来源：手术记录表 `p_doc_fact_oprt_rcd`。

| 元素 | 含义 | 来源字段 | 说明 |
|---|---|---|---|
| `identifier[]` | 记录标识、电子申请单号 | `PRM_KEY`、`ELCTRNC_APL_NO` | |
| `status` | `completed`；作废记录为 `entered-in-error` | | |
| `code` | 手术代码。形如 `39.5000x032` 的归入 ICD-9-CM-3 国家临床版（`icd-9-cm-3-cn`），其他归入机构内代码（`procedure-code/org-…`） | `OPRT_CD` / `OPRT_NM` | |
| `encounter` | 所属住院 | `INHOS_NO` | |
| `performedPeriod` | 手术开始、结束时间 | `OPRT_STRT_DT_TM`、`OPRT_END_DT_TM` | 没有开始时间时，改用 `performedDateTime` ← `OPRT_DT_TM` |
| `performer[]` | `function.text`（主刀医师 / 麻醉医师）、`actor`、`onBehalfOf`（机构） | `OPRT_DCT_*`、`ATHS_DCT_*` | 助手只有工号，原样保留在 `source-field` |
| `reasonCode[]` | 术前诊断 | `POPRT_DIAG_CD` / `POPRT_DIAG_NM` | |
| `outcome.text` | 术后诊断 | `OPRT_AFTR_DIAG_NM` | |
| `bodySite[].text` | 手术部位 | `OPRT_PRT_NM` | |
| `note[].text` | 手术经过 | `OPRT_PRCS_DSCPT` | |
| 扩展 | `procedure-level`（手术级别）、`incision-class`（切口类别，以名称为准）、`anesthesia-method`（麻醉方式；“会诊”不属于本值域，只留原值）——均为规范值 + 原代码、`time-scheduled`（`OPRT_DT_TM`，与实际开始时间不同时才有）、`department` | | |

### 3.8 DocumentReference（病历文书）

来源：门（急）诊病历、入院记录、出院记录，每份文书一条。

| 元素 | 含义 | 说明 |
|---|---|---|
| `identifier[]` | 记录标识 | |
| `status` | `current`；作废记录为 `entered-in-error` | |
| `type` | LOINC + 本地文书类型 | 门（急）诊病历 34108-1，入院记录 34117-2，出院记录 18842-5 |
| `date` | 记录时间 | `RCD_DT_TM`，没有时取 `CRT_TM` |
| `author[]` / `custodian` | 记录人和机构 / 机构 | |
| `description` | 文书类型名称 | |
| `content[0].attachment` | 正文：`contentType = text/plain; charset=utf-8`、`language = zh-CN`；`data` 是 base64 编码；`creation` 为记录时间 | 解码后按"【栏目】换行 正文"拼接，正文原样保留 |
| `context.encounter[]` | 所属就诊 | |

各类文书正文的栏目和来源字段：

| 文书 | 栏目（来源字段） |
|---|---|
| 门（急）诊病历 | 主诉 `CHF_COMPLNT`、现病史 `PRST_ILLNS_HST`、既往史 `PAST_HST`、手术史 `OPRT_HST`、输血史 `TRSFS_BLD_HST`、传染病史 `INFCT_HST`、过敏史 `ALGN_HST`、个人史 `PSN_HST`、婚育史 `MRTL_HST`、月经史 `MST_HST`、家族史 `FML_HST_FLG`、体格检查 `PSQ_EXAM`、辅助检查 `AXLR_EXAM`、诊断 `EMG_RSC_RCD`、处理意见 `HDL_SGST`、注意事项 `ATNT_ITM` |
| 入院记录 | 主诉 `CHF_COMPLNT`、正文 `PST_ILLNS_HST`（入院记录全文） |
| 出院记录 | 入院情况 `ADMN_CDT`、出院情况 `DSCG_CDT` |

门诊病历里的结构化体征（血压、身高、体重、体温、脉率）另外生成 Observation，见 3.4 b。

### 3.9 ChargeItem（费用明细）

来源：门诊费用明细 `p_doc_fact_otpt_fee_dtl`。

| 元素 | 含义 | 来源字段 |
|---|---|---|
| `identifier[]` | 记录标识 | `PRM_KEY` |
| `status` | `billable`；作废记录为 `entered-in-error` | |
| `code` | 收费项目，代码体系 `charge-item/org-…` | `CHRG_ITM_CD` / `CHRG_ITM_NM` |
| `context` | 所属就诊 | `OTPT_EMG_NO` |
| `occurrenceDateTime` | 收费时间 | `CHRG_DT` |
| `performingOrganization` / `requestingOrganization` | 机构 / 开单科室 | `MDC_ORG_*` / `OPN_DPT_*` |
| `quantity` | 数量、单位 | `ITM_QTY`、`ITM_UNT` |
| `enterer` | 录入人 | `CRT_STFF_*` |
| 扩展 | `unit-price`（单价，人民币）、`total-price`（金额）、`fee-category`（费用类别，规范值 + 原代码，优先用 `*_STD` 字段）、`flag-refund`（`CHRG_RTRN_FLG` 原值；值域确认后改为 `charge-refund` 规范值） | `ITM_UNT_PRICE`、`ITM_FEE`、`FEE_CGY_*` |

### 3.10 Organization（医疗机构 / 科室）

| 元素 | 医疗机构 | 科室 |
|---|---|---|
| `identifier` | `{ns}/id/org-code` ← `MDC_ORG_CD` 等 | `{ns}/CodeSystem/dept-code/org-…` ← 科室代码 |
| `type` | — | `organization-type#dept` |
| `name` | 机构名称（假名） | 科室名称 |
| `partOf` | — | 所属医疗机构 |

### 3.11 Practitioner（医务人员）

| 元素 | 含义 |
|---|---|
| `identifier` | 工号（假名），`system = {ns}/id/staff-code`，`assigner` 为所属机构 |
| `name[].text` | 姓名（假名） |

源数据里医生有时只有工号、有时只有姓名，两种情况都会生成 Practitioner。同一个人如果分别以"只有工号"和"只有姓名"出现，会成为两条记录（没有依据把它们合并）。

### 3.12 Basic（未映射的表）

没有映射规格的表，每行生成一条 Basic，全部字段放在 `source-field` 扩展里，不丢数据。

| 元素 | 含义 |
|---|---|
| `code` | 来源表（本地代码 `source-table`，`text` 为表名） |
| `subject` | 病人（按证件号假名推断） |
| `created` | 记录日期（自动推断出的时间字段） |
| `author` | 机构（自动推断） |
| 扩展 `encounter` | 就诊（按就诊号 / 住院号假名推断） |

使用内置规格的区域平台数据不会出现 Basic。

---

## 4. 扩展一览

| 扩展 | 值类型 | 出现在 | 含义 |
|---|---|---|---|
| `source-field` | 子扩展 name / value | 所有资源 | 没有对应元素的源字段，原样保留 |
| `record-created` / `record-updated` | dateTime | 所有资源 | 源记录的创建 / 更新时间 |
| `actor-recorder` / `actor-updater` | Reference | 所有资源 | 源记录的创建人 / 更新人 |
| `actor-verifier` / `actor-requester` / `actor-collector` | Reference | Observation、DiagnosticReport | 审核人 / 申请人 / 采集人 |
| `department` / `organization` | Reference | 多种 | 科室 / 机构 |
| `code-as-recorded` | string | 多种 | 不符合 FHIR 代码格式、或无法识别的诊断代码原值 |
| `icd-asterisk-code` | Coding | Condition | ICD-10 星号码（剑号星号组合拆分出来的） |
| `result-decision` | Coding | Observation | 检验结果判定原值（`RSLT_DCD_CD`） |
| `charge-refund` | CodeableConcept | ChargeItem | 收退费（值域确认后） |
| `source-system` | string | Observation、Patient.address | 源数据的来源系统名称 |
| `address-kind` / `admin-division-code` | string | Patient.address | 地址类别 / 最细一级的行政区划代码 |
| `marital-status-at-visit` | string | Encounter | 就诊时登记的婚姻状况 |
| `flag-emergency` / `flag-first-visit` | string | Encounter | 急诊标志 / 初诊标志（原值） |
| `period-end-as-recorded` | dateTime | Encounter、Procedure | 早于开始时间的结束时间原值 |
| `diagnosis-category` | CodeableConcept | Condition | 诊断类别 |
| `flag-main-diagnosis` / `flag-tcm` | string | Condition | 主诊断标志 / 中医诊断标志（原值） |
| `diagnosis-sequence` | string | Condition | 诊断序号 |
| `result-flag` | Coding | Observation | 检验结果标志原值（未换算） |
| `unit-as-recorded` | string | Observation | 非数值结果的单位原文 |
| `death-place` | string | Observation（死因） | 死亡地点 |
| `time-ordered` | dateTime | DiagnosticReport | 申请时间 |
| `reason-text` / `status-as-recorded` | string | DiagnosticReport（检查） | 临床诊断 / 状态原值 |
| `procedure-level` / `incision-class` / `anesthesia-method` | CodeableConcept | Procedure | 手术级别 / 切口类别 / 麻醉方式 |
| `time-scheduled` | dateTime | Procedure | 计划时间 |
| `unit-price` / `total-price` | Money（CNY） | ChargeItem | 单价 / 金额 |
| `fee-category` | CodeableConcept | ChargeItem | 费用类别 |
| `flag-refund` | string | ChargeItem | 收退费标志（原值） |
| `encounter` | Reference | Basic | 关联就诊 |

## 5. 标识体系一览

| system | 含义 |
|---|---|
| `{ns}/id/id-card` | 证件号（假名），病人主标识 |
| `{ns}/id/patient-local-id` | 机构内病人号 |
| `{ns}/id/patient-card` | 就诊卡号 |
| `{ns}/id/outpatient-no` / `inpatient-no` | 门诊号 / 住院号 |
| `{ns}/id/lab-report-no` / `exam-report-no` | 检验报告号 / 检查记录号 |
| `{ns}/id/order-no` | 电子申请单号 |
| `{ns}/id/org-code` | 机构代码 |
| `{ns}/id/staff-code` | 医务人员工号 |
| `{ns}/id/record/<规格>/<表>` | 源记录主键（回查用） |

## 6. 怎么读

- **导入服务器**：把文件 POST 到 FHIR 服务器根地址（如 `http://localhost:8080/fhir`），`Content-Type: application/fhir+json`。导入前先把 `definitions/` 加载到服务器，或者关闭服务器对未知扩展、代码的严格校验。
- **找标准编码**：按 `system` 挑 coding——规范值体系 `{ns}/CodeSystem/canonical/…` 或标准体系是归一结果，`http://loinc.org`、`http://snomed.info/sct` 是术语对照结果；本批用到的对照在 `definitions/ConceptMap-*.json`。
- **用程序读**：遍历 `entry[].resource`，按 `resourceType` 分组；引用 `"Type/id"` 都能在同一个文件里找到。
- **看文书正文**：对 `content[0].attachment.data` 或 `presentedForm[].data` 做 base64 解码（UTF-8）。
- **回查源记录**：用 `meta.source` 找到源文件，用记录标识（`{ns}/id/record/…`）的值找到源记录主键 `PRM_KEY`。
