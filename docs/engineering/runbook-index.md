# 运维手册索引与操作约束（R2）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。本文是**索引与约束**；详细步骤在各 runbook 原文，不在本页复述（避免两份口径漂移）。

## 1. 文档地图

| 主题 | 文档 | Owner | 状态 |
| --- | --- | --- | --- |
| 本地验证全流程 | `docs/runbook/mvp-local.md` | Docs | 已校正（路由表补齐 contracts/dossier-review/settings/ocr） |
| macOS 本机差异与路由地图 | `docs/runbook/startup.md` | Docs | 已校正（21 张表、OCR 三选一） |
| 访问门与口令策略 | `docs/runbook/access-control.md` | Main | 已实测（`1f33d99`） |
| 密钥轮换 | `docs/runbook/key-rotation.md` | Main | 已实现且已验证（`cd24aac`；`key-rotation-smoke.json`、`startup-security.json`） |
| 部署与复现 | `docs/deployment/` | Infra | 已入树（demo.md 两种 profile + 受管 CLI + 备份恢复；统一验收待S3） |
| 决策/Laya | `docs/ai/` | AI | 已实现待统一验收（provider/持久化/worker/评测脚本已合并 `a6ec041`；全量 Laya 评测与 off/shadow 对照待S3） |

## 2. 操作红线（任何文档与脚本都不得违反）

1. 禁止 `docker compose down -v`、全库 `DROP`/`TRUNCATE`、`git reset --hard` 作为普通步骤。
2. 重置只允许 demo/test 环境，且须库身份登记 + 明确确认；`CI=true` 不是授权。
3. 生产与未知环境一律拒绝清理；非 demo 哨兵数据必须保留。
4. 演示种子可重置；用户/生产数据不可被任何脚本清空。
5. 密钥（`XYG_API_KEY`、provider key、`API_ACCESS_TOKEN`、加密 secret）不进 Git、日志、URL、浏览器存储或测试工件。
6. 端口/服务身份先检查再操作：不 kill 非本工具管理的进程。

## 3. 环境变量口径（以 `.env.example` 为权威，本文只列分组）

- 模型：`XYG_*`（环境路径，key 仅存进程内存）或模型服务页持久化 provider（key 密封存储）。
- 数据与基础设施：`DATABASE_URL`、`MAX_CONCURRENT_AUDITS`、`AGENT_TIMEOUT_MS`、`API_PORT`、`WEB_ORIGIN`。
- 运行模式：`AUDIT_AGENT_MODE`（pi/fake）、`SUBJECT_VERIFICATION_MODE`（fixture/qcc）。
- 对象存储与缓存：`S3_*`、`UPLOAD_DIR`、`REDIS_URL`；demo/production 默认严格存储（S3 写失败即失败），本地回退为显式 `s3-fallback-local` 开发选项；Redis 缓存始终可降级。
- OCR：`OCR_PROVIDER`（off/vlm/mineru）、`OCR_VLM_*`、`OCR_MAX_PAGES/SCALE/JPEG_QUALITY/CONCURRENCY/TIMEOUT_MS`、`MINERU_ENDPOINT`。
- 访问与出网（S2 新增）：`API_ACCESS_TOKEN`、`LLM_INTERNAL_DATA_ORIGINS`（默认空）。
- 决策影子（S2 已入树）：`DECISION_MODE`（off/shadow，默认 off）、`DECISION_PROVIDER`（disabled/fake/laya-cpu，默认 disabled）、`DECISION_RETENTION_DAYS`（默认 30，1–365）；路由 `/api/decisions/:id`、反馈与保留期由 `apps/api/src/routes/decisions.ts` 提供（S3 统一回归前按"已实现待验收"对待）。

**没有** Jev 相关变量或远程决策调用路径（该方向已取消）。

## 4. 启动形态速查

| 形态 | 命令 | 说明 |
| --- | --- | --- |
| 开发 | `docker compose up -d postgres rustfs redis rustfs-init` + `bun --filter @contract-audit/api dev` + `bun --filter @contract-audit/web dev` | 基础设施容器化，应用宿主热更新 |
| 演示 | `docker compose up --build` → `http://localhost:8080` | 整套栈容器化；API 自迁移；fake 模式免凭证 |
| 演示种子 | `docker compose exec api bun run seed:demo` | 不自动执行，需手动触发 |
| 后台开发（Linux/WSL） | `./scripts/dev-up.sh`（`--status`/`--stop`） | macOS 不可用（缺 `setsid`/`ss`） |
| 演示 CLI（S2） | minimal（根`.env`）：`bun --env-file=.env scripts/demo/cli.ts up\|down\|reset\|seed\|verify\|check`；demo profile（受管`.demo.env`，`up` 生成）：`bun --env-file=.demo.env scripts/demo/cli.ts up\|down\|reset\|seed\|verify\|check\|ready\|logs\|status`（`ready` 为 demo profile 专用，待 Main 实跑确认）；备份/恢复：`bun --env-file=.demo.env scripts/demo/backup-restore.ts backup\|restore` | 已入树；统一验收前不写进复现指南当已验证事实 |

## 5. 故障分诊速查

| 现象 | 首选检查 | 说明 |
| --- | --- | --- |
| `/api/health` 503 | `database`/`dispatcher` 字段 | 只有这两项致命 |
| 审计失败且 Agent 超时 | `AGENT_TIMEOUT_MS` 与端点延迟 | 超时记为失败运行，不自动续跑 |
| 扫描件"无法识别" | OCR provider 配置与 probe | 关闭时明确失败，不猜测内容 |
| 原文下载异常 | Source Record locator 前缀与实际后端 | `s3://` 与本地路径记录真实写入方 |
| 验收串台 | 是否复用 dev 服务/开发库 | `CI=true` + `PLAYWRIGHT_DATABASE_URL` + 端口覆盖 |
| 全部 API 401 | 访问门已启用且未带 token/会话 | Bearer 或 HttpOnly 会话二合一 |
