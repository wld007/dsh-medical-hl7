# 处理流程：Schema 同构、值域归一、术语对照

适用版本：dsh-medical-hl7 0.4.x。

```
读取分组 → ① Schema 同构 → ② 值域归一 → ③ 术语对照 → ④ FHIR 组装 → 验收 → 交付
```

| 阶段 | 回答的问题 | 做什么 | 不做什么 | 依据 | 产物 |
|---|---|---|---|---|---|
| 读取分组 | 有哪些数据、属于谁 | 找数据文件；按目录、病人编号归并；核对源文件只读 | — | — | 源记录 |
| ① Schema 同构 | 这个字段是什么 | 表 → 记录类别（就诊、诊断、检验……）；字段 → 语义角色；定主键、识别作废；同一角色有多个备选字段时取第一个有值的 | **不解释、不改任何取值** | 映射规格 `profiles/`（或自动推断） | 同构记录 |
| ② 值域归一 | 这个值是什么意思 | 每个角色绑定一个值域，按值域把写法统一成规范值 | 不猜：含义没确认的标“待确认”，用原值 | 值域定义 `vocab/domains/` + 本机复核 | 归一记录 |
| ③ 术语对照 | 这个本地概念对应哪个标准术语 | 本地概念 → LOINC、SNOMED CT、国家标准代码表；已确认的另加一个标准编码 | 不改原值，不判对错 | 术语对照 `vocab/terminology/` + 本机复核 | 归一记录上的 terms |
| ④ FHIR 组装 | 怎么表达成 FHIR | 按归一记录拼资源；病人级合并（性别、地址、就诊、检验报告） | 不读原始字段、不解析任何值 | 构建器 `lib/convert.js` | FHIR 资源 |
| 验收 | 能不能交付 | 结构、引用完整性、残留身份证号/手机号 | — | — | 每人通过 / 暂扣 |
| 交付 | — | 按人 Bundle、按资源类型 NDJSON、definitions（含 ConceptMap）、manifest | — | 设置 `outputFormat` | 交付目录 |

## 值域归一与术语对照的区别

| | 值域归一 | 术语对照 |
|---|---|---|
| 解决 | 同一件事写法不统一（`阴性` / `阴性(-)` / `阴性（-）`；`fl` / `fL`；性别 `1` / `男性`） | 不同代码体系表达同一个概念（本地 `5049 肌酐` ↔ LOINC `2160-0`） |
| 取值范围 | 封闭、小，含义由数据定义决定 | 开放、大（成千上万个概念） |
| 结果 | 规范值（原值保留） | 另加的标准编码（原代码不动） |
| 做不到时 | 数据质量问题（写法混乱、代码与名称冲突） | 只是还没对照，不影响数据本身 |
| 顺序 | 先做 | 后做（写法统一后才能对照） |

## 取值状态

| 状态 | 含义 | FHIR 里用什么 |
|---|---|---|
| 已归一 | 对照表里有已确认的条目，或格式能解析 | 规范值（标准 coding / 数值 / 时间）；原代码作为第二个 coding、原文作为 text |
| 按原文保留 | 有意不归一（如“黄色”“软便”这类描述性结果） | 原文 |
| 待确认 | 对照表里有条目，但含义没确认（代码与名称冲突、只能从数据推断） | 原值 |
| 无对照 | 对照表里没有这个值 | 原值 |
| 不属于本值域 / 无法解析 | 值不在这个值域里（如麻醉方式填了“会诊”），或格式无法解析 | 原值（诊断代码另放 `code-as-recorded` 扩展） |

**未归一不阻断交付**。覆盖率低于设置 `domainCoverageWarn`（默认 90%）时，报告里告警。

## 复核

页面「② 值域归一」「③ 术语对照」可以逐条复核：

- 值域：选“已确认 + 规范值”“待确认”“不属于本值域”“按原文保留”，写依据。
- 术语：填标准代码、名称、关系（等价 / 目标更宽 / 目标更窄 / 近似 / 无对应）、状态。

复核结果存在本机（设置 `vocabDir`，默认插件数据目录下的 `vocab/`），按键覆盖内置条目，**所有批次共用、下次运行生效**；页面上“用新对照重跑本批”可以立即重跑。每个批次记录所用的对照表版本（内置 + 本机复核的哈希）。

