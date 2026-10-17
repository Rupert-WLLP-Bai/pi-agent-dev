# 创新与自主模块证据（INNOVATIONS）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。
> **纪律**：本项目的创新是**工程集成与治理机制**，不是自研基础模型。每一项创新必须能指到代码、测试或演示行为；没有证据的只写进"规划"。

## 1. 自主模块 vs 第三方组件

| 层 | 自主实现（本仓库） | 第三方/外部 | 边界说明 |
| --- | --- | --- | --- |
| 领域规则 | 19 条确定性规则、Fact Builder、Contract Stance、Proposal Guard、金额链引擎 | —— | 纯 TypeScript，无模型调用；`packages/audit` |
| Agent 编排 | 六工具白名单、指令/资源隔离、轨迹映射、提交边界 | Pi SDK `@earendil-works/pi-coding-agent@1.2.0` | 我们拥有工具契约与 Guard；不修改 SDK 裁决逻辑 |
| 推理 | ——（不训练模型） | OpenAI 兼容网关（Pi 用）、本地 Laya（影子用） | 模型可替换；结论不依赖单一模型 |
| 存储 | original-store 适配（S3/本地降级）、locator 语义 | RustFS（S3 兼容）、PostgreSQL、Redis | 领域不依赖具体厂商 |
| OCR | 可插拔 `OcrPort`、栅格化、几何取舍（不带 bbox） | 视觉模型（网关）、MinerU 4.x 服务 | 我们拥有锚定策略与降级语义 |
| 界面 | 全部页面与交互（**无登录/访问门页面**：认证已延期） | React/Ant Design/TanStack | —— |
| 测试与治理工装 | 分层测试入口/机器报告/故障注入、demo 环境保护与备份恢复 | —— | —— |
| 基础设施 | compose（镜像 digest 固定、端口默认 localhost）、迁移、种子、受管演示 CLI、CI | Docker、GitHub Actions | —— |

**明确不做/未做**：不自训模型、不微调、不建向量库/RAG、不引入消息队列/K8s/OTel、不做 SSO/RBAC/多租户、不做多副本调度。这些是范围决策，不是缺陷隐瞒——理由见 FAQ。

## 2. 创新点逐条证据

### 2.1 规则参数版本治理 + 发布前案例门禁

- **是什么**：规则逻辑是确定性代码；可版本化、可发布的是**参数集**（阈值、立场分档）。草稿必须跑过黄金案例验证才能发布；已发布版本不可变，快照记录所用版本。
- **为什么是创新**（相对公开资料）：把"规则可配置"从"改代码/改数据库行"升级为带状态、带门禁的版本对象——**没过验证就发不出去**。
- **证据**：`apps/api/src/routes/rules.ts`（publish 门禁 409 路径）、`packages/audit/src/golden-eval.ts`、ADR-0003、`tests/acceptance/rules.spec.ts`。
- **演示点**：新建草稿 → 跑验证失败被拒 → 修正 → 通过 → 发布；旧案件仍引用旧版本。

### 2.2 证据锚定：码点区间 + 多来源 Source Record

- **是什么**：`DocumentSpanLocator` = 原件 hash + blockId + Unicode 码点 `[startOffset, endOffset)` + quotedText；主体核验响应也是 Source Record，证据可引自合同之外。
- **证据**：`packages/audit/src/model.ts`、ADR-0002、`proposal-guard.ts` 对无证据提交的拒绝测试。
- **演示点**：提交一条不带证据定位的提案 → 被 Guard 拒绝（把拒绝路径演出来）。

### 2.3 受控 Agent：白名单工具 + 代码强制的提交边界

- **是什么**：Pi 只有六个工具（读规则评估/证据/全文/搜索/块读/提交提案）；无 shell、无任意文件写、无任意 HTTP；提交受 Guard 校验；资源发现（skills/插件/主题）关闭。
- **证据**：`packages/pi-agent/src/tools.ts`、`11c5cf9` 的运行协议回归（断言实际 HTTP 请求中的工具集合与指令隔离）、Pi 1.2 升级记录。
- **演示点**：轨迹页展示真实工具调用与嵌套调用（`get_rule_assessments` 真实发起嵌套 `get_evidence`，ADR-0004）。

### 2.4 跨文档金额链核对（卷宗级）

- **是什么**：xlsx/docx/pdf 混合卷宗的跨文档数字比对（收入/支出背靠背、金额链一致、需求链），无状态、不落库，定位到单元格地址与条款。
- **证据**：`8b7a8fa`、`bf14a2b`；合成卷宗实测（冷启动 0.56 s、核对 3 项、标记 2 处手工合计，见 ICT 调研 §6）。
- **演示点**：上传 1 个 xlsx + 2 个 docx 合成卷宗 → 端到端跑出比对结果。

### 2.5 影子决策层：本地模型只建议、不裁决

