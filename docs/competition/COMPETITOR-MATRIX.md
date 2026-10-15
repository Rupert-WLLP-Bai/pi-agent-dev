# 竞品与开源对照矩阵（COMPETITOR-MATRIX）

> 维护人：Agent 5（Docs）。调研基准日：**2026-10-15**（本轮新增核验）；早期巡检快照 2026-09-14 见 [合同审查产品竞品调研](../research/2026-09-14-合同审查产品竞品调研.md)。
> **纪律**：只引用可点开的原始来源；厂商自述与第三方估计分开标注；没有证据的栏位写"未获取"，不用猜测填充。访问日期即本文基准日。

## 1. 调研方法与可信度分级

| 级别 | 含义 | 本文用法 |
| --- | --- | --- |
| 官方/一手 | 具体产品页、安全/支持资料、GitHub 仓库与 LICENSE/提交、论文 | 可作能力与许可依据 |
| 第三方估计 | 媒体、评测站、采购数据平台、趋势站 | 只能作参考，须标注来源与口径 |
| 未获取 | 未找到公开信息 | 明确写"未获取"，不推断 |

**共同局限**：公开资料只讲能讲的部分；"没看到某能力"是**证据缺失**，不是**能力否定**。价格随版本与谈判变化，本文不引用无来源的价格区间。**引用纪律**：具体安全/部署声明必须指向具体页面（不引用裸首页）；仓库许可必须由仓库 LICENSE 文件或徽章支撑（README 里带死链的许可声明记为"未获取"）；同名但指向 404 或不同项目的仓库不得当作代码证据。本轮已按此纪律复核，逐项修正记录在本文各表。

## 2. 商业产品对照

