# 更新记录

## 0.4.0 — 2026-11-12

流程拆细：读取分组 → ① Schema 同构 → ② 值域归一 → ③ 术语对照 → ④ FHIR 组装 → 验收 → 交付。

- **Schema 同构**（`lib/stages/harmonize.js`）：只搬不改；备选字段取值不同的原样保留（以前会丢）；同一就诊号后续登记里与首条不同的字段原样保留（以前会丢）。
- **值域归一**（`lib/stages/normalize.js`）：29 个对照类值域做成带版本的数据文件 `vocab/domains/`，8 个格式类值域；每个取值带状态（已归一 / 按原文保留 / 待确认 / 无对照 / 不属于本值域），含义未确认的不猜。映射规格的 `values` 改为 `domains`（角色 → 值域）。
- **术语对照**（`lib/stages/terminology.js`）：9 组对照（检验项目/组合/检查项目 → LOINC，标本/症状/定性结果 → SNOMED CT，科室、收费项目、职业 → 国家标准），已确认的另加标准编码；本批用到的对照输出为 `definitions/ConceptMap-*.json`。内置：阴性/阳性 → SNOMED CT。
- **FHIR 组装**（`lib/convert.js`）只读归一结果；CodeableConcept 顺序：规范值、原代码、标准术语。
- **复核**：页面新增「① Schema 同构」「② 值域归一」「③ 术语对照」三页；值域与术语可逐条复核，存本机（`vocabDir`），下次运行生效，可一键重跑。批次记录对照表版本。
- **中间结果**：默认保存每位病人的同构记录、归一记录（`stages/*.ndjson.gz`）；新增 `schema.json`、`domains.json`、`terminology.json` 统计；报告按阶段分节，值域覆盖率低于阈值告警（不阻断）。
- **修正**：性别 9/其他 不再映射成 other（待确认）；检验表病人来源 2、9 不再漏掉；全角“＜”的数值和参考范围能解析；诊断类别补上 ryzd（入院诊断）；剑号星号组合拆分；中医病证/证候代码单独成体系；无法识别的诊断代码不再进 ICD 体系；婚姻状况“未知”改用 v3-NullFlavor；参考范围带 UCUM 单位。
- 新文档 `docs/pipeline.md`；`docs/bundle-fields.md` 更新。

## 0.3.0 — 2026-11-12

- 新设置「交付格式」`outputFormat`：`both`（默认，按人 bundles/ 与按资源类型 ndjson/ 都存）、`bundles`（只存按人）、`ndjson`（只存按资源类型）。definitions/ 与 manifest.json 总是保留；manifest 新增 `outputFormat`、`bundles` 列表。
- 新文档 `docs/bundle-fields.md`：按人存储（Bundle）的字段说明——每类资源的元素、含义、来源字段，扩展、标识体系一览。

## 0.2.2 — 2026-11-12

- 浅色/深色配色与「医疗数据匿名化」一致：自动检测 DSH 当前主题；浅色下底色与卡片带青绿底调、强调色青绿，不再发白；深色下用青绿控制室配色。

## 0.2.1 — 2026-11-12

- 页面配色改用 DSH 主题变量（背景、层级、边框、文字、品牌色、状态色），浅色与深色主题自动跟随；不再固定深色。

## 0.2.0 — 2026-11-12

- 可视化界面：左侧栏「HL7 数据交换」页面
  - 概览：处理流程、病人格子、资源类型分布、验收门与输入来源
  - 病人：每人的资源数、验收门、结构错误、残留标识符（只显示遮盖后的值）、原样保留的字段
  - 资源浏览：按病人、按类型列出资源，可筛选；点开查看完整 FHIR JSON，文书正文解码显示
  - 映射与定义：每张表的处理方式（内置规格／自动推断及推断依据）、附带的定义、一码多名、原样保留字段排行
  - 报告；新批次（可选目录）、取消、继续处理
- 设置页：设置 → HL7 数据交换（命名空间、时区、规格目录、残留标识符处理方式、官方校验器）。

## 0.1.0 — 2026-11-12

首个版本。

- 按“语义角色 → 固定构建器”把医疗数据转成 HL7 FHIR R4：Patient、Encounter、Condition、Observation、DiagnosticReport、Specimen、Procedure、DocumentReference、MedicationRequest、ChargeItem、Basic、Organization、Practitioner。
- 内置映射规格 `regional-platform`（区域平台 `p_doc_*.json`）；没有规格的表自动推断病人、机构、医生、就诊号、记录时间，整表以 Basic 无损保留。
- 交付：每病人 transaction Bundle（PUT、稳定编号）、整批 Bulk NDJSON + manifest、definitions/（本地扩展 StructureDefinition 与本地代码 CodeSystem）。
- 验收门：内置结构校验与引用完整性、残留身份证号/手机号检查；未过的病人暂扣。可选官方 HL7 Validator 抽检（离线）。
- Agent 工具 `hl7_start` / `hl7_status` / `hl7_report` / `hl7_runs` / `hl7_cancel`，命令 `/hl7`。
