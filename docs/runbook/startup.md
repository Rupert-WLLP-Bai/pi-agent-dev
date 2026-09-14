# 本地启动指南（macOS）

本机（Darwin / Apple Silicon）从零到可用的完整步骤。通用流程见
[mvp-local.md](./mvp-local.md)；本文补充本机的实际差异与当前路由地图。

## 1. 前置要求

- Bun ≥ 1.3.14（CI 固定 1.4.0）
- Docker（OrbStack / Docker Desktop）
- Node.js 24+（Playwright 用）

## 2. 一次性初始化

```bash
cp .env.example .env          # 首次；本机已配好，见下
bun install                   # 安装依赖（workspaces）
docker compose up -d postgres # 启动 PostgreSQL 18
cd apps/api && bun run migrate && cd ../..   # 应用迁移（13 张表）
bunx playwright install       # 首次安装浏览器
```

`.env` 关键变量（`git` 忽略，不入库）：

| 变量 | 本机值 | 说明 |
|---|---|---|
| `XYG_ENDPOINT` / `XYG_API_KEY` / `XYG_MODEL` | 已配置 | 真实 LLM，仅存进程内存 |
| `DATABASE_URL` | `postgresql://contract_audit:contract_audit@localhost:5433/contract_audit` | 见第 6 节端口说明 |
| `AUDIT_AGENT_MODE` | `pi`（默认）| 设 `fake` 可无凭证跑通全流程 |
| `AGENT_TIMEOUT_MS` | `300000` | 单次 Agent 运行上限，`0` 表示不超时 |
| `SUBJECT_VERIFICATION_MODE` | `fixture`（默认）| `qcc` 走企查查 MCP |
| `MAX_CONCURRENT_AUDITS` | `1` | 并发审计数 |

## 3. 日常启动

开两个终端，各跑一条：

```bash
# 终端 1 — API（读取根目录 .env）
bun --filter @contract-audit/api dev

# 终端 2 — Web（Vite，/api 代理到 3000）
bun --filter @contract-audit/web dev
```

打开 <http://localhost:5173/>，会自动跳转到 `/dashboard`。

> Linux / WSL 上可用 `./scripts/dev-up.sh`（`--status` / `--stop`），它用
> `setsid` + `ss` 管理进程组；**macOS 没有这两个命令，请不要用该脚本**。

健康检查：

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","database":true,"dispatcher":true,"agentMode":"pi",
#  "qccConfigured":false,"llmConfigured":true}
```

`database` / `dispatcher` 为 `true` 才可正常审计；`llmConfigured` 表示是否读到
`XYG_API_KEY`（`pi` 模式下为 `false` 时审计会失败）。

## 4. 页面路由

| 路由 | 页面 |
|---|---|
| `/dashboard` | 审计驾驶舱（首页，`/` 跳这里）|
| `/audit-cases` | 审计队列（支持 `?lifecycle=ABNORMAL` 等筛选）|
| `/audit-cases/:id` | decision-first 复核工作台（`?origin=reviews｜remediations`）|
| `/audit-cases/:id/trace` | 单案例运行轨迹 |
| `/audit-runs` | 运行记录 |
| `/reviews` | 复核中心（SLA 队列 / 批量转交）|
| `/remediations` | 整改跟踪 |
| `/rules`、`/rules/:id` | 规则管理（参数版本化、启停）|
| `/cases` | 案例验证（发布前回归）|
| `/verification` | 外部核验 |
| `/integrations` | 集成健康 |
| `/demo` | 演示概览（规则矩阵）|

## 5. 质量闸门

```bash
bun run lint         # Biome：格式 + 导入顺序 + lint
bun run lint:fix     # 自动修复
bun run typecheck    # tsc（应用代码 + tests/ 两轮）
bun run test         # bun test packages apps
bun run verify       # lint + typecheck + test
```

验收测试（Playwright，自动以 `AUDIT_AGENT_MODE=fake` 起服务）：

```bash
# 先停掉第 3 节的 dev 服务，否则会复用 pi 模式的实例
bun run acceptance
```

- 复用已运行的服务由 `PLAYWRIGHT_REUSE_SERVERS` 控制；`CI=true` 强制干净启动。
- 浏览器 CDN 不可用时：`PLAYWRIGHT_CHANNEL=chrome bun run acceptance`。
- 并行跑在别的端口：`PLAYWRIGHT_API_PORT=3100 PLAYWRIGHT_WEB_PORT=5273`。

真实 LLM 冒烟（只打印遥测，不打印密钥）：

```bash
bun --filter @contract-audit/pi-agent run smoke
```

## 6. 本机已知问题

1. **5432 被 Homebrew PostgreSQL 占用。** 本机 `postgresql@18` 监听
   `127.0.0.1:5432`，`localhost` 到不了 Docker 容器。因此本机加了
   `compose.override.yaml`（未提交）把项目库发布到 **5433**，`.env` 的
   `DATABASE_URL` 也指向 `localhost:5433`。若删掉该文件，`docker compose` 会回到
   5432 并被 Homebrew 抢占。
2. **不要用 `192.168.x.x` 作为 `DATABASE_URL` 主机。** 之前 `.env` 指向固定的
   局域网 IP，换了网络（`192.168.97.2` → `192.168.217.41`）后 API 直接连不上；
   现在统一用 `localhost:5433`。
3. **PG16 数据卷已清理。** `compose.yaml` 已把镜像升到 `postgres:18`，旧的 16
   数据卷因目录布局不兼容而无法启动，已删除；本机统一 18。旧数据不可恢复。
4. **`./scripts/dev-up.sh` 不能在 macOS 运行**（缺 `setsid`/`ss`），用第 3 节两条
   命令代替。
5. **验收测试与 dev 服务互斥。** dev 服务常驻 3000/5173 时，Playwright 默认复用
   它们；`pi` 模式下会真的打 LLM。跑验收前先停服务。

## 7. 停止

- 前台两条命令：各自 `Ctrl-C`。
- 后台/托管进程：结束 `bun --filter @contract-audit` 相关进程。
- 数据库：`docker compose stop postgres`（保留数据）；`docker compose down`
  （移除容器，保留卷）。
