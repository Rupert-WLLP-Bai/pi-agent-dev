# 企查查 MCP 接入记录

比赛项目「主体核验」维度的外部数据源。本目录记录**实际调通的接口与真实返回**，
供后续 mock adapter 与证据建模直接引用。

> 凭据只存在于仓库根目录的 `.mcp.json`（已在 `.gitignore` 中）。
> 本目录所有文件**不含 API Key**。

## 1. 平台概览

| 项 | 值 |
|---|---|
| 传输 | Streamable HTTP，JSON-RPC 2.0 |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 必需请求头 | `Accept: application/json, text/event-stream` |
| Server 数 | 10 个 HTTP Server + 1 个 stdio Server（`npx qcc-document-mcp`） |
| 端点前缀 | `https://agent.qcc.com/mcp/<domain>/stream` |

## 2. Server 清单

工具数量由 `tools/list` 实测。

| Server | 端点 | 工具数 | 用途 |
|---|---|---:|---|
| `qcc-company` | `/mcp/company/stream` | 16 | 工商登记：登记信息、股东、实控人、UBO、年报名录 |
| `qcc-risk` | `/mcp/risk/stream` | 38 | 司法与合规风险：失信、被执行、裁判文书、行政处罚… |
| `qcc-ipr` | `/mcp/ipr/stream` | 18 | 知识产权：专利、商标、软著、数字资产矩阵 |
| `qcc-operation` | `/mcp/operation/stream` | 35 | 经营状况：招投标、资质、舆情、纳税资质 |
| `qcc-history` | `/mcp/history/stream` | 0 | 历史存档，**需企业实名认证后才开通** |
| `qcc-executive` | `/mcp/executive/stream` | 44 | 人员风险：董监高司法风险、关联企业穿透 |
| `qcc-legal-regulation` | `/mcp/regulation/stream` | 6 | 法律法规 |
| `qcc-legal-case` | `/mcp/case/stream` | 4 | 司法案例 |
| `qcc-tender` | `/mcp/tender/stream` | 6 | 招投标 |
| `qcc-document` | `/mcp/document/stream` | 2 | 智能文档解析 |
| `qcc-document-mcp` | stdio（npx） | — | 同上，本地 MCP 包形态 |

`qcc-history` 返回 0 个工具，与官方「历史存档 server 需企业认证后开通」的说明一致。

## 3. 调用握手

```text
1. POST initialize            → 响应头返回 Mcp-Session-Id
2. POST notifications/initialized   （带 Mcp-Session-Id，无 id 字段）
3. POST tools/list            → 免费，不消耗积分
4. POST tools/call            → 消耗积分
```

`tools/list` 属于元数据请求，本次抓取全部 10 个 Server 的工具目录**未消耗任何积分**；
整个记录过程只发出了 **1 次 `tools/call`**。

## 4. 响应封装形态

