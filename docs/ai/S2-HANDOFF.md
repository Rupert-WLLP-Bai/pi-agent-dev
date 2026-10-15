# S2 AI 切片交接（DecisionEngineer → Main）

## 1. 状态总览

| 任务 | 状态 |
| :- | :- |
| A1 独立 DecisionProvider 接口 | 已实现 |
| A2 Disabled/Fake/LayaCpu 适配器 | 已实现；LayaCpu 线上契约按固定 SHA 源码与 Main 实测 422 校正 |
| A3 off/shadow 开关与正式不变性 | 已实现（默认 off；派生守卫在派生路径，worker 不承载开关） |
| A6 持久化影子、幂等、租约、恢复 | 已实现（内存实现 + SQL 实现，同等契约）；**SQL 路径未经真实 PG 集成测试** |
| A7 详情/反馈/保留期路由 | 已实现（幂等 201/409、UUID 形状 404、X-Operator 归属、活动租约不清理） |
| A8 反馈独立 | 已实现（append-only，独立于 Finding 复核） |
| A4 ≥60 条中文合成条款 | 已实现：60 条、10 类、正/反/模糊/例外/跨条款、理由与复核状态；**开发参考标签**，非独立专家 gold |
| A5 公平评测 | 脚本已实现；**数值以实际运行为准**，全量 Laya 评测待集成后跑 |
| A0 Laya 部署/冒烟脚本 | 已实现（verify/install/start/smoke）；真实推理证据由 Main 记录 |
| 激活锁契约 | 已实现（claim/claimCase/createRerunCase 共享 advisory lock） |
| 文档 | DECISION-ARCHITECTURE / PRIVACY-GOVERNANCE / MODEL-CARD / laya-cpu-smoke / SHADOW-EVALUATION(=evaluation.md) / 本交接 |

## 2. 交付文件（相对 worktree 根）

**新增**
```
apps/api/src/decision/index.ts                 # 公共出口 + createDecisionProvider
apps/api/src/decision/runtime.ts               # createDecisionRuntime：Main 装配点
apps/api/src/decision/config.ts                # DecisionConfig + loadDecisionConfig
apps/api/src/decision/questions.ts             # 受控问题目录（question-catalogue-v1）
apps/api/src/decision/redaction.ts             # 最小模型状态、脱敏、inputHash
apps/api/src/decision/derive.ts                # 派生、数据分级判定（不信任调用方自报 SYNTHETIC）
apps/api/src/decision/shadow-repository.ts     # SQL 仓储 + Advice/Conflict 投影
apps/api/src/decision/shadow-worker.ts         # 独立 worker（扫描/租约/重试/恢复）
apps/api/src/decision/testing/in-memory-shadow-repository.ts
apps/api/src/decision/providers/{base,disabled,fake,laya-cpu,laya-wire}.ts
apps/api/src/routes/decisions.ts
apps/api/src/routes/decisions.test.ts
apps/api/src/decision/redaction.test.ts
apps/api/src/decision/shadow-worker.test.ts
apps/api/src/decision/providers/providers.test.ts
apps/api/src/decision/providers/laya-cpu.test.ts
tests/fixtures/decision/clauses.ts             # 60 条合成条款 + 统计工具
tests/fixtures/decision/clauses.test.ts
scripts/decision/{evaluate,laya-setup,smoke}.ts
docs/ai/{DECISION-ARCHITECTURE,PRIVACY-GOVERNANCE,MODEL-CARD,laya-cpu-smoke,SHADOW-EVALUATION,evaluation,S2-HANDOFF}.md
```

**修改**
```
apps/api/src/db/schema.ts                      # demo_environments、shadow_jobs、shadow_feedback（增量）
apps/api/src/db/repositories/audit-queue.repository.ts
  # createQueuedCase originalPath 选项；getSourceRecord 返回 metadata；
  # claim/claimCase/createRerunCase 的共享 advisory lock + DEMO_WORLD_LOCK_KEY 常量
apps/api/src/db/repositories/types.ts          # SourceRecordOriginal.metadata（Infra 完整性投影）
apps/api/src/testing/fakes.ts                  # originalPath / metadata / UUID 形状 id
apps/api/src/config.ts                         # ApiConfig.decision: DecisionConfig；导出 parseNameList/clampInteger
apps/api/src/dispatcher.ts                     # 终态后影子派生钩子 + subjectVerificationProvider 记录
packages/audit/src/model.ts                    # AuditSnapshot.subjectVerificationProvider?: string（Main 要求）
apps/api/src/health.test.ts                    # baseConfig 补 decision 字段（机械）
```

## 3. Main 装配（app.ts）

