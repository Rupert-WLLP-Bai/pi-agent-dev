# 覆盖率基线（Coverage Baseline）

基线提交：`6a59906`（2026-10-15 冻结 S1）。测量命令：

```bash
bun run test:coverage     # bun test --coverage --coverage-reporter=lcov
bun run qa:coverage       # 解析 LCOV，写出分层摘要
```

输出：`artifacts/qa/<SHA>/coverage/lcov.info` 与
`artifacts/qa/<SHA>/coverage/layers.json`。

## 1. 单元覆盖率（行 / 函数）

> 下列数字是冻结提交 `6a59906` 上的**基线上下文**，用于对比风险驱动增量；
> 最终口径以 Main 集成后统一运行的报告为准。

| 指标 | 实测值 | 目标 | 结论 |
| --- | --- | --- | --- |
| 全仓库行覆盖率 | **81.1%** | ≥ 75% | 达标 |
| 全仓库函数覆盖率 | **82.8%** | — | 记录 |
| `packages/audit` 行覆盖率 | **98.7%** | ≥ 90% | 达标 |
| `packages/audit` 函数覆盖率 | **97.4%** | ≥ 80% | 达标 |
| **分支覆盖率** | **不可测量（null）** | ≥ 80% | **BLOCKED** |

分支覆盖率为 BLOCKED 的原因是可验证的事实，不是回避：Bun 1.4.3 的
`--coverage-reporter=lcov` 输出只有 `FNF/FNH/LF/LH/DA` 记录，没有
`BRDA/BRF/BRH`（已用 `grep -c '^BRDA' lcov.info` 验证为 0）。因此本报告不用
行覆盖率替代分支覆盖率，也不估算比例。要关闭这个 BLOCKED，需要引入独立的
分支剖析工具（例如 V8 coverage + istanbul 报告），属于新增重型依赖，需单独
论证必要性与成本。

## 2. 集成场景覆盖（计数，非百分比）

| 场景族 | 文件 | 场景数 | 需要真实依赖 |
| --- | --- | --- | --- |
| 案件生命周期 / 队列排他 / SSE | `tests/integration/audit-lifecycle.test.ts` | 3 | PostgreSQL |
| Redis 缓存命中与降级 | `tests/integration/redis-cache.test.ts` | 3 | Redis（1 个需真实实例） |
| S3 往返 / 回退 / 穿越 | `tests/integration/original-store.test.ts` | 5 | RustFS/S3（2 个需真实实例） |
| 访问门禁黑盒 | `tests/integration/access-gate.test.ts` | 8 | 无（需 `AppDeps.access` 已集成） |
| 故障注入 | `scripts/qa/faults.ts` | 4 | PostgreSQL |

场景是否可运行由环境决定，并在报告里记为 `skipped` + 原因；未运行的场景
不计入通过数。

## 3. E2E 需求覆盖

见 `docs/quality/traceability.csv` 的 `test_ref` 与 `evidence_ref` 列。
`bun run test:e2e` 通过 Playwright 的 JSON reporter 写出
`artifacts/qa/e2e/results.json`，使需求→用例映射可从真实运行重新生成，而不是
手工维护。

## 4. 已知低覆盖区域（风险驱动，非目标数字）

来自基线的低覆盖文件及其原因：

| 文件 | 行覆盖率 | 原因 / 处置 |
| --- | --- | --- |
| `apps/api/src/sse.ts` | 7.7% | 由集成测试覆盖（`tests/integration/audit-lifecycle.test.ts`），单测只测 broker |
| `apps/api/src/db/rule-repository.ts` | 4.2% | 由真实 PG 集成测试与验收覆盖 |
| `apps/api/src/llm/reencrypt-provider-keys.ts` | 15.8% | 已被 Main 的 `reencrypt-plain-keys.ts` 取代（cd24aac） |
| `packages/audit/src/remediation-closure.ts` | 0.0% | 由 `remediation-closure.test.ts` 覆盖；LCOV 里出现 symlink 重复路径，已去重 |
| `packages/pi-agent/src/runtime.ts` | 16.4% | 真实模型路径需外部网关，CI 不使用真实凭证；fake 路径已覆盖 |

去重规则：Bun 会同时记录 `packages/audit/src/x.ts` 与经由主检出 symlink 的
`../../<main>/packages/audit/src/x.ts` 两条记录，`scripts/qa/coverage.ts` 只
保留包内路径，避免双计。

## 5. 复现方式

```bash
git checkout 6a59906
bun install --frozen-lockfile
bun run test:coverage
bun run qa:coverage
cat artifacts/qa/$(git rev-parse HEAD)/coverage/layers.json
```
