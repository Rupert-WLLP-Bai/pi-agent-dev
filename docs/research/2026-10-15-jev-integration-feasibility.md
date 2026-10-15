# Laya 优先接入与 Jev 兼容性研究（2026-10-15）

> 访问基准日：2026-10-15。本文所有外部结论仅依据下列官方一手来源（官方文档、官方博客/企业页、官方法律页、官方 GitHub/npm/PyPI 包、Laya 固定 SHA 源码）。
> **本轮完成公开资料与源码核对、官网 FAQ 交互和只读环境检查；未调用 Jev 推理、未下载模型、未启动 Laya、未运行应用 build/lint/test。** 接入建议尚未实施。
> 证据分级：`[文档]` = 官方声明；`[代码]`/`[静态]` = 源码事实；`[本轮观测]` = 本轮直接检查结果；`[上游测量]` = 项目方报告且未经本项目复测的指标；`[INFERENCE]` = 设计判断。

---

## 1. 结论摘要（先看这里）

**结论：根据用户最新偏好，优先验证 Laya 本地 CPU 影子接入；Jev 托管 API 仅作为可选的合成数据对照。**

1. **Jev 是托管 API 的"结构化决策函数"，不是 LLM 的等价替代品。** 官方明示：输入 `state`（string/JSON 对象/数组）+ 一组 typed `questions`，输出每个问题一个 typed 答案（`choice` / `score` / `noul`），**不生成文本、不做 chat、不调用工具**（`[文档]` coding-agents 页直接说"Jev is not a drop-in replacement for the LLM behind Claude Code…"）。因此"把 Jev 填进 OpenAI base URL"在语义上不成立。
2. **Jev 当前不支持本地部署**：本轮实际展开 Enterprise FAQ，原文为“No. Jev is currently available only through our hosted API.”；数据处理位置为“All data is currently processed in the US.”。SDK 的 MIT 许可只覆盖客户端代码，不能推导出模型私有部署授权。
3. **中文与合同领域可靠性尚未建立**：官方 Models 页说明英文为主要训练语言，CJK 可处理但表现不均等，需要自测。本轮查阅资料未找到中文合同审计的独立验证；公开 workflow evals 不能替代本项目标注集。
4. **兼容接口不代表决策语义相同**：固定 SHA 的 Laya 源码证明 strict 模式只裁剪字段、不重算 `confidence`；其值为 `1 − H(p)/log(k)`，不同于 Jev 的公式。必须保存原始概率、置信度类型和校准状态，不能共用阈值。
5. **[INFERENCE] 技术接入可行，推荐先做非阻断影子 PoC。** 本轮尚未证明本机推理、中文任务质量或资源开销达标；正式规则结论、Pi、Guard 与不可变快照保持原有职责。

---

## 2. API 契约（官方文档，访问日 2026-10-15）

来源：<https://docs.typesafe.ai/api>、<https://docs.typesafe.ai/introduction/quickstart>、<https://docs.typesafe.ai/models>、<https://docs.typesafe.ai/confidence>。

### 2.1 端点与鉴权

| 项 | 官方值 |
| :- | :- |
| Base | `https://api.typesafe.ai`（SDK 默认 `DEFAULT_BASE_URL`，`[代码]` Python SDK constants） |
| Endpoint | `POST /v1/systemone`（唯一推理端点；另有 `GET /v1/models` 列模型） |
| 鉴权 | `Authorization: Bearer <TYPESAFE_API_KEY>`，JSON `Content-Type` |
| 压缩 | 可选 `Content-Encoding: gzip/x-gzip/zstd`，单层，zstd window ≤ 8 MiB |

### 2.2 请求体

顶层三字段：`state`（string | object | array，必填）、`model`（必填）、`questions`（map<自定义id, Question>，必填）。**question id 不送给模型、不参与推理**，仅作为回答键回显。

Question 三类型（均需 `type` + `instructions`）：

