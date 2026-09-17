# Contract Audit

一个可追溯的合同审计系统。合同（文本、Word、PDF）经过规范化与一组确定性规则评估，Pi 只能通过受控工具读取证据并提交风险建议，用户随后接受或驳回该建议。规则本身可治理：参数版本化（草稿 / 已发布 / 已退役）、发布前案例验证，以及运行时启停——被停用的规则不再进入新的审计快照。

## 当前状态

审计核心、Pi Agent、Elysia REST/SSE API、PostgreSQL 留痕、RustFS 合同原文对象存储、Redis 主体核验缓存、模型服务管理、React 工作台与 Playwright 验收流程均已实现并在 `main` 上落地。审计工作台（审计队列指挥中心与 decision-first 复核工作台）、规则治理（参数版本化、发布前案例验证、运行时启停）、复核中心（SLA 队列与批量转交）与整改跟踪也已上线。

领域语言见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [ADR-0001](./docs/adr/0001-bun-modular-monolith-with-embedded-pi.md)，完整技术方案见 [Architecture](./docs/architecture/mvp.md)，逐任务实现计划见 [implementation plan](./docs/superpowers/plans/2026-09-11-contract-audit-mvp.md) 和 [modern workbench plan](./docs/superpowers/plans/2026-09-11-modern-audit-workbench.md)。

项目参加**第一届黄桷树 AI 智能体开发大赛**，赛道为**智创开发**——基于黄桷树 Panda 编程 IDE 开发解决实际业务问题的软件工具，并验证其可用性与推广价值。交付形态为独立系统，不做 Panda 技能插件。

## 运行时依赖

| 组件 | 用途 |
| --- | --- |
| PostgreSQL | 审计快照、Facts、运行记录、Finding revisions、规则参数与留痕 |
| RustFS（S3 兼容对象存储）| 合同原文（contract originals），可回退本地目录 |
| Redis | 企查查主体核验结果的 7 天 TTL 缓存，key 为 `qcc:v1:{normalizedSubject}` |
| Elysia API | REST / SSE / OpenAPI，进程内审计调度器 |
| React 工作台 | Vite 单页应用 |
| Pi agent runtime | 嵌入式、进程内；一个 Agent Run 对应一个内存 Session |

对象存储与缓存都是**可降级**依赖，不是审计的必要条件：`S3_ENDPOINT` 未配置（或一次 Put 失败）时合同原文写入本地 `UPLOAD_DIR`（默认 `var/uploads`），每条 Source Record 的 locator 前缀（`s3://bucket/key` 或文件系统路径）记录实际写入的后端；`REDIS_URL` 未配置或不可达时主体核验直接调用企查查，绝不导致审计失败。Redis 只做核验缓存——**不是**审计队列、**不是** SSE pub/sub、**不是**会话存储；审计队列仍在 PostgreSQL 上用 `SKIP LOCKED` 实现。

## 能力边界

包含：文本粘贴与合同文件上传（`.txt` / `.md` / `.docx` / `.pdf` / `.xlsx`）、文本规范化、内置 19 条确定性规则、合同立场 Contract Stance（规则按立场分档）、受控 Pi 分析、SSE 进度、Finding 的人工接受/驳回、规则参数版本化与运行时启停、复核分派与整改跟踪、卷宗跨文档金额链核对（`/dossier-review`，无状态，不落库）、可插拔 OCR 扫描件识别（当前实现是视觉模型识别：`pdfjs-dist` 逐页栅格化后交给 OpenAI 兼容网关上的视觉模型，`OCR_VLM_ENDPOINT` 未配置时整体降级为关闭；MinerU 是留给其他部署的空槽位）、PostgreSQL 留痕、合同原文对象存储（S3/RustFS + 本地回退）、企查查核验缓存，以及 OpenAI 兼容的模型服务管理（`/settings/providers`）。

不包含（附原因）：

- **MongoDB**：不引入。审计快照、Facts 与规则参数已经存放在 PostgreSQL 的 JSONB 中，且没有独立的文档检索或 change-stream 需求。
- **独立消息队列**：审计队列暂由 PostgreSQL `SKIP LOCKED` 承担。重新评估的触发条件是 API 需要多个副本置于负载均衡之后——届时进程内调度器与内存队列不再成立。
- **SSO、OpenTelemetry、WebSocket**：暂不需要。
- **RAG、多 Agent 编排**：暂不需要。
- **报告中心**：尚未实现。

## 目标工作区

```text
apps/web          React + Vite 工作台
apps/api          Elysia API、SSE、Drizzle 与应用装配
packages/audit    领域模型、规则、编排端口
packages/pi-agent Pi SDK 适配器、Skill 与受控 Tool
```

## 本地配置

复制 `.env.example` 为 `.env` 并填写配置。`.env` 不纳入版本控制。

LLM 有两条路径，二选一即可：