## 中间结果与统计

`_records/runs/<批次>/`：

| 文件 | 内容 |
|---|---|
| `stages/<病人>.harmonized.ndjson.gz` | 同构记录（设置 `keepIntermediate`，默认开） |
| `stages/<病人>.normalized.ndjson.gz` | 归一记录：每个角色的原值、规范值、状态、依据；术语对照结果 |
| `schema.json` | ① 每张表：行数、各角色填充、原样保留字段 |
| `domains.json` | ② 每个值域：各状态计数、写法分布、出现过的取值及次数 |
| `terminology.json` | ③ 每组对照：本地概念、出现次数、对照情况 |
| `mapping.json` | 本批实际使用的映射规格（含自动推断） |

## 内置值域与术语对照（0.4.0）

值域定义在 `vocab/domains/`（通用的放根目录，区域平台专用的放 `regional-platform/`），每条对照写明依据或说明。代码与名称冲突时以名称为准并注明；名称本身含糊的标“待确认”。

| 值域 | 编号 | 目标 | 条目 | 已确认 | 待确认 | 不属于本值域 | 按原文保留 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ABO 血型 | `abo` | ABO 血型（规范值） | 6 | 6 | 0 | 0 | 0 |
| 检查类型 | `dicom-modality` | DICOM 设备类型 | 16 | 13 | 3 | 0 | 0 |
| 性别 | `gender` | FHIR 管理性别 | 11 | 10 | 1 | 0 | 0 |
| 婚姻状况 | `marital` | HL7 v3 婚姻状况 | 16 | 13 | 3 | 0 | 0 |
| 定性结果 | `qualitative-result` | 定性结果（规范值） | 58 | 33 | 6 | 0 | 19 |
| 麻醉方式 | `regional-platform/anesthesia-method` | 麻醉方式（规范值） | 3 | 2 | 0 | 1 | 0 |
| 收退费标志（CHRG_RTRN_FLG） | `regional-platform/charge-refund` | 收退费（规范值） | 2 | 0 | 2 | 0 | 0 |
| 诊断类别（DIAG_CGY_NM） | `regional-platform/diagnosis-category` | 诊断类别（规范值） | 5 | 5 | 0 | 0 | 0 |
| 就诊类型（诊断表 VST_TP） | `regional-platform/diagnosis-setting` | HL7 v3 就诊类别 | 2 | 2 | 0 | 0 | 0 |
| 离院方式 | `regional-platform/discharge-disposition` | 离院方式（规范值） | 1 | 0 | 1 | 0 | 0 |
| 饮酒频率 | `regional-platform/drinking-frequency` | 饮酒频率（规范值） | 6 | 4 | 0 | 2 | 0 |
| 饮酒状况 | `regional-platform/drinking-status` | 饮酒状况（规范值） | 3 | 3 | 0 | 0 | 0 |
| 饮酒种类 | `regional-platform/drinking-type` | 饮酒种类（规范值） | 2 | 1 | 1 | 0 | 0 |
| 病人来源（检查表 PTT_SRC_CD） | `regional-platform/exam-patient-source` | HL7 v3 就诊类别 | 2 | 2 | 0 | 0 | 0 |
| 检查状态（EXAM_STTS_CD） | `regional-platform/exam-status` | FHIR 报告状态 | 5 | 1 | 4 | 0 | 0 |
| 锻炼频率 | `regional-platform/exercise-frequency` | 锻炼频率（规范值） | 4 | 4 | 0 | 0 | 0 |
| 锻炼方式 | `regional-platform/exercise-type` | 锻炼方式（规范值） | 1 | 1 | 0 | 0 | 0 |
| 费用类别（FEE_CGY_*_STD） | `regional-platform/fee-category` | 费用类别（规范值） | 6 | 6 | 0 | 0 | 0 |
| 切口类别 | `regional-platform/incision-class` | 切口类别（规范值） | 6 | 6 | 0 | 0 | 0 |
| 病人来源（检验表 PTT_SRC_CD） | `regional-platform/lab-patient-source` | HL7 v3 就诊类别 | 7 | 4 | 3 | 0 | 0 |
| 检验结果判定（RSLT_DCD_CD） | `regional-platform/lab-result-decision` | HL7 v3 结果解释 | 6 | 0 | 6 | 0 | 0 |
| 检验结果标志（RSLT_FLG） | `regional-platform/lab-result-flag` | HL7 v3 结果解释 | 4 | 0 | 4 | 0 | 0 |
| 主诊断标志（MAIN_DIAG_FLG） | `regional-platform/main-diagnosis-flag` | HL7 是/否 | 3 | 2 | 1 | 0 | 0 |
| 手术级别 | `regional-platform/procedure-level` | 手术级别（规范值） | 8 | 8 | 0 | 0 | 0 |
| 吸烟状况 | `regional-platform/smoking-status` | 吸烟状况（规范值） | 6 | 6 | 0 | 0 | 0 |
| 就诊类型（就诊表 VST_TP） | `regional-platform/visit-type` | HL7 v3 就诊类别 | 3 | 3 | 0 | 0 | 0 |
| Rh 血型 | `rh` | Rh 血型（规范值） | 6 | 6 | 0 | 0 | 0 |
| 计量单位 | `ucum-unit` | UCUM | 109 | 99 | 8 | 2 | 0 |
| 是否标志 | `yes-no` | HL7 是/否 | 4 | 4 | 0 | 0 | 0 |