- `noul`：是非问句 → 回答 `noul`（0–1 概率）。可选 `criteria.{true,false}` 描述 yes/no 含义。
- `choice`：`criteria` 为 map<option, 描述|null>，**最多 255 个选项**。回答 `choice`（最高概率项）+ `probabilities`（和为 1）+ `confidence`。
- `score`：`criteria` 为**有序** level 描述数组，**至少 2 级、最多 10 级**。回答 `score`（概率加权，可落在级间）+ `legend` + `probabilities` + `confidence`。

请求规则：body ≤ **32 MiB**（超限 413）；UTF-8 无 BOM；`state`/`instructions`/`criteria` 各自嵌套 ≤ 64 层；仅限有限数（`NaN`/`Infinity`/`1e400` 拒绝）。

### 2.3 响应体

下例仅说明响应结构，数值不是本轮实际调用结果。

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": { "type": "choice", "choice": "technical",
                    "confidence": 1.0,
                    "probabilities": { "technical": 1.0, "billing": 0.0, "sales": 0.0 } },
    "frustration": { "type": "score", "score": 0.67,
                     "legend": { "0": "...", "1": "...", "2": "..." },
                     "probabilities": { "0": 0.33, "1": 0.67, "2": 0.0 }, "confidence": 0.5 },
    "is_urgent": { "type": "noul", "noul": 0.99 }
  },
  "usage": { "input_tokens": 428, "output_tokens": 73 }
}
```

注意：**noul 回答没有 `confidence` 字段**（官方 confidence 页明确说明），若要与 choice 同一尺度可自算 `|2p-1|`。

错误码：`400`（含 `max_tokens_exceeded`）、`401`、`413`、`415`、`422`、`429`、`529`。

### 2.4 概率/置信度语义（官方 confidence 页，公式级）

- **概率 `probabilities` 是原始分布**；`confidence` 是从分布形状导出的单一数字（0–1），不是独立测量。
- Choice：`confidence = (p_max - 1/n) / (1 - 1/n)`。只取最大项，(0.6,0.3,0.1) 与 (0.6,0.2,0.2) 同为 0.4。
- Score：`confidence = max(0, 1 - Σ p_i|i-m| / MAD_unif)`，考虑级别距离；官方举例 (0,0.5,0.5)→0.25，(0.5,0,0.5)→0。
- Noul：无 `confidence`；`p≈0.5` 即"不确定"。
- 官方口径："calibrated across groups of predictions; does not guarantee an individual answer is correct"（System One 概念页）。**这是"组级校准"不是逐题正确性承诺。**
- 官方建议用法：低置信不动/送人、中置信谨慎、高置信自动执行；阈值按风险分级，并明确"correct threshold values depend on your domain… test with your own data"。

### 2.5 长度/批量/速率/版本约束（Models 页）

| 项 | 值 |
| :- | :- |
| 模型（访问日） | `jev-1.14.0`（2026-10-14 发布）与 `jev-1.13.0`；别名 `jev-latest`→**1.13.0**（最新 stable）、`jev-preview`→**1.14.0** |
| 价格 | $0.042 / M input tokens（$42 / B tokens）；**output tokens 免费** |
| 上下文 | 默认 64k per-request、32k per-question；长上下文需 `TypeSafe-Danger-Zone-Long-Context: true`，两侧均升至 262k，但官方称"更慢且更不准" |
| 问题数 | **无独立上限**，只要同时满足两个上下文限制 |
| Choice 选项 | ≤255；Score levels 2–10 |
| 速率 | 按组织，tokens/s 与 requests/s 双限；超限 `429`；更高限额需联系 sales（`sales@typesafe.ai`） |
| 别名漂移 | 别名随发布移动，答案可变；响应 `model` 字段返回具体版本 ID；官方建议：若已按某版本调阈值，**发版本 ID 而非别名** |
| 微调 | Jev 不用客户数据 fine-tune/LoRA，"same weights serve every account"；领域适配只通过 `state`/`instructions`/`criteria` |
| 输入模态 | 仅文本（另有 experimental images/box，需 `TypeSafe-Danger-Zone-Images`，**本项目不纳入范围**） |

### 2.6 TS SDK 是否必需

- **非必需。** 官方 Bash/curl 示例即完整 HTTP 契约（§2.1–2.3）。Python/JS SDK 只是便利层。
- 官方 JS SDK：`@typesafe-ai/sdk` npm 0.7.0（2026-10-14），MIT，**engines: node >=22，零运行时依赖**（`[代码]` registry.npmjs.org）。v0.7.0 起对 ≥1 KiB body 默认 zstd 压缩（仅 Node ≥22.15；Bun 等 runtime 未压缩），可用 `compression: false` 关闭；v0.7.0 breaking：要求 Node ≥22、不再导出 request payload 类型。
- Python SDK：`typesafe-sdk` PyPI 0.7.5，requires-python ≥3.10；默认 `jev-latest`、base URL `https://api.typesafe.ai`、单次 HTTP 超时 10s；默认重试 2 次，重试 `408/429/5xx`，尊重 `retry-after`。
- `[INFERENCE]` 对本 Bun/TS 项目：优先**原生 fetch + 未压缩 JSON 最小契约**（只取 noul/choice/score 文本三 primitive 的共同子集），避免承担 SDK 的 zstd/Node 版本/重试策略差异；需要类型推导时再评估 0.7.0。

