# 更新记录

## 0.1.0 — 2026-11-12

首个版本。

- 按“语义角色 → 固定构建器”把医疗数据转成 HL7 FHIR R4：Patient、Encounter、Condition、Observation、DiagnosticReport、Specimen、Procedure、DocumentReference、MedicationRequest、ChargeItem、Basic、Organization、Practitioner。
- 内置映射规格 `regional-platform`（区域平台 `p_doc_*.json`）；没有规格的表自动推断病人、机构、医生、就诊号、记录时间，整表以 Basic 无损保留。
- 交付：每病人 transaction Bundle（PUT、稳定编号）、整批 Bulk NDJSON + manifest、definitions/（本地扩展 StructureDefinition 与本地代码 CodeSystem）。
- 验收门：内置结构校验与引用完整性、残留身份证号/手机号检查；未过的病人暂扣。可选官方 HL7 Validator 抽检（离线）。
- Agent 工具 `hl7_start` / `hl7_status` / `hl7_report` / `hl7_runs` / `hl7_cancel`，命令 `/hl7`。
