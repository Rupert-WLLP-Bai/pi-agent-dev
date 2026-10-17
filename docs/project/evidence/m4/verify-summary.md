# M4 · verify 摘要（本分支）

日期：2026-10-17。机器可读：[verify-summary.json](./verify-summary.json)。

## 本轮实跑

| 步骤 | 结果 |
| --- | --- |
| `bun run verify` | 退出码 0 |
| lint (`biome check .`) | 通过；1 条 warning（`apps/web/index.html` IIFE 风格） |
| typecheck | 两轮 `tsc` 通过 |
| `bun test packages apps` | **822** pass / **0** fail / **27** skip；2651 expect；90 文件；≈26.5s |

Git：`a045ee59e0498db5efa2f1fa33fce10f48cb37fd`（`cursor/m2-v080-startup-5ade`）。

## 环境限制（诚实声明）

- 本 VM **无 Docker**；未启动 PostgreSQL / Redis / RustFS。
- **27 skip** 主要为 DB 集成仓库测试（claim/review/remediation/rerun/rotation 等）；不代表失败。
- 未执行：`bun run test:all`、`bun run acceptance`、`demo:verify`、带真实 S3 的 `qa:faults`。

## 与 M1 全闸门的关系

v1.0.0 候选仍须在新鲜 TEST 环境复跑四层闸门。M1 已归档全绿证据：

- [release-gate-2026-10-17.json](../m1/release-gate-2026-10-17.json)
- [github-ci-2026-10-17.json](../m1/github-ci-2026-10-17.json)

本摘要证明**当前分支**在受限环境下 lint/typecheck/单元层仍绿；**不**替代 M4-B04 最终发布闸门。