| 术语对照 | 编号 | 目标标准 | 源概念取自 | 落在 | 内置对照 |
| --- | --- | --- | --- | --- | --- |
| 收费项目 → 医疗服务项目 | `charge-item` | 全国医疗服务价格项目规范 | charge / item.code / item.display（按机构） | ChargeItem.code.coding | 0 |
| 科室 → 诊疗科目 | `department` | 医疗机构诊疗科目名录 | dept.code / dept.name（按机构） | Organization（科室）.type | 0 |
| 检查项目 → LOINC | `exam-item` | LOINC | imaging / item.display | DiagnosticReport.code.coding | 0 |
| 检验项目 → LOINC | `lab-item` | LOINC | lab / item.code / item.display（按机构） | Observation.code.coding | 0 |
| 检验组合 → LOINC | `lab-panel` | LOINC | lab / panel.code / panel.display（按机构） | DiagnosticReport.code.coding | 0 |
| 职业 → GB/T 6565 | `occupation` | GB/T 6565 职业分类与代码 | 观察项 occupation | Observation.valueCodeableConcept.coding | 0 |
| 定性结果 → SNOMED CT | `qualitative-result` | SNOMED CT | 值域 qualitative-result | Observation.valueCodeableConcept.coding | 2 |
| 标本类型 → SNOMED CT | `specimen` | SNOMED CT | lab / specimen.display | Specimen.type.coding | 0 |
| 症状 → SNOMED CT | `symptom` | SNOMED CT | 观察项 symptom | Observation.valueCodeableConcept.coding | 0 |

格式类值域（代码实现，不需要对照表）：时间、文字中的时间、数值、参考范围、检验结果值（数值 / 定性）、ICD-10 代码清洗（拆剑号星号、识别中医疾病/证候代码）、手术操作代码（识别 ICD-9-CM-3 国家临床版）、代码格式。

### 区域平台数据里已知的待确认项

| 值域 | 取值 | 问题 |
|---|---|---|
| 性别 | 9 / 其他 | GB/T 2261.1 中 9 = 未说明，名称却写“其他” |
| 检验结果标志 RSLT_FLG | 0 / 1 / 2 / 3 | 无代码表；数据推断 0 偏低、1 偏高、3 偏低、2 偏高 |
| 检验结果判定 RSLT_DCD_CD | -2 / 0 / 2 / ±1 / 9 | 数据推断 -2 偏低、0 正常、2 偏高 |
| 主诊断标志 | N | 只出现在住院诊断，可能是“否”也可能是“未标注” |
| 病人来源（检验表） | 9 / 其他 | 无法确定门诊或住院 |
| 婚姻状况 | 3、名称“其他”“2” | 不在 GB/T 2261.2 中 |
| 检查状态 | 0 / 1 / 4 / 5 | 无代码表 |
| 收退费标志 | 1 / 2 | 数据推断 2 为退费（数量、金额均为负） |
| 检查类型 | DR、BRO | 不是 DICOM 代码 |
| 计量单位 | mml/L、M/L、APL 等 | 疑似笔误或 UCUM 无对应 |
