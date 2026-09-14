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
docker compose up -d postgres minio redis   # 本地基础设施：PostgreSQL + MinIO + Redis
cd apps/api && bun run migrate && cd ../..   # 应用迁移（13 张表）
bunx playwright install       # 首次安装浏览器
```

MinIO 与 Redis 都是可选的：`S3_ENDPOINT` / `REDIS_URL` 留空时原文落本地目录、核验不缓存，
本地开发照常可用（见下表）。

`.env` 关键变量（`git` 忽略，不入库）：

| 变量 | 本机值 | 说明 |
|---|---|---|
| `XYG_ENDPOINT` / `XYG_API_KEY` / `XYG_MODEL` | 已配置 | 真实 LLM；环境变量路径的 API key 仅存进程内存 |
| `DATABASE_URL` | `postgresql://contract_audit:contract_audit@localhost:5433/contract_audit` | 见第 6 节端口说明 |
| `AUDIT_AGENT_MODE` | `pi`（默认）| 设 `fake` 可无凭证跑通全流程 |
| `AGENT_TIMEOUT_MS` | `900000` | 单次 Agent 运行上限，`0` 表示不超时。实测无竞争时一次完整审计约 62 秒（约 20 次工具调用），所以 900000 只是上限；超时会记为失败的 Agent 运行且不会自动续跑，接口较慢时不要调低 |
| `SUBJECT_VERIFICATION_MODE` | `fixture`（默认）| `qcc` 走企查查 MCP |
| `MAX_CONCURRENT_AUDITS` | `1` | 并发审计数 |
| `S3_ENDPOINT` | 空（默认）| 未配置时合同原文写本地 `UPLOAD_DIR`；这是正常的本地状态 |
| `S3_BUCKET` / `S3_REGION` | `contract-originals` / `us-east-1` | 对象存储桶与区域默认值 |
| `UPLOAD_DIR` | `var/uploads` | 对象存储未配置时的本地回退目录 |
| `REDIS_URL` | 空（默认）| 未配置即关闭企查查核验缓存，这是正常的本地状态 |

LLM 也可以在「模型服务」页（`/settings/providers`，侧边栏「系统管理」）配置：新增
OpenAI 兼容 provider（名称 / base URL / 模型 / API key / 最大输入输出 token / 启用开关），
恰好一个为「当前」，即下一次审计使用的配置；表为空时回退到上面的 `XYG_*`。通过该页添加的
provider 会把 key 持久化到 PostgreSQL `llm_providers` 表；无论哪条路径，key 都不会随 API
返回、不会写日志、不会进入浏览器。

## 3. 日常启动

### 开发（基础设施在容器，应用在宿主）

```bash
docker compose up -d postgres minio redis   # 基础设施
# 终端 1 — API（读取根目录 .env）
bun --filter @contract-audit/api dev
# 终端 2 — Web（Vite，/api 代理到 3000）
bun --filter @contract-audit/web dev
```

打开 <http://localhost:5173/>，会自动跳转到 `/dashboard`。

> Linux / WSL 上可用 `./scripts/dev-up.sh`（`--status` / `--stop`），它用
> `setsid` + `ss` 管理进程组；**macOS 没有这两个命令，请不要用该脚本**。

### 演示（整套栈进容器）

```bash
docker compose up --build
```

打开 <http://localhost:8080>。服务与端口：

| 服务 | 端口 |
|---|---|
| postgres | 5432 |
| minio | 9000（S3 API）/ 9001（控制台）|
| redis | 6379 |
| api | 3000 |
| web | 8080 |

API 容器启动时自动应用迁移；`AUDIT_AGENT_MODE` 在容器中默认 `fake`，因此演示无需 LLM
凭证。演示种子**不会**自动执行，需要时手动触发：

```bash
docker compose exec api bun run seed:demo
```

### 健康检查

```bash
curl -s http://localhost:3000/api/health
# {
#   "status": "ok",
#   "database": true,
#   "dispatcher": true,
#   "agentMode": "pi",
#   "qccConfigured": false,
#   "llmConfigured": true,
#   "connections": {
#     "database":    { "ok": true,  "target": "localhost:5433/contract_audit", "detail": null },
#     "redis":       { "ok": false, "target": "未配置", "detail": "未设置 REDIS_URL，企查查结果不做缓存" },
#     "objectStore": { "ok": true,  "target": "<工作目录>/var/uploads（本地目录）", "detail": null },
#     "llm":         { "ok": true,  "target": "deepseek-v4-flash @ http://<XYG_ENDPOINT>", "detail": null },
#     "qcc":         { "ok": false, "target": "agent.qcc.com · 公司核验 + 风险扫描",
#                      "detail": "未设置 QCC_TOKEN，主体核验使用固定样本" },
#     "dispatcher":  { "ok": true,  "target": "worker 池（MAX_CONCURRENT_AUDITS=1）", "detail": null }
#   }
# }
```

`database` / `dispatcher` 为 `true` 才可正常审计，也只有这两者为 `false` 时端点返回
HTTP 503。`redis`、`objectStore` 可降级：未配置或不可用时 `ok` 为 `false`，但不会改变
`status`。`connections.*.target` 已剥离凭据，密钥只报告是否配置（`qccConfigured` /
`llmConfigured`）。未配置 `XYG_*`（且无激活 provider）时 `llmConfigured` 为 `false`、
`llm.detail` 为「未配置 LLM 凭据」。

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
| `/settings/providers` | 模型服务（系统管理组）|
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
- 并行跑在别的端口（勿占演示默认 3000/5173）：`PLAYWRIGHT_API_PORT=3010 PLAYWRIGHT_WEB_PORT=5183`。

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
   它们；`pi` 模式下会真的打 LLM。跑验收前先停服务，或给 Playwright 换端口：
   `PLAYWRIGHT_API_PORT=3010 PLAYWRIGHT_WEB_PORT=5183`（见第 5 节）。
6. **演示副本与改造并行。** 稳定演示用 worktree `.worktrees/demo-stable`（分支
   `demo/stable`，说明见其中 `DEMO.md`），默认占 3000/5173。主工作区做质量改造时
   请用其它端口，例如 `API_PORT=3010 bun apps/api/src/app.ts` 与
   `bun --filter @contract-audit/web dev --port 5183`，避免和演示抢端口。

## 7. 停止

- 前台两条命令：各自 `Ctrl-C`。
- 后台/托管进程：结束 `bun --filter @contract-audit` 相关进程。
- 本地基础设施：`docker compose stop postgres minio redis`（保留数据）；
  `docker compose down`（移除容器，保留卷）。