---

## 3. Jev 托管服务 vs Laya 自托管兼容服务

### 3.1 Jev 托管（官方证据）

| 维度 | 官方证据（访问日） |
| :- | :- |
| 部署形态 | Enterprise FAQ：“No. Jev is currently available only through our hosted API.”（本轮浏览器展开核实） |
| 数据位置 | "All data is currently processed in the US."（同上） |
| 训练 | Models 页："Jev is not trained on customer requests or responses."；MCA §4.1：不将 Customer Data 用于训练（改权重）除非事先同意；§4.3 Telemetry 可无限制处理 |
| 零留存 | Enterprise FAQ："Yes. Zero data retention is available to companies on request. Contact sales@typesafe.ai to enable it."；**ZDR 需申请启用，非默认**；DPA Schedule I §8 留存为"按处理目的与法律必要期"，无固定天数 |
| 合规 | Enterprise 页 SOC 2 Type II（Trust Center 申请报告）；MCA 仲裁条款、加州法；隐私政策：EEA/UK 用户数据转移至美国 |
| 速率/价格 | 见 §2.5；更高限额与定制走 sales@typesafe.ai；MCA §8 采用 credits 预付模式 |
| 合同领域 benchmark | **未找到**。官方 workflow evals（evals.typesafe.ai）四个域：security incidents、agent trace observability、invoice processing、customer service；参考标签由 GPT-6 Astra 与 Claude Fable 5.1 共识生成（官方自述存在偏向 OpenAI/Anthropic 的偏差）。**均非合同/法律审查。** |
| 中文保证 | Models 页 Language support：English 主训练、准确率最好；CJK"handled but not equally well"，要求自测。**无任何中文准确率数字。** |
| 模型卡/权重 | 未找到任何可下载开放权重或本地推理包的官方页面；官方仓库组织仅有 SDK/skills 类客户端代码（`[代码]` GitHub typesafe-ai/typesafe-sdk-js 公开仓库为"official TypeScript/JavaScript library for the TypeSafe API"，MIT） |

> 重要区分：**SDK 的 MIT 许可只覆盖客户端代码，不覆盖模型权重、不覆盖私有部署授权、不覆盖商业服务授权。** MCA §2.3 还禁止蒸馏/竞品开发/逆向。Laya 的 Apache 2.0 是另一主体（Convai Innovations）的另一许可，二者不可互推。

### 3.2 Laya 自托管兼容（固定 SHA 源码）

