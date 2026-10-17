# 项目简介（PROJECT-BRIEF）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。所有能力声明以本仓库代码与实跑证据为准；规划项明确标注。

## 1. 一句话

Contract Audit 是一个**可追溯的合同智能审计系统**：用 19 条确定性规则做权威判定，用受控 Pi Agent 补充证据组织与风险建议，最终判断交给人；全过程留下不可篡改的证据链，可单机 Docker 一键复现。

## 2. 解决的痛点（运营商内部视角）

采购、建设、运维、外包/服务类合同数量大、条款风险维度固定（预付款超限、背靠背付款、保证金比例、管辖约定、条款缺失……），但：

- **人工逐条核对慢且会漏**：ICT 项目卷宗调研显示，一个卷宗约 68 对跨文档数字需两两核对，真实数据中已发现人工漏检的单价不一致（见 [调研](../research/2026-09-14-ict-项目卷宗现状调研.md) §6）。
- **"AI 审合同"不可信**：模型直接下结论时，出错无法回溯到参数与证据，法务不敢用。
- **数据不能出域**：合同文本与主体信息敏感，外部 SaaS 审阅在内部场景不可接受。
- **同类风险反复出现**：同一相对方历史超限记录散落在旧案件里，新审合同挂不上。

本系统的回答：**规则权威 + Agent 辅助 + 人工确认 + 全程证据 + 本地可部署**。

## 3. 系统形态

- 技术栈：Bun + TypeScript monorepo；React 19 / Vite / Ant Design 6 工作台；Elysia REST/SSE/OpenAPI API；PostgreSQL 18 + Drizzle；RustFS（S3 兼容）存原文（demo/production 严格；本地开发可显式回退本地目录）；Redis 仅做主体核验缓存；嵌入式 Pi 1.2.0 Agent（六工具白名单）。
- 部署：一条 `compose.yaml`；开发形态（基础设施容器化）与演示形态（整栈容器化、fake 模式免凭证）。详见 [runbook](../runbook/mvp-local.md)。
- 单实例定位：进程内调度器与 SSE，不宣称多副本就绪（理由见 FAQ）。

## 4. 五个可验证亮点（均有代码/演示支撑）

| # | 亮点 | 证据位置 |
| --- | --- | --- |
| 1 | **规则权威 + 受约束 Agent**：19 条确定性规则定结论，Proposal Guard 拒绝无证据/越界提交 | `packages/audit/src/rule-catalog.ts`、`proposal-guard.ts` 及测试 |
| 2 | **多来源证据锚定**：`DOCUMENT_SPAN` 带原件 hash + 块 ID + Unicode 码点区间；主体核验记录也是 Source Record | `packages/audit/src/model.ts`、ADR-0002 |
| 3 | **人审整改闭环**：确认/误报追加式修订，自动开整改、四态看板、关闭留痕 | `apps/api/src/routes/{findings,remediations}.ts` 及验收 |
| 4 | **快照/版本/轨迹**：Audit Snapshot 不可变，规则参数版本化 + 发布前案例门禁，Agent 轨迹含嵌套工具调用与轮次 token | ADR-0003/0004/0005、`agent-trace.ts` |
| 5 | **私有部署与可复制**：S3/本地可切、OCR 三选一、模型服务运行时配置、出网默认禁止。**访问控制现状**：认证已延期（2026-10-17 用户指示），当前无登录/Bearer/session，访问控制依赖部署侧网络隔离 | `compose.yaml`、`llm/audit-data-policy.ts`、`docs/runbook/access-control.md` |

## 5. 与"模型审合同"的本质区别

| 维度 | 直接 LLM 判定 | 本系统 |
| --- | --- | --- |
| 结论权威 | 模型输出即结论 | 规则结论权威；模型只能提议 |
| 可追溯 | 依赖对话记录 | 快照引用规则版本 + 证据码点区间 |
| 失败模式 | 幻觉难以定位 | Guard 拒绝 + 人工复核 + 未校准标记 |
| 数据边界 | 通常出域 | 默认不出网；可全本地（fake/OCR off/影子 off） |
| 跨条款一致性 | 单次推理短板（公开研究 34–57%，见竞品矩阵引用） | Agent 多轮取证 + 确定性规则先做数值判断 |

## 6. 当前状态摘要（2026-10-15，S2 五切片合并至 `a849b29` 后）

- 已完成并验证：审计核心、规则治理、复核/整改闭环、轨迹、金额链核对、上传/解析、密钥轮换/重封（`cd24aac`）、单测 688/0（`1f33d99`）。
- **认证已延期（2026-10-17 用户指示，放到最后实现）**：访问门（登录口令/Bearer/`/api/session` 会话）已从当前代码移除，legacy `API_ACCESS_TOKEN` 无效果；历史实测（`evidence/s2-security.json` 等）为延期前记录。仍生效：跨站写入拒绝、`X-Operator` 归属标注、日志脱敏、凭据密封、出网与 locator 边界。
- 已实现待统一验收（S3）：决策影子层（provider/持久化/worker/UI，`a6ec041`+`cc942b2`）、演示 CLI 与环境保护（`908cb5a`+`a849b29`）、分层测试与覆盖率/RTM（`de7ea2d`）、375px 窄屏修复与行为验收（`cc942b2`）。合并后集成检查点 `bun run verify` 835 通过/0 失败（`a849b29`，Main 观察；其后有未提交决策契约修订待收尾）。
- 已验证的单样本观察（不作一般结论）：真实 Pi 合同冒烟（29727 ms、42 轨迹步骤、两项提案过 Guard）；本地 Laya CPU 冒烟（642 ms、未校准）。
- 已知待办：决策契约修订收尾与影子详情授权回归、off/shadow 对照运行、字段级出网抓包、全量 Laya 数据集评测、第三方复现记录。

## 7. 复现入口（第三方视角）

```bash
git clone <repo> && cd pi-agent-dev
cp .env.example .env          # 可留空：fake 模式免 LLM 凭证
docker compose up -d postgres rustfs redis rustfs-init
bun install
cd apps/api && bunx drizzle-kit migrate && cd ../..
bun run verify                # lint + 两轮 typecheck + 单测
docker compose up --build     # 演示栈 → http://localhost:8080
```

若 `API_ACCESS_TOKEN` 已设置：对当前 API **无效果**（认证已延期，2026-10-17），不需要 Bearer 或登录会话即可访问；历史访问门 runbook 见 [访问控制状态](../runbook/access-control.md)。演示 CLI（`bun --env-file=.demo.env scripts/demo/cli.ts up|down|reset|seed|verify|check|ready`；minimal 用根 `.env` 不含 `ready`）已入树，命令口径见 [docs/deployment/demo.md](../deployment/demo.md)；统一回归（S3）前按"已实现待验收"对待。
