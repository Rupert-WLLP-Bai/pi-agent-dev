# 测试报告（Test Report）

本文件记录**实际运行过**的验证。每一行都能追溯到命令、退出码与工件路径。
未运行的检查明确标注，不用“已完成”形容。

生成方式：`make qa-report` → `artifacts/qa/<SHA>/summary.json` +
`summary.html`。

## 1. 本次运行的实测结果

基线提交 `6a59906`，worktree `omp/s2-qa`，2026-10-15。

| 层 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 单元 | `bun run test` | 0 | **670 pass / 0 fail / 1963 expect()**（75 文件，~10.3s） |
| 单元覆盖率 | `bun run test:coverage` | 0 | LCOV 写出 `artifacts/qa/coverage/lcov.info` |
| 分层覆盖率 | `bun run qa:coverage` | 0 | 行 81.1% / 函数 82.8% / 分支 n/a |
| 分层报告 | `bun run qa:report` | 0 | unit+coverage passed（727/727）；integration/e2e skipped（TEST_DATABASE_URL 未配置）；Chromium 路径实测存在并记录；报告与 HTML 均无凭证泄漏 |
| 集成（无 DB） | `bun test tests/integration` | 0 | 19 tests：9 pass / 10 skip（真实 PG/Redis/S3/门禁缝未就绪） |
| Typecheck | `bun run typecheck` | — | 见下方“已知阻塞” |

`qa:report` 修正后（scripts/qa/report.ts）的行为：Bun 的 pass/fail 计数打到
stderr，因此计数解析合并了 stdout+stderr；E2E 计数只从本次运行的 Playwright
JSON reporter 读取（运行前先删除旧文件，杜绝把上一次的结果当成这次）；
Chromium 可用性通过 `chromium.executablePath()` + 文件系统探测实测，不再硬编码
`true`；集成层守卫只认 `TEST_DATABASE_URL`（或显式 `INTEGRATION_ALLOW_DEFAULT_DB=1`
复用 `DATABASE_URL`）；命令输出先经窄允许列表脱敏（PASSWORD/SECRET/TOKEN/
API_KEY 等），`summary.json`/`summary.html` 不含连接串或凭证。

> **计数仅为冻结基线上下文**：上表的 670/75 文件是 `6a59906` 上的观察值，用于
> 说明本片未改动既有单元套件的通过状态。**最终计数以 Main 集成后的统一运行为
> 准**；本片不把该数字当作交付指标。

上述访问门禁集成记录属于2026-10-15历史基线。2026-10-17用户明确延期认证，当前已移除口令/会话及其专用测试；独立来源检查、脱敏日志与操作人校验保留。当前结果由[任务板](../project/TASK-BOARD.md)及M1发布证据记录。

## 2. 覆盖范围与三层口径

- 单元：行/函数覆盖率来自 Bun 探查器；**分支覆盖率不可测量**（Bun 1.4.3 的
  LCOV 无 `BRDA` 记录），报告为 `null`。不用行覆盖率冒充分支覆盖率。
- 集成：场景计数，见 `docs/quality/COVERAGE-BASELINE.md` 第 2 节。
- E2E：需求映射见 `docs/quality/traceability.csv`。
- 三层不相加。

## 3. 本片新增/修正的测试

| 变更 | 文件 | 证明的行为 |
| --- | --- | --- |
| 重新审计契约修正 | `tests/acceptance/audit-case.spec.ts` | 已复核案件只提供「重新审计」（新案件、新 Run、同 Source Record / 同 Contract Revision），原案件快照/发现/复核/整改与 Run 列表不变；旧的「重试」控件不再出现。旧用例驱动的是 `/retry`，与现行 UI/路由不符，属于过期断言。 |
| 清理 helper 统一 | `tests/acceptance/db-cleanup.ts`（新增） | 三段清理 helper 原先各自 `readFileSync(".env")`，在 `PLAYWRIGHT_DATABASE_URL` 指定的临时库下会删错库。现在与 webServer 用同一套身份解析（`.env` 之上叠加 override），只删本运行创建的案件及关系链，拒绝猜测数据库。 |
| 集成：PG 生命周期 | `tests/integration/audit-lifecycle.test.ts` | 队列排他领取、案件快照读回、SSE 首帧。事务始终回滚。 |
| 集成：Redis | `tests/integration/redis-cache.test.ts` | 未配置/拒绝/命中三种路径；缓存故障永不失败核验。 |
| 集成：S3 | `tests/integration/original-store.test.ts` | 真实往返、显式非严格配置（`S3_STRICT=false`）下写失败回落本地且 locator 记实际后端、local 行不经过 S3 读、上传目录外 locator 拒绝。严格（demo/生产默认）下写失败必须外显，由存储实现与其自身测试/`qa:faults` 断言。 |
| 工作区认证延期 | [当前安排](../runbook/access-control.md) | 2026-10-17按用户要求移除口令/会话，原匿名401、登录/登出、Bearer用例不再适用；当前验证直接访问业务接口与请求来源、脱敏日志约束。 |

## 4. 故障注入（Q6）

`scripts/qa/faults.ts` 覆盖：Redis 不可用时核验仍成功、S3 不可用回落本地、
未知路由/非法 UUID 不伪装 500、超大/类型伪造/路径穿越上传被拒。
需要 `DATABASE_URL`；未配置时全部记为 `skipped` 并给出原因。

## 5. 已知阻塞与未运行项

| 项 | 状态 | 原因 |
| --- | --- | --- |
| `bun run typecheck` 的 tests 项目 | **3 个既有错误** | worktree 的 `apps/web/node_modules/@contract-audit/api` 是一份指向主检出的过期副本（非 symlink），使 tsc 解析到主检出的 `access-control.ts`/`audit-data-policy.ts`/`dispatcher.ts`。基线（stash 后）同样报这 3 个错误，非本次改动引入；本片新增代码单独检查为 0 错误。需 Main 重建该链接。 |
| 集成测试的真实 PG/Redis/S3 | 未运行 | 本机 5432/6379/9000 均未监听。 |
| E2E 验收 | 未运行 | 需要 Chromium 与可迁移数据库。 |
| 分支覆盖率 | BLOCKED | Bun 1.4.3 不产出分支数据。 |
| 真实 Laya / Pi 网关 | 不在 QA 范围 | 证据由 Main 提供（`docs/project-management/evidence/`）。 |

## 6. 安全与数据边界

- 集成测试使用独立测试库身份（`TEST_DATABASE_URL`），helper 校验
  `current_database()` 并拒绝 `production`/`prod`。
- 不存在 `DROP DATABASE` / 全表 `TRUNCATE` / 重置用户数据库的步骤。
- 清理只删除本运行创建的案件关系链；不触碰 S3/UPLOAD_DIR 中的既有原件。
- CI 不配置任何 LLM 凭证，`AUDIT_AGENT_MODE=fake`。
