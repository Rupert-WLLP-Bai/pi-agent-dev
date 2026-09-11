# Contract Audit MVP

一个可追溯的合同审计 MVP。首版只验证“预付款比例超过制度上限”的单一审查闭环：合同文本经过规范化与确定性规则评估，Pi 只能通过受控工具读取证据并提交风险建议，用户随后接受或驳回该建议。

## 当前状态

Contract Audit MVP 已完成并在 `main` 上落地。审计核心、Pi Agent、Elysia REST/SSE API、PostgreSQL 留痕、React 工作台和 Playwright 验收流程均已实现；现代化审计工作台（审计队列指挥中心与 decision-first 复核工作台）已通过 `origin/modern-audit-workbench` 快进合并进 `main`。

领域语言见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [ADR-0001](./docs/adr/0001-bun-modular-monolith-with-embedded-pi.md)，完整技术方案见 [MVP Architecture](./docs/architecture/mvp.md)，逐任务实现计划见 [implementation plan](./docs/superpowers/plans/2026-09-11-contract-audit-mvp.md) 和 [modern workbench plan](./docs/superpowers/plans/2026-09-11-modern-audit-workbench.md)。

## MVP 边界

包含：演示合同或文本粘贴、文本规范化、付款规则、受控 Pi 分析、SSE 进度、Finding 的人工接受/驳回、PostgreSQL 留痕。

不包含：PDF/MinerU、对象存储、合同中心、SSO、Redis、真实外部数据源、报告中心、RAG、多 Agent、WebSocket 和 OpenTelemetry。

## 目标工作区

```text
apps/web          React + Vite 工作台
apps/api          Elysia API、SSE、Drizzle 与应用装配
packages/audit    领域模型、规则、编排端口
packages/pi-agent Pi SDK 适配器、Skill 与受控 Tool
```

## 本地配置

复制 `.env.example` 为 `.env` 并填写 LLM 配置。`.env` 不纳入版本控制。现有环境变量使用 `XYG_ENDPOINT`、`XYG_API_KEY`、`XYG_MODEL`、`XYG_MAX_INPUT` 和 `XYG_MAX_OUTPUT`。`AUDIT_AGENT_MODE=fake` 可在不配置 LLM 凭证时使用 FakeAuditAgent 跑通全流程；API key 只保存在进程内存中，不落盘、不打印、不随 API 返回。
 
## 快速开始

```bash
cp .env.example .env          # 填写 LLM 配置
docker compose up -d postgres  # 启动 PostgreSQL
bun install                     # 安装依赖
cd apps/api && bunx drizzle-kit generate && bunx drizzle-kit migrate && cd ../..
bun run typecheck               # 类型检查
bun test                        # 单元测试
bunx playwright install         # 安装浏览器（首次）
bunx playwright test            # 验收测试
```

## Ant Design 版本基线

Web 工作台统一使用当前稳定的 Ant Design v6：

- `antd`: `^6.6.3`
- `@ant-design/icons`: `^6.3.4`
- React 19，无需 `@ant-design/v5-patch-for-react-19`

组件代码按 v6 API 编写：使用 `Space.orientation`、`Descriptions.items`、`Alert.title`、`Drawer.size` 与 `mask={{ closable }}`，全局反馈通过根 `App` 的 `App.useApp()` 获取；列表使用 `Listy`，不再新增已弃用的 `List`。修改组件前先运行 `antd info <Component> --version 6.6.3 --format json`，修改后运行 `antd lint <changed-path> --format json`。

详细步骤见 [runbook](./docs/runbook/mvp-local.md)。
