# 测试策略（Test Strategy）

本文件定义 Contract Audit 的三层测试策略、每层的度量方式与失败判定。它是
`docs/quality/TRACEABILITY.md`、`docs/quality/COVERAGE-BASELINE.md` 与
`docs/quality/TEST-REPORT.md` 的依据；运行命令见仓库根目录 `Makefile`。

## 1. 三层覆盖，不可相加

| 层 | 度量 | 工具 | 说明 |
| --- | --- | --- | --- |
| 单元（unit） | 行覆盖率、函数覆盖率 | `bun test --coverage` | 只统计 Bun 探查器实际执行的行与函数。**分支覆盖率不可测量**：Bun 1.4.3 不输出 `BRDA/BRF/BRH` 记录，报告里记为 `null`，不用行覆盖率冒充。 |
| 集成场景（integration） | 场景通过/失败/跳过数 | `bun run test:integration` | 每个场景是一种行为（一次真实 PG 事务、一次 Redis 命中、一次 S3 往返）。用计数，不用百分比。 |
| E2E 需求（e2e） | 需求 → 用例映射 | `bun run test:e2e` | 以 `docs/quality/traceability.csv` 为唯一映射表，报告每个需求实际被哪些用例覆盖。 |

三层回答不同问题，任何情况下不得求和成“总覆盖率”。一份把三层相加的报告
会被视为无效证据。

## 2. 度量目标（实测基线驱动）

基线来自 2026-10-15 冻结提交 `6a59906` 上的实测，不是规划值：

| 范围 | 行覆盖率 | 函数覆盖率 | 分支覆盖率 |
| --- | --- | --- | --- |
| 全仓库单元基线 | 81.1% | 82.8% | 不可测量（null） |
| `packages/audit` 关键领域 | 98.7% | 97.4% | 不可测量（null） |

- 关键领域模块（19 条规则、stance、proposal guard、document-ir）建议
  line ≥ 90% / branch ≥ 80%；全局建议 line ≥ 75%。分支目标在当前工具链下
  无法验证，明确标记 BLOCKED，不用行覆盖率替代。
- 增量目标只按风险驱动：新增失败路径、回归边界和真实依赖场景优先，不为了
  提高数字删代码或加无意义断言。

## 3. 各层测试什么

### 3.1 单元测试
- 领域：19 条确定性规则、Contract Stance、proposal guard、不变量、
  Unicode 码点 offset、golden set 混淆矩阵。
- API：`app.handle` + 注入 fakes，覆盖状态码、错误码、幂等与边界。
- 数据访问：真实 PG 事务回退隔离（`apps/api/src/db/repositories.test.ts`、
  `repository-parity.test.ts`），fake 与真实仓储的同场景对照。

### 3.2 集成测试（`tests/integration/`）
只覆盖单测无法证明的行为：
- 队列领取的排他性（`SKIP LOCKED` + `FOR UPDATE`）。
- append-only 发现历史、复核→整改事务。
- SSE 事件流首帧与订阅语义。
- Redis 命中/未命中/拒绝/连接失败的降级路径。
- S3 真实往返、写失败本地回退、locator 记录实际后端、路径穿越拒绝。
- 访问门禁的匿名拒绝 / 会话登录登出 / Bearer / 伪造 cookie。

集成测试使用**独立测试数据库身份**：`TEST_DATABASE_URL` 指向一次性数据库，
 helper 会先读回 `current_database()` 校验身份，拒绝 `production`/`prod` 名称，
 并且每个用例都在始终回滚的事务里执行。**不存在任何重置用户数据库、
 `DROP DATABASE` 或全表 `TRUNCATE` 的步骤。**

### 3.3 E2E 验收（`tests/acceptance/`）
浏览器层只断言运营者可见行为与消费者错误，不断言措辞或实现细节：
- 上传→证据→复核→整改闭环。
- 重新审计（rerun）契约：新案件、新 Run、同 Source Record / 同一 Contract
  Revision，原案件的快照、发现、复核与整改不变。
- 窄屏（375px）可访问性、1440×900、1920×1080、1280 宽。
- 共享数据库清理：`tests/acceptance/db-cleanup.ts` 解析与 webServer 完全一致
  的数据库身份（`.env` 之上叠加 `PLAYWRIGHT_DATABASE_URL`），只删除本运行
  创建的案件及其关系链。

## 4. 失败判定

- 单元/集成失败：命令退出码非 0，报告 `status: failed` 并记录退出码。
- 无法运行的层：`status: skipped` + 原因（缺 `TEST_DATABASE_URL`、无
  Chromium、S3 未配置）。跳过是报告，不是失败。
- 分支覆盖率不可测：报告 `null` 并注明工具限制，不估算、不用行覆盖率代替。
- 任何“已通过”结论必须能追溯到 `artifacts/qa/<SHA>/` 下的报告文件。

## 5. 命令入口

```bash
make test              # 单元
make test-integration  # 集成（需要 TEST_DATABASE_URL）
make test-e2e          # Playwright 验收（需要 Chromium + 数据库）
make test-all          # 三层串联
make coverage          # 单元 LCOV + 分层摘要
make verify            # lint + typecheck + 单元（既有门禁不变）
make qa-report         # 分层报告：SHA、环境、命令、退出码、工件
make qa-faults         # 故障注入场景
make demo-ready        # 演示就绪门禁（转发给 demo CLI 的 ready，含重复重置校验）
```

`qa:report` 的输出 `artifacts/qa/<SHA>/summary.json` 与 `summary.html` 记录
Git SHA、分支、dirty 状态、Bun 版本、平台、各层命令原文、退出码、耗时与计数，
因此每份报告都能被追溯到产生它的提交。

## 6. 参考规范（采纳方式）

- ISO/IEC 25010:2023 质量模型：用于组织“可测试性/可维护性”讨论，不宣称认证。
- Playwright Best Practices：role/label 定位、单 worker、失败工件归档。
- OWASP ASVS 5.0：访问门禁、上传校验、敏感信息不外泄的测试设计参考。