- 版本锚点：源码 `pyproject.toml` 为 `0.4.7`，commit 为 `432312b36714d8889eba405507b37eda25257d9c`；要求 Python ≥3.10，核心依赖 torch 等，`serve` extra 增加 FastAPI/Uvicorn 等。该源码版本尚未在本机部署验证。
- multilingual 权重 revision `1720e3e3357cfe1e281542e223f8273b0890ca34`（HuggingFace `convaiinnovations/laya-multilingual`）。
- 兼容面：提供 `/v1/systemone` 文本决策接口与 `LAYA_JEV_STRICT` 字段投影。Laya 请求应显式选 `model: "multilingual"`，不能假设 Jev 的版本 ID/别名都映射到同样权重；记录服务实际使用的模型与 revision。
- **关键代码事实（`[代码]`，固定 SHA）**：
  - `laya/serve.py` `_project_jev_strict`：只裁剪字段保留 Jev 契约字段；**`confidence` 直接透传 Laya 原值，不重算**；strict 会丢掉 Laya 的 `answer_confidence`/`action`/`routing` 等扩展字段。
  - `laya/common.py::confidence_from_probs` 明确计算 `1 − H(p)/log(k)`，是分布集中度而非正确率。`laya/confidence.py` 将其与 `answer_confidence = max(p)` 区分；`jev_confidence()` 另按 Jev 公式计算 `x_jev_confidence`，strict 投影会丢弃该扩展。源码有阈值选择率差异的警告，但本项目未测量差异幅度。`laya-multilingual` 出厂未拟合温度，任何概率都须在独立数据上验证校准。
  - `[INFERENCE]` 即"wire 兼容 ≠ 概率语义兼容 ≠ 阈值兼容"。
- Laya 自有声明（README，属其项目方宣传，非 TypeSafe 官方、亦非本项目实测）：typed-decisions benchmark 0.766 vs base 0.362、100+ 语言、33ms/问。**不得当成本项目或 Jev 的实测结论。**

---

## 4. 中文与合同域支持核实

- 就 Jev 而言，官方 Models 页要求非英文场景自测；本轮查阅材料未找到中文合同任务的质量保证。Laya 的中文模型、未校准概率及历史否定句风险也必须单独验证，不能由支持中文推导准确率。
- 官方 jaggedness 页（`jev-1.13`，last reviewed 2026-10-02）列出的失效模式与中文/合同审查高度相关（`[文档]`，仅针对 1.13，**未证明 1.14 相同**）：
  1. **字面阅读**：作用域词、否定、隐含条件按字面读（双重否定/间接更差）；
  2. **数值与计数不可靠**：不要模型计数，代码数；
  3. **日期按文本读**，不做时间比较/窗口判断；
  4. **大 state 含无关细节会掉准确率**（context rot）；
  5. **对抗性 state 会影响答案**（注入指令、误导框定、自证分类）；
  6. **instructions 与 criteria 矛盾会混淆**；
  7. **Choice 选项顺序可能影响答案**（偏向靠前选项），需重排复查。
- 与本地 `packages/audit` 的 19 条确定性规则（`rule-catalog.ts` ENGINE_RULE_CODES）对照：`[INFERENCE]` Jev 可覆盖的恰是上述清单之外的"语义判断"型问题（如条款是否存在某类安排、文本是否表达某意图、严重程度档位），而比例/天数/金额一致性、日期先后、计数等应留在代码（这也正是官方建议）。

---

## 5. 本地架构事实与接入边界（静态依据）

以下来自当前工作区源码核对，不等于本轮运行验证：

