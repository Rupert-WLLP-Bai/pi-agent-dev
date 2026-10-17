# Contract Audit 开发交接

更新：2026-10-17。**M1/v0.7.0 已发布**；**M2/v0.8.0 主执行**；**M3/M4 文档与局部证据并行准备**。唯一任务板：[TASK-BOARD](./TASK-BOARD.md)。

## 里程碑与发布记录

| Milestone | 记录 | 状态 |
| --- | --- | --- |
| M1 / v0.7.0 | [RELEASE-v0.7.0](./RELEASE-v0.7.0.md) | 已发布 |
| M2 / v0.8.0 | [RELEASE-v0.8.0](./RELEASE-v0.8.0.md) | IN_PROGRESS（分支 `cursor/m2-v080-startup-5ade`） |
| M3 / v0.9.0 | [RELEASE-v0.9.0](./RELEASE-v0.9.0.md) | IN_PROGRESS；默认 `DECISION_MODE=off` |
| M4 / v1.0.0 | [RELEASE-v1.0.0](./RELEASE-v1.0.0.md) | 候选清单；Tag 未打 |

- M1 执行视图快照：[recovery/2026-10-17/m1-execution-view-snapshot.md](./recovery/2026-10-17/m1-execution-view-snapshot.md)
- M3 代码盘点：[evidence/m3/decision-stack-inventory.md](./evidence/m3/decision-stack-inventory.md)
- M3 验收对照：[evidence/m3/acceptance-checklist.md](./evidence/m3/acceptance-checklist.md)
- M4 verify（本分支受限环境）：[evidence/m4/verify-summary.md](./evidence/m4/verify-summary.md)
- M4 演示 / RTM：[evidence/m4/demo-script.md](./evidence/m4/demo-script.md)、[evidence/m4/rtm-index.md](./evidence/m4/rtm-index.md)

## 约束

- **SEC3** 认证延期到最后；不恢复登录口令。
- **M3-B01** 专家 gold：**BLOCKED**（真人签核；不造标签/指标）。
- DEV `.env` 指纹不变；受管 `.demo.env` 0600 且忽略提交。

## 当前执行视图

### M2（主）

| ID | 名称 | 状态 |
| --- | --- | --- |
| M2-A01 | 双主题设计系统 | IN_PROGRESS |
| M2-A02 | 信息架构与路由 | IN_PROGRESS |
| M2-A03 | 核心工作区 | TODO |
| M2-B01–B03 | 页面一致 / 响应式 / v0.8.0 发布 | TODO |
| TI-PREP-02 | 数据审计 | IN_PROGRESS |
| TI-PREP-03 / TI-M1-* | Trace 契约 / 基础轨迹 | TODO |

### M3 / M4（准备，不打 Tag）

| ID | 名称 | 状态 |
| --- | --- | --- |
| M3-A01–A03 | 契约 / Laya / Shadow | IN_PROGRESS |
| M3-B01 | 专家对照评测 | **BLOCKED** |
| M3-B02–B03 | 可视化 / v0.9.0 文档 | IN_PROGRESS |
| M4-B01 / B03 | 演示脚本 / RTM | IN_PROGRESS |
| M4-A02 / B04 | 全 E2E / 最终发布 | TODO |

## 2026-10-17 本分支 verify（摘要）

`bun run verify` 退出码 0：**822** pass / **0** fail / **27** skip（无 Docker、PG 集成 skip）。不等同 M1 四层 gate 或 v1.0.0 发布闸门。详见 verify-summary。

## 历史

2026-10-17 M1 发布摘要与认证延期证据仍见 [RELEASE-v0.7.0](./RELEASE-v0.7.0.md) 与 [authentication-deferred](./evidence/m1/authentication-deferred-2026-10-17.json)。更早接管记录见 Git 历史 `350c084` 前 HANDOFF。
