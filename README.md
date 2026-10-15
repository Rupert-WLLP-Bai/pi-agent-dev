# Contract Audit

一个可追溯的合同审计系统。合同（文本、Word、PDF）经过规范化与一组确定性规则评估，Pi 只能通过受控工具读取证据并提交风险建议，用户随后接受或驳回该建议。规则本身可治理：参数版本化（草稿 / 已发布 / 已退役）、发布前案例验证，以及运行时启停——被停用的规则不再进入新的审计快照。

## 当前状态

现有代码包含确定性审计、Pi Agent、REST/SSE、PostgreSQL 留痕、RustFS 原件存储、Redis 核验缓存、模型配置、人工复核与整改工作台。本轮正在进行 **M1 / v0.7.0 稳定化验收，尚未发布**；当前状态以[唯一任务板](./docs/project/TASK-BOARD.md)及[交接记录](./docs/project/HANDOFF.md)为准，后续里程碑不提前计作完成。

领域语言见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [ADR-0001](./docs/adr/0001-bun-modular-monolith-with-embedded-pi.md)，技术方案见 [Architecture](./docs/architecture/mvp.md)。`docs/superpowers/plans/`保留历史计划；当前实施与验收只更新[任务板](./docs/project/TASK-BOARD.md)。

Pi SDK 已升级至 1.2.0；版本依据、兼容性处理与验证记录见 [升级记录](./docs/research/2026-10-14-pi-1.2-upgrade.md)。

### 文档索引

工程文档（需求、C4/ADR、测试、运维、研发历史、风险及追溯矩阵）见 [docs/engineering](./docs/engineering/)。竞赛材料见 [docs/competition](./docs/competition/)。安全与运维：[访问门](./docs/runbook/access-control.md)、[密钥轮换](./docs/runbook/key-rotation.md)。当前基线、风险、所有权和交接由 Main 维护于 [docs/project](./docs/project/)；`docs/project-management/`为历史记录。

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

对象存储与缓存都是**可降级**依赖，不是审计的必要条件。本地开发形态下 `S3_ENDPOINT` 未配置时合同原文写入本地 `UPLOAD_DIR`（默认 `var/uploads`），每条 Source Record 的 locator 前缀（`s3://bucket/key` 或文件系统路径）记录实际写入的后端；`REDIS_URL` 未配置或不可达时主体核验直接调用企查查，绝不导致审计失败。**demo/production 形态默认严格**：S3 写入失败即失败，不静默降级；本地回退仅在显式选择 `s3-fallback-local` 的本地开发配置下启用（口径见 [工程规格](./docs/design/2026-10-15-v1-engineering-spec.md) §5.3）。Redis 只做核验缓存——**不是**审计队列、**不是** SSE pub/sub、**不是**会话存储；审计队列仍在 PostgreSQL 上用 `SKIP LOCKED` 实现。

## 能力边界

包含：文本粘贴与合同文件上传（`.txt` / `.md` / `.docx` / `.pdf` / `.xlsx`）、文本规范化、内置 19 条确定性规则、合同立场 Contract Stance（规则按立场分档）、受控 Pi 分析、SSE 进度、Finding 的人工接受/驳回、规则参数版本化与运行时启停、复核分派与整改跟踪、Agent 运行轨迹（含嵌套工具调用与轮次用量）、合同台账与修订对比（`/contracts`）、卷宗跨文档金额链核对（`/dossier-review`，无状态，不落库）、可插拔 OCR 扫描件识别（`/settings/ocr` 三选一：关闭 / 视觉模型 / MinerU。视觉模型由 `pdfjs-dist` 逐页栅格化后交给 OpenAI 兼容网关上的视觉模型；MinerU 调用已验证过的 4.x `/v1/file_parse` 接口；均未配置时整体降级为关闭，扫描件以明确"无法识别"失败而非猜测内容）、审查报告 docx 导出（`/api/audit-cases/:id/report.docx`）、PostgreSQL 留痕、合同原文对象存储（S3/RustFS + 本地回退）、企查查核验缓存、OpenAI 兼容的模型服务管理（`/settings/providers`）、工作区访问口令门（`API_ACCESS_TOKEN`，Bearer 或 HttpOnly 会话）与演示世界种子。

不包含（附原因）：

- **MongoDB**：不引入。审计快照、Facts 与规则参数已经存放在 PostgreSQL 的 JSONB 中，且没有独立的文档检索或 change-stream 需求。
- **独立消息队列**：审计队列暂由 PostgreSQL `SKIP LOCKED` 承担。重新评估的触发条件是 API 需要多个副本置于负载均衡之后——届时进程内调度器与内存队列不再成立。
- **SSO、RBAC、多租户、OpenTelemetry、WebSocket**：暂不需要；访问门是单工作区口令门，不是身份体系。
- **RAG、多 Agent 编排**：暂不需要。
- **报告中心**：尚未实现（单案件 docx 导出已具备）。
- **生产合规认证**：未宣称通过任何标准认证（ISO 25010、NIST AI RMF 等仅作为文档方法与威胁清单参考）。

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

- **环境变量**：`XYG_ENDPOINT`、`XYG_API_KEY`、`XYG_MODEL`、`XYG_MAX_INPUT`、`XYG_MAX_OUTPUT`。Provider 表为空且 endpoint/model 齐备时，启动会把配置导入首个 provider；不能把环境配置理解为只驻留内存。密钥保存策略及轮换要求见[运行手册](./docs/runbook/key-rotation.md)。
- **模型服务页**（`/settings/providers`，侧边栏「系统管理」）：在 UI 里新增/编辑 OpenAI 兼容的 provider（名称、base URL、模型、API key、最大输入/输出 token、启用开关）。**恰好一个 provider 是「当前」**，它就是下一次审计运行使用的配置；表为空时回退到上面的 `XYG_*` 环境变量，因此不配置任何 provider 也能保持既有行为。