1. `packages/pi-agent/src/config.ts:52-65`：`buildModel` 固定 `api: "openai-completions"`；providers 探测走 `apps/api/src/llm/provider-client.ts:66 GET {endpoint}/models`。→ Jev 不是 chat/tool-calling 替代，**不能加入现有 LLM Providers 页**。
2. `packages/audit/src/ports.ts:41-45`：`AuditAgentPort.run` 返回含 `FindingProposal[]` 的 `AgentRunResult`；`rule-catalog.ts:11-31` 注册19条规则；`proposal-guard.ts:218+` 要求评估 ID 与规则契约授权。→ P0–P2 的模型输出独立记录为观察，不能直接成为 Fact、风险 Evidence、Rule Assessment 或 Finding。
3. `apps/api/src/dispatcher.ts:211-241`：先 `finishAgentRun`，再逐条 `appendFindingRevision`，最后写 `COMPLETED/AWAITING_REVIEW`；**非单一总事务**。→ 影子链路不能把 `await` 推理放进该 try 块，否则异常会走 FAILED 路径污染正式状态。
4. `apps/api/src/sse.ts:4-29`：进程内 `Map` 事件，不是可靠任务队列；`audit-queue.repository.ts:39-64` 的 PG `SKIP LOCKED` 队列只认 `audit_cases.status='PENDING'`。→ 不宜复用作语义 decision 任务队列。
5. `apps/api/src/db/schema.ts:194-209`：`agent_runs` 只有 id/auditCaseId/provider/model/version/usage/durationMs/error/createdAt，**无 finishedAt、无独立 audit_run_id 实体**；不能把 `auditCaseId` 当 AgentRunId。幂等键应含 case/snapshot/agent-run、clause id、input hash、模型 revision、question/policy/redaction/calibration 版本。
6. `X-Operator` 目前是本地偏好而非认证/RBAC/多租户；make 三入口、StorageService、严格环境隔离属上一轮 spec 规划，**不得称已实现**。
7. B/C 对照若涉及同一 Pi 输出重放，必须固定/重放同一输出与上下文，**不能独立重跑两次非确定性模型再归因**。

---

## 6. 两路径对比与设计建议

### 6.1 路径 A：Jev 托管 API（云）

- 形态：`POST https://api.typesafe.ai/v1/systemone`，Bearer key，Bun 原生 fetch 最小契约（§2.6）。
- 优势：类型安全、并行问题、成本低（$0.042/M input，output 免费）、官方 70ms–500ms 端到端声明（`[文档]` 博客，非本项目实测）、无权重运维。
- 约束/风险：仅托管、数据在美、ZDR 需申请、速率按组织限额、别名漂移（生产应锁版本 ID）、英文优先、合同域无官方 benchmark、MCA 禁止蒸馏/逆向/安全测试（§3.1）。
- 适配建议：作为**独立观察 worker**，输入只用已持久化的成功业务快照；输出写独立 PG 表；阈值与概率原始值一起落库。

### 6.2 路径 B：Laya 自托管 Jev 兼容服务

- 形态：`laya[serve]` + multilingual 权重 revision `1720e3e3…`，本地 HTTP `/v1/systemone`。
- 优势：可将推理置于内网或本机；模型受控下载并校验缓存后，可验证离线运行。多语权重提供中文路径，可微调；本轮已核对代码与多语模型元数据的 Apache-2.0 标识。
- 约束/风险：strict 不改变 `confidence` 公式；多语权重未拟合温度。默认 `max_len=1024`，超预算输入可能被截断；多语模型可配置到8192 tokens，但全合同直接输入的质量与CPU开销均需实测。应用应限制/分片输入并记录截断，不能默默把首窗当全文。
- 适配建议：持久化 `provider`、`model_revision`、原始概率、`confidence_type`（如 `jev_formula`、`laya_entropy_concentration`、`answer_confidence`）和 `calibration_status`。公式相同也不代表模型分布校准相同，阈值必须按模型、问题和版本验证。

### 6.3 接入边界（综合两路径，`[INFERENCE]` + 本地静态约束）

- **不进正式链路**：不并入 `buildModel`/providers；不改 `AuditAgentPort` 返回值类型；decision 不得转 `FindingProposal`（受 `assertProposalLegal` 约束，§5.2）。
- **不进 dispatcher try 块**：在已持久化成功业务状态（snapshot/assessment 已落库）之后，由独立 worker 派生观察；补偿靠独立扫描而非 SSE 事件（§5.3–5.4）。
- **持久化**：独立 `shadow_jobs` 表 + worker，不新增对 `audit_cases PENDING` 队列的语义依赖；若采用 Outbox，必须显式记录"写入失败不拖正式链"的取舍，且不能把现有进程内 broker 当可靠队列。
- **可重放**：B/C 对照固定同一 Pi 输出与上下文（§5.7），避免非确定性归因。
- **脱敏与版本**：input hash、redaction 版本、question/policy 版本、模型 revision 全部入幂等键与记录（§5.5）。
- **身份关联不能猜测**：现有 `agent_runs` 没有 snapshot 外键。新增任务须冻结确切的 snapshot/Agent Run、有效上下文与输入引用，补齐关联依据；不能用“当前最新快照”倒配历史运行。独立扫描只能在成功状态与上下文关联均可证明时派生任务。
- **最小 Interface**：独立 `DecisionProvider.decide(request, signal)` 承载受限问题、状态与概率校验；Laya/Jev HTTP 细节留在 Adapter。优先作为 `apps/api` 内 Module，不为单一调用方新增大型平台或替换 Pi。
- **开关与失败**：仅 `off|shadow`，默认 off；off 不新建/领取推理任务，历史记录仍可读。影子队列、并发、超时和重试有界；服务错误不伪造正常答案，也不使正式审计失败。影子人工复核独立追加，不写回 Finding 状态。
- **证据与冲突**：脱敏文本保留原文引用和独立映射，Unicode 码点 offset 不重写。分类与付款比例结论通常不可比较；只有对同一命题、同一依据的互斥判断才记录冲突，模型概率本身不是违规证据。

