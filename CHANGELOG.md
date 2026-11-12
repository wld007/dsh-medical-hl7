# 更新记录

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