- **是什么**：本地 Laya CPU 产生影子建议（choice/score/noul），与规则冲突时只标记**同命题互斥**；未校准即标 `calibrated=false` + `needsHumanReview=true`；默认 off；正式链路不等模型 HTTP。
- **证据**：契约 `packages/audit/src/decision.ts` + TypeBox 校验（18 测试，`6a59906`）；本地 Laya CPU 冒烟（单请求 642 ms、未校准，`docs/project-management/evidence/laya-cpu-smoke.json`）。
- **状态**：契约与单样本冒烟已验证；持久化/worker/UI 已随切片合并（`a6ec041`、`cc942b2`，`a849b29` 后集成检查点 835/0，含未提交契约修订待 Main 收尾）；off/shadow 对照与故障隔离的统一回归在 S3，S3 前演示只讲机制与已验证证据。

### 2.6 隐私与出网默认禁止

- **是什么**：原始合同默认不出网；仅当 endpoint origin 精确列入 `LLM_INTERNAL_DATA_ORIGINS` 且内容证明为合成才放行；loopback 本身不证明数据留域；内置合成内容以 canonical hash 证明。
- **证据**：`apps/api/src/llm/audit-data-policy.ts`（`1f33d99`）；Pi 传输无重定向；provider key 密封存储、不随 API 返回。
- **状态**：策略已实现；字段级抓包证据待 QA 归集。

### 2.7 密钥全生命周期

- **是什么**：provider/OCR key 密封存储；启动时（写库前）校验 demo/production 加密 secret ≥32 并将旧明文重封；轮换 CLI 默认 dry-run、`--apply` 才执行，且要求目标库名匹配，事务性重包。
- **证据**：`apps/api/src/llm/rotate-api-keys.ts`、`reencrypt-plain-keys.ts`（commit `cd24aac`）；`docs/project-management/evidence/key-rotation-smoke.json`（dry-run/apply 保留合成凭据、错库拒绝、损坏行回滚）；`startup-security.json`（重封 2→0 幂等）；[轮换 runbook](../runbook/key-rotation.md)。

### 2.8 失败可观测与隐私回归（S2 修复）

- **是什么**：四处真实缺陷的修复——trace/cache 原始错误日志移除；Redis 不可达时默认无限重试改为 1.5 s 超时/不重试（观测 33 ms 返回 disabled cache）；主体核验失败不再被合成文本豁免吞掉（保留稳定失败状态与私有 Source Record，面向模型的 basis 剥掉上游 body/错误细节；新增附加字段 `AuditSnapshot.subjectVerificationProvider` 标注执行上下文，真实/未分类主体评估阻断合成豁免，已持久化快照不动）。SSE 连接在会话登出/过期时主动关闭属**历史修复**：该机制随访问门一起在 2026-10-17 延期，当前无会话可吊销；重新排期认证时该验收要求恢复（见 runbook 未来要求节）。
- **证据**：commit `2d63f15` 及后续安全切片（Main 拥有）；`docs/project-management/evidence/cache-failure-smoke.json`；7 项隐私/降级回归通过。**最终计数待集成后统一**，本文不提前固化。
- **意义**：降级路径"安静失败"是审计系统最危险的形态——本轮把"失败必须留下稳定状态、缓存不可达必须快速返回、模型侧不得回显上游错误"做成可回归的行为。

### 2.9 一键复现与降级语义

- **是什么**：一条 compose；对象存储/Redis/LLM/OCR 全部可降级；fake 模式免凭证演示；`/api/health` 明确报告每个依赖的真实后端与就绪状态。
- **证据**：`compose.yaml`、`docs/runbook/mvp-local.md`、S0 健康实测。

## 3. 成熟度与推广约束（不夸大）

| 能力 | 成熟度 | 推广前提 |
| --- | --- | --- |
| 规则审计闭环 | 立即可用（单实例） | 需 PostgreSQL；LLM 可 fake |
| 规则扩展 | 需开发（加规则=改代码+golden 回归） | 参数可配，逻辑不可配（无 DSL） |
| 模型替换 | 配置后可用（OpenAI 兼容） | 需网关；真实质量未基准化 |
| OCR | 配置后可用（vlm/MinerU） | 视觉模型需端点；MinerU 需服务 |
| 主体核验 | 需 adapter（fixture/qcc） | 生产需企查查凭证 |
| 多部门适配 | 需业务改造 | 规则集面向采购/服务/建设/运维通用条款；行业专属需新增规则 |
| 多用户/权限 | **不具备（认证已延期）** | 当前无登录/Bearer/session 强制，无 RBAC/SSO；访问控制依赖部署侧网络隔离。认证为路线图最后一项（2026-10-17 用户指示延期） |

**不给**的承诺：不承诺准确率提升百分比、不承诺人力成本节省数字、不承诺多租户/多副本、不承诺生产合规认证。KPI 只给定义与测量计划（见 `METRICS.md`）。