---

## 7. 风险与阻塞清单

| # | 风险/阻塞 | 依据 | 缓解 |
| :- | :- | :- | :- |
| R1 | 中文准确率未知，否定句/字面阅读风险 | §4 jaggedness `[文档]` | 自建中文合同问题集盲测后再定阈值 |
| R2 | 概率语义跨 provider 不等价 | §3.2 Laya `[代码]` | 存原始值 + confidence_type + calibration_status |
| R3 | 跨 provider 阈值的尺度与校准不同，差异幅度未测 | 两方 confidence 公式与 Laya 源码警告 | 分模型、问题和版本验证，不套用固定倍率 |
| R4 | 对抗性/注入 state 可改变答案 | jaggedness `[文档]` | state 视为不可信数据；criteria 明确；上线前对抗测试 |
| R5 | 别名漂移导致答案/阈值静默变化 | Models 页 `[文档]` | 生产锁版本 ID；记录响应 `model` 字段 |
| R6 | 数据出境与合规（美国处理、ZDR 需申请） | Enterprise FAQ/DPA `[文档]` | 决策前走商务/合规；敏感内容先脱敏 |
| R7 | MCA 限制（禁蒸馏/逆向/安全测试） | MCA §2.3 `[文档]` | 合规评审；不做渗透/逆向 |
| R8 | 速率/429/529 与重试放大 | API reference `[文档]` | 指数退避 + 尊重 retry-after；影子链路限流 |
| R9 | 数值/日期/计数不可靠 | jaggedness `[文档]` | 计算留代码，模型只做判断 |
| R10 | 本地授权/多租户未就绪（X-Operator 非认证） | §5.6 `[静态]` | P2 前不假设授权完备 |
| R11 | 无合同域官方 benchmark，无法外部验证 | §3.1 `[文档]` | 以本项目 golden/影子对照替代 |

---

## 8. 最小 PoC 验收标准（建议，未实施）

以下是后续实施验收；本轮未执行。Laya 本地 PoC 无需 Jev key；Jev 对照另需有效账号与明确的数据访问授权。

1. **本地 CPU 与契约**：独立服务只加载所需多语权重，固定代码/权重 revision，配置鉴权与内部网络；用短中文合成条款跑通 choice/score/noul。健康探针和推理成功分别验证；不使用 Laya batch 扩展作为通用 Jev 契约。
2. **关闭与故障隔离**：验证 off 零请求，影子超时、4xx/5xx、坏JSON、NaN/越界概率、重复任务、积压和重启均可观测，正式审计保持可用。
3. **数据集**：初始30条（含否定/例外）仅作接口 smoke，不能代替附件要求的至少100条独立标注评测。开发、校准与测试集按合同/模板分组隔离，LLM弱标签不当金标准；不足则报告实际样本数与不确定性。
4. **质量与性能**：记录 Macro F1、各类Precision/Recall、混淆矩阵、漏检、拒判、Brier/ECE、校准前后和负例子集；另测P50/P95/P99、冷/热启动、CPU/RSS与主链开销。校准只用校准集，测试集不参与拟合；影子阶段不启用自动路由阈值。
5. **零干扰对照**：B/C 固定同一上下文与Pi输出，再比较规范化正式结果；快照、规则结论、Finding/复核状态不被观察写入改变。独立扫描可恢复遗漏，关闭或停止Laya后主流程仍完成。
6. **留证与界面**：记录输入hash、redaction/question/policy/calibration版本、模型revision、原始概率和状态；界面标明“辅助建议/未校准”，授权检查不能依赖可自由填写的 `X-Operator`。