| 产品 | 定位（来源口径） | 部署/数据边界 | 规则治理与审计证据 | 人工复核/整改 | 成本（口径） | 访问日期 |
| --- | --- | --- | --- | --- | --- | --- |
| [Icertis ICI](https://www.icertis.com/) | 企业级合同智能平台，Copilot 基于 Azure OpenAI，agentic 工作流，对接 SAP/Salesforce/M365（官方博客） | 云交付；官方安全博客称 AES-256 静态/传输加密（**"Azure Key Vault" 系 Azure 通用能力，非 Icertis 自述，本页不归因**） | 公开资料未见"规则参数版本化 + 发布门禁"机制描述 | 有审批工作流；义务跟踪（官方博客） | 未公开标价（本页不引用无来源区间） | 2026-10-15 |
| [Ironclad](https://ironcladapp.com/) | AI CLM，workflow designer 上传 Word 模板打标签、条件审批路由；OCR 可检索仓库（官方站） | 云托管；SOC 1/SOC 2（另有 ISO 27001/17/18，见[安全页](https://ironcladapp.com/security)） | 公开资料未见参数版本门禁描述 | 工作流审批为核心 | 未公开标价（本页不引用无来源区间） | 2026-10-15 |
| [Luminance](https://www.luminance.com/) | 法律级 AI，尽调/审查，多 agent 平台（官网/新闻稿） | **提供本地部署**（[on-premise Support Datasheet](https://www.luminance.com/legal/support-datasheet-on-premise)）：数据留在客户基础设施，但该资料同时说明 on-prem **需要 "Call Home" SSH/TLS 通道**供健康检查/远程支持/补丁；SOC 2、ISO 27001（[安全页](https://www.luminance.com/security)）。"不用客户数据训练"仅见于**第三方对比文**，非一手声明 | 公开资料未见同类门禁 | 审查工作流 | 不公开标价（quote-only） | 2026-10-15 |
| [Spellbook](https://www.spellbook.tech/) | Word 内 AI 合同起草/审查（官网） | 云；CBA 合作宣称数据存加拿大境内、不用于训练（[CBA 合作新闻稿](https://finance.yahoo.com/news/spellbook-named-exclusive-ai-contract-140000903.html)） | 未见 | 审查建议驱动人工修改 | 不公开标价（第三方估计口径存疑，本页不采用） | 2026-10-15 |
| [e签宝](https://www.tsign.cn) | 电子签 + AI 合同审查/管理（高中低风险分级、自动归档）（官网） | 云 | 未见 | 签署流程内审批 | 未获取公开标价 | 2026-10-15 |
| [幂律智能 MeCheck](https://powerlaw.ai/mecheck) | 合同智能审查（PowerLawGLM4），风险提示、修改建议、法规案例推荐、审查报告、条款定位（官网） | 未获取（部署形态） | 未见 | 审查报告驱动人工确认 | 未获取 | 2026-10-15 |

> 早期巡检还覆盖 LawGeex、LegalSifter、Kira/Litera、ContractPodAi、Eigen、法大大、上上签、契约锁、华宇元典、法蝉、泛微、蓝凌、甄零、得帆、致远——分组与口径见 09-14 调研原文，本文不重复其未更新部分。

## 3. 开源项目对照（有代码/许可证据）

| 项目 | 定位 | 许可（来源） | 部署 | 可观察活跃度（2026-10-15） | 与本项目差异 | 访问日期 |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenContracts](https://github.com/Open-Source-Legal/OpenContracts) | 开源文档智能平台（DMS/agentic）：pgvector + PydanticAI 语义检索与 agent（**早期版本用 LlamaIndex**，当前依赖不含它）、引用图、人工标注、MCP | **MIT**（仓库 LICENSE + README License 节） | Docker 自托管（`local.yml`/`production.yml`）；可关遥测（`TELEMETRY_ENABLED=False`） | 活跃：1.5k★ / 194 forks / 12,989 commits | 以"检索 + 标注 + 对话"为中心；**未见**确定性规则权威、参数版本门禁、码点证据锚定与人工复核留痕链路 | 2026-10-15 |
| [bytecrunch-io/openclm](https://github.com/bytecrunch-io/openclm) | 同名开源 CLM 项目（产品名 Bytecrunch Contracts；**早期开发版本**，功能为 redlining/密封 PDF 等） | **AGPL-3.0**（仓库） | 自托管 | 低活跃：1★ / 44 commits | **与 openclm.ai 网站所述功能不一致**，是**另一个项目**；确定性规则引擎与影子治理未见 | 2026-10-15 |
| [contract-lens](https://github.com/santiago-paz/contract-lens) | 多租户 AI 合同分析：LLM 条款抽取、组织/团队管理（Next.js） | **未获取**（仓库无 LICENSE 文件、无许可徽章） | 未获取 | 活跃：2★ / 228 commits，最近提交 2026-10-12/10-15 | 多租户是其特征；规则治理与证据链未见 | 2026-10-15 |
| [terms-ai](https://github.com/nkasuku/terms-ai) | AI 合同审查 **Web 应用（Next.js）**，plain-language 分析与 redline 建议 | **MIT**（徽章 + README） | 依赖外部 LLM（`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`） | **演示级**：仅 4 commits / 10★ | 轻量工具；无治理链路 | 2026-10-15 |
| [lawbotics](https://github.com/hasnaintypes/lawbotics) | 合同分析平台，ML 条款抽取 | **未获取**（README 自称 MIT，但仓库**无 LICENSE 文件**、无许可徽章） | 未获取 | **陈旧**：26★ / 39 commits，最后提交 2025-08-11 | 抽取导向；无版本化规则门禁 | 2026-10-15 |
| [Laya](https://github.com/NandhaKishorM/laya) | 非自回归 System-1 决策引擎：choice/score/noul 单次前向，100+ 语言路由，`pip install laya`，`laya[onnx]` CPU 路径，`laya-ts` | **Apache-2.0**（徽章 + README） | 本地 CPU/GPU；TS/Node 变体 | 活跃：32.9k★ / 3.0k forks / 2,154 commits（0.4.7） | **这是本项目的影子推理依赖，不是竞品**；其"校准决策"口径需在本项目内以未校准标记约束 | 2026-10-15 |

> 许可由 Main 复核为准；许可列均标注来源（仓库 LICENSE 文件或官网声明）。`openclm.ai` 网站自述 "AGPL v3 · Self-Hosted"，但其 "View Source on GitHub" 指向的 `nxglabs/openclm` 仓库**返回 HTTP 404**，故本文不把网站功能清单当作有代码证据；上表只列可达的 `bytecrunch-io/openclm`（不同项目）。

## 4. 逐产品能力对照（按来源，未知项明写）

**说明**：本表**不**做"行业普遍如此"的整体断言。每一格只写该产品公开资料（或其仓库）能支撑的内容；资料未展示的机制写"未见公开说明"（=证据缺失，非能力否定）。价格只保留有出处的第三方口径，不采用无来源的美元区间。

| 产品 | 结论产生方式（来源） | 规则/参数治理 | 证据与复核 | 数据边界 | 主要来源 |
| --- | --- | --- | --- | --- | --- |
| Icertis ICI | Copilot 基于 Azure OpenAI 的生成式能力 + agentic 工作流（官方博客） | 未见公开说明参数版本门禁 | 审批工作流、义务跟踪（官方博客） | 云交付；AES-256、SSO、Key Vault（官方博客/第三方页） | [icertis.com/research/blog](https://www.icertis.com/research/blog/icertis-demonstrates-mass-appeal-of-ai-first-contract-intelligence) |
| Ironclad | AI CLM + workflow designer（官方站） | 未见公开说明参数版本门禁 | 条件审批路由、OCR 可检索仓库（官方站） | 云托管；SOC 1/SOC 2（官方安全页） | [ironcladapp.com](https://ironcladapp.com/)、[安全页](https://ironcladapp.com/journal/contract-management/contract-management-security) |
| Luminance | 法律级 AI，多 agent 平台（官网/新闻稿） | 未见公开说明 | 审查工作流（官网） | **提供本地部署**，合同数据不出客户基础设施；SOC 2/ISO 27001（官网博客/第三方对照） | [luminance.com 博客](https://www.luminance.com/blogs/3-pain-points-of-ai-implementation-and-how-luminance-solves-them) |
| Spellbook | Word 内 AI 起草/审查（官网/新闻稿） | 未见公开说明 | 审查建议驱动人工修改（官网） | 云；CBA 项目宣称数据存加拿大境内、不用于训练（新闻稿） | [Spellbook/CBA 新闻稿](https://finance.yahoo.com/news/spellbook-named-exclusive-ai-contract-140000903.html) |
| e签宝 | AI 合同审查：高中低风险分级、自动归档（官网） | 未见公开说明 | 签署流程内审批（官网） | 云（官网） | [tsign.cn](https://www.tsign.cn) |
| 幂律智能 MeCheck | 基于 PowerLawGLM4 的风险识别、修改建议、法规案例推荐（官网/第三方产品页） | 未见公开说明 | 审查报告 + 条款定位（官网） | 未获取部署说明 | [powerlaw.ai/mecheck](https://powerlaw.ai/mecheck) |
| OpenContracts | pgvector + LlamaIndex 语义检索 + PydanticAI agent（仓库文档） | 未见规则版本门禁 | Django 权限/多租户（仓库） | 自托管、可关遥测（仓库） | [GitHub 仓库](https://github.com/Open-Source-Legal/OpenContracts)（MIT） |
| OpenCLM | 开源 CLM：审批工作流、条款库、义务跟踪（官网） | 未见规则版本门禁 | RBAC、电子签（官网） | 自托管（官网） | [openclm.ai](https://openclm.ai)（AGPL v3） |
| Laya | 非自回归决策引擎：choice/score/noul 单次前向（仓库） | ——（本项目作为影子推理依赖） | 仓库 issue/PR 活跃 | 本地 CPU/GPU（仓库） | [GitHub 仓库](https://github.com/NandhaKishorM/laya)（Apache-2.0） |

## 5. 本项目的机制差异（对照上表可核，均有代码证据）

| 机制 | 上表可见的形态 | 本项目 | 证据 |
| --- | --- | --- | --- |
| 结论权威 | 各产品以 AI 生成/建议为主（未见"规则结论不可被模型改写"的公开机制说明） | 19 条确定性规则定结论；模型只能提议，Guard 拒绝越界 | `rule-catalog.ts`、`proposal-guard.ts` |
| 规则变更治理 | 模板库/条款库/审批流（未见参数版本 + 发布门禁） | 参数版本化（草稿/已发布/已退役）+ 发布前案例门禁 | `rules.ts` 409 路径、ADR-0003 |
| 证据结构 | 原文定位（未见"无定位不能提交"的结构约束） | 原件 hash + 块 + Unicode 码点区间；无定位不能提交 | ADR-0002、Guard 测试 |
| 人工决策 | 工作流审批 | 逐 finding 确认/误报，append-only 修订 | `findings.ts`、review-center 用例 |
| 数据边界 | 云为主（Luminance 提供本地部署，但需 Call Home 通道） | 原始/内部合同出网需已授权 origin；可全本地（fake/OCR off/影子 off） | `audit-data-policy.ts`、compose |
| 影子/辅助模型 | 上表未见同类公开机制 | 本地 Laya 影子只标记同命题冲突；未校准即标 | `decision.ts` 契约 + Laya 冒烟 |

**不宣称**："竞品没有 X"仅在其公开资料未展示该机制时成立（证据缺失口径）；不比较准确率（无可比口径）；不引用无来源的收费数字作结论。

## 6. 研究口径参考（第三方，带原始限定）

- **跨条款多跳推理是公认短板**：早期调研引用的 ACE/COMPACT（EACL 2026）报告 SOTA 模型 34–57%（该数字随任务/模型而异，未本地复现）。本文引用时保留此限定。
- **中文合同条款数据集**：早期调研提及 ProvBench/ProvData（3550 条中文条款、24850 标注、8 类合同、663 法条）。本轮仅核到 ProvBench 论文条目（ACL 2025, [aclanthology.org/2025.acl-long.312](https://aclanthology.org/2025.acl-long.312)），**未核到"ProvData/中文 3550 条"的独立一手来源**，故本文不采用该组数字作论据。
- **LLM 合同审查能力上限**：早期调研引 ContractEval（2025）"多数大模型约相当于初级法务助理"；本轮未复核原文，标注为待复核引用。
- **CUAD 不适合本场景**（英文、美国法域、并购尽调标注体系，无数值阈值标注）——该结论在 09-14 调研已论证，本文维持。

## 7. 结论（对外可用口径）

1. 我们的差异化在**机制约束**（规则权威、版本门禁、证据锚定、留痕、本地部署），不在模型能力。
2. 商业强项在全生命周期与企业集成；我们的强项在**可解释、可复现、可本地**的单点深度。
3. 开源项目各有侧重（检索/CLM/多租户/轻量工具）；**"确定性规则 + 受控 Agent + 影子治理 + 证据链"的组合未在检索范围内见到同等实现**——此为证据缺失口径，非能力否定。
