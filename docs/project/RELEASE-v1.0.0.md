# Release v1.0.0 · 比赛交付候选清单

状态：候选（未打 Tag）。截止目标 2026-11-10。认证（SEC3）按用户要求**最后**实现，不阻塞本清单文档化。

## 版本叙事

| Milestone | Tag | 状态 | 要点 |
| --- | --- | --- | --- |
| M1 | v0.7.0 | **已发布** | 业务闭环、四层 Gate、GitHub CI 四 job |
| M2 | v0.8.0 | IN_PROGRESS | 双主题、导航、Execution Inspector、Trace 契约 |
| M3 | v0.9.0 | IN_PROGRESS（默认 off） | 影子决策栈 PARTIAL；无专家 gold |
| M4 | v1.0.0 | TODO | 本清单 + 全闸门复跑 |

## 发布闸门检查表

| # | 检查 | M1 证据 | 本分支（2026-10-17） |
| --- | --- | --- | --- |
| 1 | `bun run verify` | release-gate 单元层 | [verify-summary.md](./evidence/m4/verify-summary.md)：822/0/27 skip |
| 2 | `bun run test:all` / `qa:report` | 四层 0 fail | **未在本 VM 执行**（无 Docker/隔离 TEST） |
| 3 | Playwright acceptance | 48 pass | 未执行 |
| 4 | Demo CLI up/ready/reset/verify | M1 实测 | 未执行 |
| 5 | `DECISION_MODE=off` 回归 | 局部 smoke | 默认 off 不变；M3 完整回退待 S3.3 |
| 6 | 安全（密钥/上传/出网） | faults + SEC 切片 | SEC3 除外 |

## 交付物索引

| 文档 | 路径 |
| --- | --- |
| 7–10 分钟演示 | [evidence/m4/demo-script.md](./evidence/m4/demo-script.md) |
| 需求 RTM（精简） | [evidence/m4/rtm-index.md](./evidence/m4/rtm-index.md) |
| verify 摘要 | [evidence/m4/verify-summary.md](./evidence/m4/verify-summary.md) |
| M3 发布准备 | [RELEASE-v0.9.0.md](./RELEASE-v0.9.0.md) |
| M2 发布准备 | [RELEASE-v0.8.0.md](./RELEASE-v0.8.0.md) |
| 任务板 / 交接 | [TASK-BOARD.md](./TASK-BOARD.md)、[HANDOFF.md](./HANDOFF.md) |
| 竞赛长版演示 | [competition/DEMO-SCRIPT.md](../competition/DEMO-SCRIPT.md) |

## 明确延期 / 不宣称

- **SEC3**：无登录、无 `/api/session`；见 [authentication-deferred](./evidence/m1/authentication-deferred-2026-10-17.json)。
- **专家决策 gold、置信度校准（P2）**：无签核不填生产准确率。
- **多副本 dispatcher/SSE**：单进程边界不变。
- **业务 KPI / 成本收益**：未测只写测量计划（R8）。

## M4 任务板诚实状态（摘要）

| ID | 状态 | 说明 |
| --- | --- | --- |
| M4-A01 | IN_PROGRESS | 分层覆盖率；本分支 verify 有行覆盖率输出、无分支 BRDA |
| M4-A02 | TODO | 全 E2E + 真实模型分报 |
| M4-A03 | IN_PROGRESS | 安全切片在树；SEC3 延期 |
| M4-A04 | IN_PROGRESS | Compose/demo 文档；第三方复现待 Infra |
| M4-B01 | IN_PROGRESS | demo-script 已写；现场录屏待归档 |
| M4-B02 | IN_PROGRESS | SRS/ADR/竞品等已有草稿 |
| M4-B03 | IN_PROGRESS | RTM 精简版 + WBS/甘特历史 |
| M4-B04 | TODO | 全闸门 + Tag |