---

## 9. 未实测/未知清单（显式）

- 未调用 Jev 推理；未启动 Laya，未完成真实中文模型调用。源码、网页与环境检查不能证明推理通过。
- 未测量：中文准确率、合同域准确率、置信度校准、延迟、成本、Laya 本地吞吐/长文档表现、Laya–Jev 概率分布差异幅度。
- 未知：Jev 1.14 是否同样存在 1.13 的 jaggedness（官方页只标注 1.13）；Jev 是否有任何开放权重计划；中文/合同领域是否有官方路线图。
- 未核实：Console 申请细节、具体商务报价/credits、SOC 2 报告正文及BAA。Enterprise 折叠FAQ已实际核实三项：不支持VPC/on-prem、数据在美国处理、ZDR可申请启用。

---

## 10. 来源清单（均访问 2026-10-15）

官方 TypeSafe：
- <https://docs.typesafe.ai/api>（API reference：端点/字段/规则/错误码）
- <https://docs.typesafe.ai/models>（模型/别名/价格/上下文/速率/语言/数据）
- <https://docs.typesafe.ai/confidence>（概率/confidence 公式）
- <https://docs.typesafe.ai/model-jaggedness/jev-1.13>（1.13 失效模式，last reviewed 2026-10-02）
- <https://docs.typesafe.ai/concepts/system-one>、<https://docs.typesafe.ai/concepts/state>、<https://docs.typesafe.ai/primitives/noul>、`/primitives/choice`
- <https://docs.typesafe.ai/introduction/quickstart>、<https://docs.typesafe.ai/introduction/coding-agents>
- <https://docs.typesafe.ai/sdk/javascript>、`/sdk/javascript/changelog`、<https://docs.typesafe.ai/sdk/python>、`/sdk/python/api/retries`、`/sdk/python/api/constants`
- <https://docs.typesafe.ai/patterns/fan-out>、<https://docs.typesafe.ai/cookbooks/llm_guardrails>
- <https://typesafe.ai/blog/introducing-system-one-models-and-jev>（发布博客，含 FAQ 标题）
- <https://typesafe.ai/enterprise>（企业页；本轮通过独立浏览器展开三项FAQ）
- <https://typesafe.ai/legal/mca>、<https://typesafe.ai/legal/data-processing>、<https://typesafe.ai/legal/privacy-policy>、<https://typesafe.ai/legal/acceptable-use-policy>、<https://typesafe.ai/legal/terms>
- <https://evals.typesafe.ai/>（官方 workflow evals）
- <https://github.com/typesafe-ai/typesafe-sdk-js>、<https://registry.npmjs.org/@typesafe-ai/sdk>（0.7.0 / MIT / node>=22 / 0 deps）

