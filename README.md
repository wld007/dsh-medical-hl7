# dsh-medical-hl7 · HL7 数据交换

DeepSeek Harness 插件：把医疗数据（通常是 `dsh-medical-anonymizer` 的交付目录）转换成 **HL7 FHIR R4**，用于长期存储和对外交换。

- 每位病人一个 **transaction Bundle**：PUT + 稳定编号，可以直接、重复导入任何 FHIR 服务器（HAPI 等）。
- 整批 **Bulk Data NDJSON** + `manifest.json`：可以直接批量导入，也方便拷贝交换。
- 附带 **definitions/**：本批用到的扩展（StructureDefinition）和本地代码字典（CodeSystem）。接收方加载这些定义后就能识别本地内容。
- 只在本机按规则处理，不调用模型，也不修改源文件。

## 用法

Agent 工具：

| 工具 | 作用 |
|---|---|
| `hl7_start` | 启动转换（`inputDir`、可选 `outputRoot`、`resumeFrom`），立即返回批次 id |
| `hl7_status` | 进度与验收门结果 |
| `hl7_report` | 批次报告（不含病历原文） |
| `hl7_runs` | 最近的批次 |
| `hl7_cancel` | 取消；之后可用 `resumeFrom` 继续 |

命令：`/hl7 <输入目录或文件> [--out 输出根目录]`

输出：

```
<输出根目录>/
  <输入名>/                     交付（批次结束后才出现）
    bundles/<病人>.json          transaction Bundle
    ndjson/<资源类型>.ndjson      Bulk Data
    definitions/                 StructureDefinition-*.json、CodeSystem-*.json
    manifest.json
  _records/runs/<批次>/          report.md、run.json、mapping.json（本批实际用的映射）、held/（暂扣的病人）
```

## 设计：语义角色 → 固定构建器

数据源多样、标准化程度低，所以不按每张表写转换代码：

1. **映射规格**（`profiles/*.mjs` 或 `*.json`，纯数据）：把源字段指派给语义角色，例如 `item.code`、`value`、`time.effective`、`actor.surgeon.name`。角色词表见 `lib/mapping/roles.js`。
2. **构建器**（`lib/convert.js`）：每类记录一个，只认角色，不认字段名，由它负责 FHIR 的正确性。

| kind | FHIR |
|---|---|
| patient / address / death | Patient（+ 问题列表 Condition、死因 Observation） |
| encounter | Encounter |
| condition | Condition（挂回 Encounter.diagnosis） |
| lab | Observation，按报告号归并成 DiagnosticReport，标本生成 Specimen |
| imaging | DiagnosticReport（结论 + 正文附件） |
| procedure | Procedure |
| document | DocumentReference（正文附件），文书里的结构化体征另出 Observation |
| observation | Observation（体征用 LOINC + UCUM，血压合成 85354-9 面板） |
| medication | MedicationRequest |
| charge | ChargeItem |
| generic | Basic |

3. **没有规格的表**：插件根据匿名化留下的假名前缀（证件-、医院-、医生-、就诊-、住院-、化名-…）、字段名和取值类型，自动推断病人、机构、医生、就诊号和记录时间，整张表作为 Basic 保留全部字段。报告里会给出建议的 kind，推断结果写在 `mapping.json` 里，可以照着改成正式规格，放到设置项 `profilesDir` 指定的目录。

内置规格：`regional-platform`，对应区域平台的 `p_doc_*.json`。

## 转换口径

- **值不变**：时间只做格式转换（毫秒/秒时间戳、`YYYYMMDD`、`YYYY-MM-DD HH:mm:ss` 等都识别；源数据没写时区的按设置的时区处理，默认 +08:00）；文本只去掉首尾空白；文书正文原样放进附件。
- **代码原样**：本地代码进本地代码体系（机构自编的代码按机构区分），只有确知含义的才加标准编码（体征 LOINC、性别、婚姻状况、v3 就诊类别）。含义不明的代码（如检验结果标志）不换算，原样放在扩展里。FHIR 不允许含空白的代码，这类代码不进 coding，原值放进 `code-as-recorded` 扩展。
- **不丢数据**：没有对应角色的字段，以 `source-field` 扩展（name/value）挂在资源上；不认识的表转成 Basic。
- **不编造**：就诊表里没有、但被其他记录引用的就诊，按号码生成 Encounter（`status=unknown`，带 `encounter-not-registered` 标签，不填时间）。
- **编号稳定**：资源 id 由"来源表 + 源记录主键"派生，重跑结果不变。
- **一码多名**：同一本地代码在源数据里出现过的不同名称，全部登记为 CodeSystem 的同义名；报告里列出这些代码，作为数据质量提示。

## 验收门（按病人）

- **结构**：插件自带校验（id、必填元素、date/dateTime/instant 格式、code、扩展、Period 起止顺序、引用完整性），每个资源都检查。
- **残留标识符**：扫描所有字符串，附件正文先解码再扫，查找校验位正确的 18 位身份证号和手机号。报告里只记录遮盖后的值。

任一验收门未通过，该病人的 Bundle 会暂扣在 `_records/runs/<批次>/held/`，不放进交付目录。

另外可以配置官方 HL7 Validator（设置项 `validatorJar`）做抽检。抽检时会加载 `definitions/`，并且离线运行（`-tx n/a`），不会把任何内容发到外部术语服务器。

## 设置（cordis.patch.yml）

| 项 | 默认 | 说明 |
|---|---|---|
| `outputRoot` | 空 | 空 = 输入旁的 `_medical-hl7` |
| `namespace` | `http://dsh.local/fhir` | 标识、代码体系、扩展的命名空间，也是 Bundle fullUrl 的前缀。确定后不要再改 |
| `timezone` | `+08:00` | 源数据没写时区的时间按此处理 |
| `profilesDir` | 空 | 额外的映射规格目录 |
| `residualGate` | `block` | `warn` = 只提示、不暂扣 |
| `validatorJar` / `validatorSample` / `javaPath` | 空 / 2 / java | 官方校验器抽检 |

## 开发

```
npm test                          # 虚构数据测试
node scripts/build.mjs 0.1.0-dev.N  # 生成 dist/<版本>，再从 profile 安装
```

测试只使用虚构数据；真实病历和由病历派生的结果都不进仓库。
