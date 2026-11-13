# dsh-medical-hl7 · HL7 标准化

DeepSeek Harness 插件：把医疗数据（通常是 `dsh-medical-anonymizer` 的交付目录）转换成 **HL7 FHIR R4**，用于长期存储和对外交换。

- 每位病人一个 **transaction Bundle**：PUT + 稳定编号，可以直接、重复导入任何 FHIR 服务器（HAPI 等）。
- 整批 **Bulk Data NDJSON** + `manifest.json`：可以直接批量导入，也方便拷贝交换。
- 附带 **definitions/**：本批用到的扩展（StructureDefinition）和本地代码字典（CodeSystem）。接收方加载这些定义后就能识别本地内容。
- 不修改源文件。模型可选：只发往设置里配置的端点（通常本机或内网）。

## 用法

### 页面

在左侧栏打开「HL7 标准化」，点「＋ 新批次」选择输入目录即可开始转换。页面标签：

- **概览**：映射总览——源数据经三个处理阶段映射到 FHIR R4 资源类型的情况：线宽表示记录数，每种资源类型下各 FHIR 元素的填充率以柱高显示；右侧为关键数字、待处理事项、各阶段覆盖率、填充率最低的元素、来源与交付信息。
- **① Schema 同构**：每张表的类别、各角色对应的来源字段与填充率、未映射的字段、自动推断的依据；模型起草的规格可确认、修改、驳回。
- **② 值域归一**：每个值域的覆盖率、出现过的取值和次数、当前对照；可复核。
- **③ 术语对照**：每组对照的本地概念和覆盖率；可填写标准代码。
- **病人**：每位病人的资源数、验收门结果、转换提示，以及未映射的字段。
- **模型调用**：模型、各阶段结果、交叉核验、按环节统计、最近的调用（只记录大小、耗时和 token）。
- **资源浏览**：按病人、按资源类型列出所有资源；点开一条可以看完整的 FHIR JSON，文书正文会解码成可读文字。
- **报告**。

配置项在 设置 → HL7 标准化。

### Agent 工具与命令

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
  _records/records.sqlite        过程记录库：批次、阶段统计、本批实际使用的映射规格、模型调用与缓存
  _records/runs/<批次>/          report.md、report.json、stages/（中间结果）、held/（暂扣的病人）
```

**字段说明**：按人存储的 Bundle 里每类资源有哪些元素、含义、来自哪个源字段，见 [docs/bundle-fields.md](docs/bundle-fields.md)。

**交付格式**：设置项 `outputFormat` 可选 `both`（默认）、`bundles`（仅按病人）、`ndjson`（仅按资源类型）。

## 流程

```
读取分组 → ① Schema 同构 → ② 值域归一 → ③ 术语对照 → ④ FHIR 组装 → 验收 → 交付
```

- **① Schema 同构**：表 → 记录类别，字段 → 语义角色。只做结构映射，不改变取值。
- **② 值域归一**：将同一含义的不同写法统一为规范值（时间、单位、性别、定性结果、诊断代码清洗等）。值域定义是带版本的数据文件 `vocab/domains/`；含义未经确认的取值标为“待确认”，按原值交付，不做推测，不阻断交付。
- **③ 术语对照**：本地概念 → LOINC、SNOMED CT、国家标准代码表；已确认的对照另行添加标准编码，原代码不变。对照表 `vocab/terminology/`。
- **④ FHIR 组装**：仅依据归一结果组装资源。

**模型（可选，参照医疗数据匿名化）**：无映射规格的表由模型起草映射规格，无对照的取值由模型确定规范值，本地概念由模型在**本地代码表检索出的候选**中选择标准代码。每一步都经插件校验、核验模型独立盲审和复判，两个模型结论一致才采用，不一致的转人工复核；模型结论在 FHIR 中带有标记，人工确认后去除。病历内容只发往设置里配置的端点。详见 [docs/pipeline.md](docs/pipeline.md)。

页面「② 值域归一」「③ 术语对照」可以逐条复核，结果保存在本机对照库（`vocab.sqlite`，含完整修改历史），下次运行生效，也可直接用新对照重新运行本批。每位病人的同构记录、归一记录默认保存在 `_records/runs/<批次>/stages/`。详见 [docs/pipeline.md](docs/pipeline.md)（含内置值域清单和已知待确认项）。

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

3. **没有规格的表**：插件根据匿名化留下的假名前缀（证件-、医院-、医生-、就诊-、住院-、化名-…）、字段名和取值类型，自动推断病人、机构、医生、就诊号和记录时间，整张表作为 Basic 保留全部字段。报告里会给出建议的 kind，推断结果记录在本批的映射规格中（记录库 `run_docs` 表的 `mapping`），可据此编写正式规格，放到设置项 `profilesDir` 指定的目录。

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
| `outputFormat` | `both` | 交付格式：`both` / `bundles` / `ndjson` |
| `vocabDir` | 空 | 本机对照库 `vocab.sqlite` 所在目录（人工复核与模型结果）；空 = 插件数据目录下的 `vocab/` |
| `keepIntermediate` | `true` | 保存每位病人的同构记录、归一记录 |
| `domainCoverageWarn` | `0.9` | 值域覆盖率低于此值时报告告警 |
| `residualGate` | `block` | `warn` = 只提示、不暂扣 |
| `validatorJar` / `validatorSample` / `javaPath` | 空 / 2 / java | 官方校验器抽检 |

## 开发

```
npm test                          # 虚构数据测试
node scripts/build.mjs 0.1.0-dev.N  # 生成 dist/<版本>，再从 profile 安装
```

测试只使用虚构数据；真实病历和由病历派生的结果都不进仓库。