Laya（另一主体，固定 SHA）：
- [serve.py](https://github.com/NandhaKishorM/laya/blob/432312b36714d8889eba405507b37eda25257d9c/laya/serve.py)：strict字段投影、HTTP服务。
- [common.py](https://github.com/NandhaKishorM/laya/blob/432312b36714d8889eba405507b37eda25257d9c/laya/common.py#L771)：`confidence_from_probs`实际公式。
- [confidence.py](https://github.com/NandhaKishorM/laya/blob/432312b36714d8889eba405507b37eda25257d9c/laya/confidence.py)：answer_confidence与Jev公式辅助值。
- [README](https://github.com/NandhaKishorM/laya/blob/432312b36714d8889eba405507b37eda25257d9c/README.md)、[pyproject](https://github.com/NandhaKishorM/laya/blob/432312b36714d8889eba405507b37eda25257d9c/pyproject.toml)：部署、截断、校准限制及依赖。
- [多语模型元数据](https://huggingface.co/api/models/convaiinnovations/laya-multilingual)：Apache-2.0标识、权重revision `1720e3e3357cfe1e281542e223f8273b0890ca34`。

本地静态依据：
- `packages/pi-agent/src/config.ts:52-65`、`apps/api/src/llm/provider-client.ts:66`
- `packages/audit/src/ports.ts:41-45`、`packages/audit/src/rule-catalog.ts:11-31`、`packages/audit/src/proposal-guard.ts:218+`
- `apps/api/src/dispatcher.ts:211-241`、`apps/api/src/sse.ts:4-29`、`apps/api/src/db/repositories/audit-queue.repository.ts:39-64`、`apps/api/src/db/schema.ts:194-209`

---

## 11. 当前环境与验证边界（只读核实，2026-10-15）

本轮只读环境核实结果（未启动容器、未安装依赖、未下载权重）：

| 项 | 观测值 | 含义边界 |
| :- | :- | :- |
| `docker compose version` | v5.5.1 | 具备容器化 PoC 的编排工具条件 |
| `docker version --format '{{.Server.Version}}'` | 29.8.2，daemon 可达 | 引擎可用；**不等于**有容器配额/拉取额度 |
| `free -m` | 总内存 32098 MiB，当时 available 28199 MiB，swap 8192 MiB | 有内存余量；**不等于** CPU 推理吞吐/时延已验证 |

**明确边界**：以上仅说明"具备容器 PoC 的基本条件"，未验证依赖可下载、模型权重可拉取、CPU 推理可行性与时延。Laya 的 33ms/问等数字均来自其 README 自述（T4 实测语境），**不能迁移为本机 CPU 实测**。

---

## 12. 最终结论与阶段建议（收敛）

**收敛结论：Laya 优先、本地 CPU 影子接入；Jev 托管 API 仅作为可选的合成数据对照。**

- **为什么Laya优先**：支持本地CPU部署，代码和多语模型有Apache-2.0标识，可避免Jev托管的跨境传输与账号依赖。仍需受控下载、依赖锁定、网络隔离、资源限流和真实离线验证；中文合同质量尚未建立。
- **为什么Jev仅可选对照**：仅托管、数据在美国、ZDR需申请且英文优先。其响应不是金标准；未经相应授权，不使用Jev输出训练或蒸馏Laya。所有模型以独立人工标注集评测。
- **strict字段兼容不等于confidence等价**：strict透传Laya原生统计值；保存原始概率、类型与校准状态，按实际数据验证。来源中的阈值倍率警告不当作本项目实测。
- **本轮未测项**：CPU 吞吐/内存占用/真实推理时延、中文合同任务准确率与校准、两 provider 概率分布差异幅度——均未实测（§9）。

**最小阶段路线（不建议一步到位）**：

1. **阶段 0（provider seam）**：新增独立 decision provider 抽象与本地 HTTP 客户端（Bun fetch 最小契约），不并入 `buildModel`/providers 页、不改 `AuditAgentPort`（§5.1–5.2 `[静态]`）。
2. **阶段 1（可控本地 CPU synthetic smoke）**：以合成/脱敏样本在本地 CPU 跑通 noul/choice/score 三 primitive，记录吞吐、内存、时延与 `confidence_type`；**不接真实合同数据、不接正式链路**。
3. **阶段 2（独立 shadow、非阻断）**：独立 PG `shadow_jobs` 表 + worker，在已持久化成功业务状态后派生观察；不进 dispatcher try 块、不依赖 SSE 事件、补偿靠独立扫描；不改原业务结论/快照（§5.3–5.4、§6.3 `[INFERENCE]`）。
4. **阶段 3（dataset 与标定）**：中文合同问题集 + 人工标注 → accuracy 与分桶校准 → 分 provider 阈值；B/C 对照须重放固定 Pi 输出（§5.7）。
5. **阶段 4（治理 UI）**：仅在 1–3 达标后考虑；且不得假设 `X-Operator` 即认证/RBAC/多租户（§5.6）。