模型服务配置保存在 PostgreSQL 的`llm_providers`表，密钥采用统一加密策略；demo/production 要求配置`LLM_KEY_ENCRYPTION_SECRET`。后续查询响应仅报告密钥是否存在及掩码，不返回明文；运维在配置页面输入的密钥只用于该次保存请求。

`AUDIT_AGENT_MODE=fake` 可在不配置 LLM 凭证时使用 FakeAuditAgent 跑通全流程。本地开发形态下合同原文默认写入本地 `UPLOAD_DIR`（`var/uploads`）；设置 `S3_ENDPOINT` 后改存对象存储，且 demo/production 下写入失败即失败（不静默回退）。`REDIS_URL` 未配置即关闭核验缓存，这也是本机默认状态。

受管演示沿用现有入口，使用独立的`.demo.env`与 Compose 项目，不覆盖开发配置：`bun run demo:up`启动，`demo:check`只读检查配置/数据身份，`demo:verify`核对必需组件与 Web，`demo:ready`执行受保护的两次重置与一致性验收，`demo:down`停止。`demo:ready`仅重建演示工具拥有的数据；操作前提和日志命令见[演示部署](./docs/deployment/demo.md)。

## 质量闸门

提交前跑一次 `bun run verify`（lint + typecheck + 单元测试），改动界面后另跑验收测试：

```bash
bun run lint                     # Biome 检查格式、导入顺序与 lint 规则
bun run lint:fix                 # 自动修复 + 格式化 + 整理导入
bun run typecheck                # 应用代码 + 测试与构建脚本两轮 tsc
bun run test                     # 单元测试（bun test packages apps）
bun run acceptance               # Playwright 验收测试（需 dev 栈或自动拉起）
bun run verify                   # lint + typecheck + 单元测试
bun run test:all                 # 严格分层报告：unit + integration + e2e + coverage
                                # 需 TEST_DATABASE_URL、PLAYWRIGHT_DATABASE_URL 与 Chromium
```

Biome 配置见 `biome.json`：2 空格缩进、100 列、双引号、尾逗号、`organizeImports`。`docs/design` 下的设计稿与 `apps/web/src/styles.css`（覆盖 antd 内联样式的层）有针对性豁免，理由写在配置注释与本节。`tsconfig.tests.json` 让 `tests/`、`playwright.config.ts`、`vite.config.ts`、`drizzle.config.ts` 也纳入类型检查——这些文件此前不在闸门内，曾漏掉真实的类型错误。

CI 见 `.github/workflows/ci.yml`：`quality` job 跑 lint/typecheck/单测；`acceptance` job 起 PostgreSQL service、应用迁移并跑 Playwright。

验收必须显式指定新建、已迁移的独立 TEST 库。`TEST_DATABASE_URL`供集成层使用；`PLAYWRIGHT_DATABASE_URL`供浏览器 API 与清理助手共同使用，不能依赖开发`.env`。每轮使用空的专用验收库，避免历史案件改变相对方关联规则；使用新端口并禁止复用，确保浏览器运行当前代码。

```bash
# 先配置两个独立测试库的 URL，并分别应用 apps/api 中已提交的迁移。
TEST_DATABASE_URL="$TEST_DATABASE_URL" PLAYWRIGHT_DATABASE_URL="$PLAYWRIGHT_DATABASE_URL" \
  PLAYWRIGHT_WEB_PORT=15002 PLAYWRIGHT_API_PORT=14002 CI=true \
  bun run test:all
```

分层报告写入`artifacts/qa/`；未配置依赖会记录跳过原因，严格`test:all`返回失败。不要通过清空 DEV/DEMO 数据来准备验收库；保留独立 TEST 库的配置与创建记录。

```bash
cp .env.example .env                   # 填写 LLM 配置（或留空走模型服务页）
docker compose up -d postgres rustfs redis rustfs-init  # 本地基础设施
bun install --frozen-lockfile            # 使用已提交锁文件
(cd apps/api && bun run migrate)         # 应用已提交迁移，不在启动时生成新迁移
bun run lint                            # lint + 格式检查
bun run typecheck                       # 类型检查（含 tests/）
bun run test                            # 单元测试
bunx playwright install                 # 安装浏览器（首次）
# 完整验收按上面的独立 TEST 配置运行 bun run test:all
```

## Ant Design 版本基线

Web 工作台统一使用当前稳定的 Ant Design v6：

- `antd`: `^6.6.3`
- `@ant-design/icons`: `^6.3.4`
- React 19，无需 `@ant-design/v5-patch-for-react-19`

组件代码按 v6 API 编写：使用 `Space.orientation`、`Descriptions.items`、`Alert.title`、`Drawer.size` 与 `mask={{ closable }}`，全局反馈通过根 `App` 的 `App.useApp()` 获取；Finding 列表等自有列表保持既有本地组件写法，不新增已弃用的 `List`。修改组件前先运行 `antd info <Component> --version 6.6.3 --format json`，修改后运行 `antd lint <changed-path> --format json`。

通用步骤见 [runbook](./docs/runbook/mvp-local.md)，macOS 本机差异与路由地图见 [startup.md](./docs/runbook/startup.md)。