业务数据**不是**直接返回的 JSON 对象，而是塞在 `content[0].text` 里的一段 **JSON 字符串**，
需要二次 `JSON.parse`。本次抓取未见 `structuredContent` 字段。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "{ \"企业名称\": \"…\", \"摘要\": \"…\" }" }
    ]
  }
}
```

## 5. 已捕获的调用

| 项 | 值 |
|---|---|
| Server | `qcc-risk` |
| Tool | `get_company_risk_scan` |
| 入参 | `{ "searchKey": "企业名称或统一社会信用代码" }` |
| 主体 | 小米科技有限责任公司 |
| 时间 | 见样本文件 `capturedAt` |

样本文件（`samples/`）：

- `get_company_risk_scan.exchange.json` —— 完整 JSON-RPC 交换，请求与响应原样保留
- `get_company_risk_scan.payload.json` —— 解析 `content[0].text` 后的业务 JSON
- `tools-catalog.json` —— 10 个 Server 的工具目录快照（名称、说明摘要、必填入参）

### 真实返回（节选）

```json
{
  "企业名称": "小米科技有限责任公司",
  "摘要": "已全量扫描 35 项风险因子：7 项有记录、28 项无记录。有记录：裁判文书(10218)、立案信息(8759)、开庭公告(8036)、法院公告(1339)、送达公告(1150)、诉前调解(74)、股权出质(5)。各因子明细请调用其「明细工具」。",
  "有记录因子数": 7,
  "无记录因子数": 28,
  "风险因子扫描": [
    { "风险因子": "失信信息",   "条目数": 0,     "明细工具": "get_dishonest_info" },
    { "风险因子": "裁判文书",   "条目数": 10218, "明细工具": "get_judicial_documents" }
  ]
}
```

### 三个必须沿用的格式特征

1. **摘要先导** —— `摘要` 是一句可直接交给 LLM 的结论，不要求模型自己数条目；
2. **无记录是确定值** —— `条目数: 0` 明确表示“已扫描、无记录”，不是空数组、不是查询失败。
   平台设计意图即“AI 不把查无误读成没有”；
3. **因子自带下钻工具名** —— `明细工具` 给出该维度的明细接口，天然构成
   “先扫描后下钻”的二段式，避免一次性拉全量数据。

## 6. 35 项风险因子

`get_company_risk_scan` 一次返回全部 35 项，按语义分组如下。

| 组 | 因子（明细工具） |
|---|---|
| 司法执行 | 失信信息 `get_dishonest_info`、被执行人 `get_judgment_debtor_info`、限制高消费 `get_high_consumption_restriction`、终本案件 `get_terminated_cases`、限制出境 `get_exit_restriction`、财产悬赏公告 `get_property_asset_announcement` |
| 司法程序 | 裁判文书 `get_judicial_documents`、立案信息 `get_case_filing_info`、开庭公告 `get_hearing_notice`、法院公告 `get_court_notice`、送达公告 `get_service_notice`、诉前调解 `get_pre_litigation_mediation`、公示催告 `get_public_exhortation`、劳动仲裁 `get_service_announcement` |
| 主体存续 | 破产重整 `get_bankruptcy_reorganization`、司法拍卖 `get_judicial_auction`、询价评估 `get_valuation_inquiry`、清算信息 `get_liquidation_info`、简易注销 `get_simple_cancellation_info`、注销备案 `get_cancellation_record_info` |
| 合规监管 | 行政处罚 `get_administrative_penalty`、经营异常 `get_business_exception`、严重违法 `get_serious_violation`、环保处罚 `get_environmental_penalty`、惩戒名单 `get_disciplinary_list` |
| 涉税 | 税务非正常户 `get_tax_abnormal`、欠税公告 `get_tax_arrears_notice`、税收违法 `get_tax_violation` |
| 融资担保 | 担保信息 `get_guarantee_info`、股权出质 `get_equity_pledge_info`、股权质押 `get_stock_pledge_info`、动产抵押 `get_chattel_mortgage_info`、土地抵押 `get_land_mortgage_info` |
| 股权限制 | 股权冻结 `get_equity_freeze` |
| 违约 | 违约事项 `get_default_info` |

## 7. 映射到审计域模型

主体核验结果进入系统时是 `Source Record`，**不是审计结论**：

```ts
{
  kind: "external",
  id: "qcc-risk-scan:…",
  provider: "qcc",
  server: "qcc-risk",
  tool: "get_company_risk_scan",
  subject: "小米科技有限责任公司",
  matchConfidence: 0.98,
  payload: { /* content[0].text 解析后的原样中文键 JSON */ },
  semanticResult: "已全量扫描 35 项风险因子：7 项有记录…",  // 摘要字段原样保留
  fetchedAt, expiresAt
}
```

`payload` 原样保存中文键 JSON：mock 与真实调用同构，换 adapter 时证据模型零改动。

判定策略建议（确定性规则，不由 LLM 决定）：

- **红线因子**命中 → 生成风险 finding：失信信息、被执行人、严重违法、经营异常、
  税务非正常户、破产重整、股权冻结；
- **背景因子**命中（裁判文书、立案信息等）只进入相对方档案，不单独成 finding ——
  大企业天然有大量诉讼，按数量直接判风险会大面积误报；
- **明细下钻**按需触发（`明细工具`），控制积分消耗；
- 未命中或主体歧义 → `NEEDS_HUMAN_REVIEW`，转人工。

## 8. 积分与调用纪律

- 新注册赠送 500 积分；普通用户每日赠送 100 分（当日有效）；
- 同一被查询主体每自然月消耗上限：企业 100 分、个体工商户 20 分、董监高 100 分；
- `tools/list` 不消耗积分；**本目录的记录过程只消耗了 1 次 `tools/call`**；
- 复核凭据或补抓样本前，先确认必要性。