- **环境变量**：`XYG_ENDPOINT`、`XYG_API_KEY`、`XYG_MODEL`、`XYG_MAX_INPUT`、`XYG_MAX_OUTPUT`。这条路径的 API key **只保存在进程内存中**，不落盘、不打印、不随 API 返回。
- **模型服务页**（`/settings/providers`，侧边栏「系统管理」）：在 UI 里新增/编辑 OpenAI 兼容的 provider（名称、base URL、模型、API key、最大输入/输出 token、启用开关）。**恰好一个 provider 是「当前」**，它就是下一次审计运行使用的配置；表为空时回退到上面的 `XYG_*` 环境变量，因此不配置任何 provider 也能保持既有行为。

模型服务页添加的 provider 会把 API key 持久化进 PostgreSQL 的 `llm_providers` 表——这是「允许运维在运行时增改 provider」的直接代价。无论走哪条路径，key 都**绝不通过任何 API 响应返回**（API 只报告是否存在并给出掩码提示）、**不写日志**、**不进入浏览器**。

`AUDIT_AGENT_MODE=fake` 可在不配置 LLM 凭证时使用 FakeAuditAgent 跑通全流程。合同原文默认写入本地 `UPLOAD_DIR`（`var/uploads`）；设置 `S3_ENDPOINT` 后改存对象存储。`REDIS_URL` 未配置即关闭核验缓存，这也是本机默认状态。

## 质量闸门

提交前跑一次 `bun run verify`（lint + typecheck + 单元测试），改动界面后另跑验收测试：

```bash
bun run lint                     # Biome 检查格式、导入顺序与 lint 规则
bun run lint:fix                 # 自动修复 + 格式化 + 整理导入
bun run typecheck                # 应用代码 + 测试与构建脚本两轮 tsc
bun run test                     # 单元测试（bun test packages apps）
bun run acceptance               # Playwright 验收测试（需 dev 栈或自动拉起）
bun run verify                   # lint + typecheck + 单元测试
```

Biome 配置见 `biome.json`：2 空格缩进、100 列、双引号、尾逗号、`organizeImports`。`docs/design` 下的设计稿与 `apps/web/src/styles.css`（覆盖 antd 内联样式的层）有针对性豁免，理由写在配置注释与本节。`tsconfig.tests.json` 让 `tests/`、`playwright.config.ts`、`vite.config.ts`、`drizzle.config.ts` 也纳入类型检查——这些文件此前不在闸门内，曾漏掉真实的类型错误。

CI 见 `.github/workflows/ci.yml`：`quality` job 跑 lint/typecheck/单测；`acceptance` job 起 PostgreSQL service、应用迁移并跑 Playwright。

**本机跑验收测试要给它一个专用库**，因为 CI 里每次都是全新数据库，本机不是。验收用例之间通过数据库互相影响：相对方历史关联规则会读此前的案件，一次运行留下的"已确认风险"会改变下一次审计出多少条发现，本来能"已完成"的案件会变成"待复核"。同理，端口默认 3000/5173，若被别的工作树或常驻 dev 栈占着，Playwright 会**复用**那个服务，于是你对着一份旧代码断言（新页面直接 `Not Found`）。三个变量都可覆盖：

```bash
docker exec pi-agent-dev-postgres-1 createdb -U contract_audit contract_audit_acceptance
cd apps/api && DATABASE_URL=postgresql://contract_audit:contract_audit@localhost:5433/contract_audit_acceptance bun run migrate && cd ..
PLAYWRIGHT_DATABASE_URL=postgresql://contract_audit:contract_audit@localhost:5433/contract_audit_acceptance \
  PLAYWRIGHT_WEB_PORT=5193 PLAYWRIGHT_API_PORT=3023 bunx playwright test
```

要重置这个库，得**整库删建**：`drop schema public` 不够，drizzle 的迁移记录在独立的 `drizzle` schema 里，只删 public 会让 `migrate` 认为一切已应用而不建任何表。

```bash
cp .env.example .env                   # 填写 LLM 配置（或留空走模型服务页）
docker compose up -d postgres rustfs redis rustfs-init  # 本地基础设施
bun install                             # 安装依赖
cd apps/api && bunx drizzle-kit generate && bunx drizzle-kit migrate && cd ../..
bun run lint                            # lint + 格式检查
bun run typecheck                       # 类型检查（含 tests/）
bun run test                            # 单元测试
bunx playwright install                 # 安装浏览器（首次）
bunx playwright test                    # 验收测试
```

## Ant Design 版本基线

Web 工作台统一使用当前稳定的 Ant Design v6：

- `antd`: `^6.6.3`
- `@ant-design/icons`: `^6.3.4`
- React 19，无需 `@ant-design/v5-patch-for-react-19`

组件代码按 v6 API 编写：使用 `Space.orientation`、`Descriptions.items`、`Alert.title`、`Drawer.size` 与 `mask={{ closable }}`，全局反馈通过根 `App` 的 `App.useApp()` 获取；列表使用 `Listy`，不再新增已弃用的 `List`。修改组件前先运行 `antd info <Component> --version 6.6.3 --format json`，修改后运行 `antd lint <changed-path> --format json`。

通用步骤见 [runbook](./docs/runbook/mvp-local.md)，macOS 本机差异与路由地图见 [startup.md](./docs/runbook/startup.md)。
