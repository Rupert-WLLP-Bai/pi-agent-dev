# 测试策略与质量矩阵（R2）

> 维护人：Agent 5（Docs）。基准日：2026-10-15。QA 拥有测试实现与 `docs/quality/`；本文规定**策略与口径**，引用 QA 的实际结果而不复制未产生的数字。

## 1. 分层策略

| 层 | 范围 | 工具 | 隔离要求 |
| --- | --- | --- | --- |
| 单元 | 规则、Guard、状态机、转换、Evidence 码点、决策契约 | `bun test packages apps` | 无外部依赖；数据库测试显式跳过并报告 |
| 数据库集成 | 迁移、事务、版本链、复核整改、队列 claim/cancel/恢复 | `bun test` + 真实 PostgreSQL | 独立测试库（`PLAYWRIGHT_DATABASE_URL` 同机制） |
| 浏览器验收 | 上传→审计→复核→整改→重新审计全链路 | Playwright（`bun run acceptance`） | 专用库；`CI=true` 强制干净启动；端口可覆盖 |
| 真实模型冒烟 | 固定合成样本的 Pi/Laya 推理 | 脚本 + 证据 JSON | 只发合成合同；凭据不进报告 |
| 故障/降级 | S3/Redis/模型不可用、重置中断、并发 rerun | 集成测试 + 场景脚本 | 明确区分环境故障与产品缺陷 |

现有入口：`bun run verify`（lint + 两轮 typecheck + 单测）、`bun run acceptance`、`bun --filter @contract-audit/pi-agent run smoke`、`Makefile` 分层入口（`test-unit`/`test-integration`/`test-e2e`/`coverage`/`qa-report`，`de7ea2d` 入树）。QA 的机器可读报告与覆盖率工件已产出（`docs/quality/`、`artifacts/qa/coverage/lcov.info`）；统一运行数字以 S3 为准。

## 2. 测试设计原则

1. **不断言实现细节**：断言业务行为与不变量（快照不可变、修订追加、Guard 拒绝、降级路径），不断言私有结构。
2. **腐化断言零容忍**：S0 已修四类腐化断言（`a79597e`）；新用例不得依赖"未抛错/非空/Mock 转发"。
3. **共享数据库的串行约束**：规则停用会跨用例串台，故 Playwright 单 worker；新用例须评估对全局规则状态的影响。
4. **失败可分类**：环境故障（缺浏览器、库不可达、CDN 不可用）与产品缺陷分开记录，不用前者掩盖后者。
5. **不可测项显式 BLOCKED**：分支覆盖率若工具不支持，报 BLOCKED 而非伪造比例。

## 3. 风险/质量矩阵（与 Main 的 RISKS 对应，不重复维护）

| 主题 | 策略要点 | 关联风险（Main 维护） | 状态 |
| --- | --- | --- | --- |
| 验收契约过期 | rerun 语义改变后重写行为验收（新案/新 Run/旧案保留） | RISK-02 | 已重写（`de7ea2d`）；全绿记录待S3 |
| 清理脚本读根 `.env` | 统一解析数据库覆盖配置，防止误清开发库 | RISK-01 | 已修复（`de7ea2d`：`db-cleanup.ts`） |
| 真实对象存储往返 | put/get/stat + hash 一致性 + 失败不伪报成功 | RISK-04/06 | 集成用例入树（`de7ea2d`）；真实服务统一运行待S3 |
| 降级矩阵 | S3 本地回退、Redis 直连、模型 fake/off | RISK-14 | 用例入树（`de7ea2d`）；`qa:faults` 覆盖；统一运行待S3 |
| 影子故障隔离 | 故障注入对照正式结论不变 | RISK-06/07 | 结构边界测试入树（`a6ec041`）；对照运行待S3 |
| 窄屏可访问性 | 375/1280/1440/1920 实测 | RISK-17 | 行为验收入树（`cc942b2`）；截图归档待S3；视觉重设计后复跑（RISK-18） |
| 覆盖率口径 | 行/函数/分支分开报，不平均 | RISK-10 | 已产出（`de7ea2d`：行81.1%/函数82.8%；分支不可测报null） |

## 4. 已有实测数字（仅引用，带上下文）

- `bun run verify`（独立迁移库，S1 commit `6a59906` 基线）：**670 通过 / 0 失败**，75 个测试文件、1938 次断言，lint 287 文件、两轮 typecheck。
- 安全切片（commit `1f33d99`，隔离 PG）：**688 通过 / 0 失败**；HTTP 层匿名 401/授权 200/登出 204/重放 401。
- Playwright（S0，commit `a4c6119` 基线）：38 例 **37 通过 / 1 失败**；失败为契约过期用例。
- 真实 Pi 冒烟（单合成样本 `equipment-lease`）：29727 ms、42 轨迹步骤、两项提案过 Guard、快照未变；凭据来源为请求值 + 环境变量。
- 本地 Laya CPU 冒烟（单请求）：642 ms、未校准；版本与 revision 见 `acceptance-criteria.md` §2.4。

以上数字**只在其标注的 commit、库与配置下成立**；汇报时不得合并成"总体通过率"。

## 5. 入口与产物（QA 拥有，本文只索引）

| 产物 | 位置 | 说明 |
| --- | --- | --- |
| 单元/集成报告 | `docs/quality/TEST-REPORT.md`（机器报告 `scripts/qa/report.ts`） | 已产出（`de7ea2d`，冻结基线 670/0）；统一运行数字待S3 |
| 覆盖率工件 | `artifacts/qa/coverage/lcov.info`、`docs/quality/COVERAGE-BASELINE.md` | 已产出（`de7ea2d`）；行/函数分开，分支报null |
| 故障注入记录 | `scripts/qa/faults.ts` | 已入树（`de7ea2d`）；需 `DATABASE_URL`，未配置记 skipped |
| 浏览器报告 | Playwright HTML（本地产物） | 已存在运行机制 |
| 发布就绪 | `docs/quality/RELEASE-READINESS.md` | S3 由 Main 整合 |