```ts
import { createDecisionRuntime } from "./decision";

// createDb 之后：
const decision = createDecisionRuntime({
  db,
  config: config.decision,
  // 可选：数据分级判定；缺省 MASKED（不信任调用方自报 SYNTHETIC）
  managedFixture: (caseId) => demoSeededCaseIds.has(caseId),
});

// dispatcher 最后一个可选参数（现有调用全部兼容，不传即无影子）：
new AuditDispatcher(repository, agentFactoryFor(...), broker, config.maxConcurrentAudits,
  subjectVerificationPortFor(...), config.agentTimeoutMs, rulesRepository, ocrPort,
  decision.derive);

// 路由：
.use(decisionsRoutes(decision.routeDeps))

// 启动/停止：
await decision.start();   // off 时为 no-op
process.on("SIGTERM", () => void decision.stop());
```

注意：`ShadowDecisionWorker.start()` 现为同步 void（循环不 await），`stop()` 归还本进程租约。路由 tag 暂挂 `auditCases` 下，独立 tag 由 Main 决定。

## 4. 环境变量（Infra 转发，全部可选）

`DECISION_MODE`（off|shadow，默认 off）、`DECISION_PROVIDER`（disabled|fake|laya-cpu，默认 disabled）、`DECISION_ENDPOINT`、`DECISION_ALLOWED_ORIGINS`（逗号分隔；**空=不允许任何 origin**）、`DECISION_MODEL`（multilingual）、`DECISION_MODEL_REVISION`（1720e3e3…）、`DECISION_CODE_REVISION`（432312b…）、`DECISION_TIMEOUT_MS`（10000）、`DECISION_POLL_INTERVAL_MS`（2000）、`DECISION_MAX_RETRIES`（2）、`DECISION_CONCURRENCY`（1，上限 8）、`DECISION_LEASE_MS`（60000）、`DECISION_RETENTION_DAYS`（30，1–365）。

## 5. 迁移需求（Main 生成）

纯增量三表（`demo_environments`、`shadow_jobs`、`shadow_feedback`），定义见 `apps/api/src/db/schema.ts`。索引：影子幂等唯一索引（8 列全非空，无可空复合唯一）、worker 领取索引（status+lease+createdAt）、终态保留期部分索引、反馈幂等部分唯一索引、feedback decision_id 索引。无列删除、无旧数据回填；`audit_cases` 删除级联到影子表。Infra 的 demo reset 以 `decision_id` 为反馈 FK 目标（已与其握手确认）。

## 6. Main 应运行的验证

1. `bun run typecheck && bun run lint`。
2. `bun test apps/api/src/decision apps/api/src/routes/decisions.test.ts tests/fixtures/decision apps/api/src/db`。
3. 迁移后对 SQL `ShadowDecisionRepository` 跑真实 PG 冒烟（ensure→claim→complete→过期租约恢复→retention dry-run/apply）。
4. `bun scripts/decision/smoke.ts`（+ `LAYA_ENDPOINT=http://127.0.0.1:3847`）。
5. `bun scripts/decision/evaluate.ts --provider laya-cpu --endpoint http://127.0.0.1:3847 --allowed-origin http://127.0.0.1:3847`，输出存 evidence。
6. off/shadow 正式输出对照：同案两模式各跑一次，比对快照/规则/发现/复核/整改不变。

## 7. 已知限制与边界

- SQL 影子仓储**未经真实 PG 运行**（本轮禁跑共享服务/迁移）；语句按 drizzle 0.44 写法编写，以 Main 的真实冒烟为准。
- LayaCpu 的 HTTP 测试用 stub fetch 覆盖投影与错误路径；真实网络调用由 Main 冒烟。
- `score` 线上层级映射假设服务按索引 0 起返回层级概率（与实测一致）；期望值按四舍五入映射回选项，越界返回 `invalid_response`。
- `deriveShadowAdvice` 是 await 的（仅写一行影子任务），全程 try/catch 吞错；推理从不被 dispatcher await。
- 保留期只清终态影子记录及其反馈；`agent_runs` 无影子输入列，无运行级辅助捕获需清理（如未来增加，须同保留期）。
- 完整校准、高级反馈分析、多模型实验：P2 未实施。Jev：已取消，无代码路径。
- 数据集为开发参考标签；任何由此计算的指标**不得**表述为独立人工 gold。

## 8. 本轮实测记录

- `tsc --noEmit`（tsconfig 与 tsconfig.tests 两份）通过。
- 决策层单测全部通过：routes 14/14、redaction+providers+laya+fixtures 38/38、shadow-worker 12/12。
- 受影响的既有套件复跑通过：db 41/41、audit-cases+agent-runs 21/21、health+dispatcher 25/25、packages/audit 317/317。
- 未运行：lint、全量 `bun test`、任何共享服务/迁移（按契约留给 Main）。
