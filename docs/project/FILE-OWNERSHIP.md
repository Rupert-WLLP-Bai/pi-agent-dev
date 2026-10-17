# 文件所有权

当前依据：2026-10-15 Milestone-Based Development Master Plan；M1/v0.7.0 已于 2026-10-17 发布，**正式启动 M2/v0.8.0**。最多三个主要 Subagent；Main 负责集成、运行共享服务/迁移、提交、发布闸门与 Tag。旧五 Agent 工作树及其提交保留为历史，当前不再分派工作。

| Owner | 唯一可编辑范围 | 当前执行者/状态 | 交接约束 |
| --- | --- | --- | --- |
| Main | 所有文档、根配置、公共领域/API 契约、`apps/api/src/app.ts`、版本与发布；TraceEvent 契约与 TI 设计说明；共享迁移与最终 Git 操作 | 主会话；M2 启动 | 文件移交后才允许子 Agent 修改；独占共享迁移/服务和最终 Git 操作 |
| A Frontend/UX | `apps/web/**` | M2 产品界面线：双主题、导航/面包屑、核心工作区与其余页面；TI-B 轨迹 UI | 不改公共 DTO、API、根配置或文档；主题/导航可与 TI-PREP 并行，但 Trace 产品改动须等 TraceEvent 契约冻结 |
| B Backend/AI | `apps/api/**`、`packages/audit/**`、`packages/pi-agent/**` 及 API 迁移；排除 Main 临时持有的集成文件 | M2 核心工作区 API 差异；TI-A 规范化/配对/SSE | 公共接口先由 Main 冻结；只生成迁移建议，不执行共享迁移 |
| C QA/DevOps/Delivery | `tests/**`、`scripts/qa/**`、`scripts/demo/**` 及明确分配的 CI 工作流 | M2-B02/B03 视口与闸门；TI-C 阶段验收 | 根级配置、Compose、文档变更交 Main；验收只使用明确隔离 TEST 目标；不动 DEV 数据 |

同一文件始终一个 Owner。跨 Owner 需求由 Main 发布到现有[公共契约](../architecture/INTEGRATION-CONTRACT.md) 及 [TraceEvent 契约](../architecture/TRACE-EVENT-CONTRACT.md)，再交接。子任务不重复启动数据库、重置数据、迁移或更新全局配置；测试由 Main 统一调度，所有实际运行结果区分执行者和源代码版本。

## M2 与 Execution Inspector

- 产品界面线（M2-A01/A02/A03、M2-B01 非 Trace 页面）归 A；跨包 API 变更归 B，契约归 Main。
- Execution Inspector 子工作包角色：TI-A Telemetry/Backend、TI-B Frontend/UX、TI-C QA/Integration。精确文件清单见 [TRACE-EVENT-CONTRACT](../architecture/TRACE-EVENT-CONTRACT.md) 冻结后的所有权表。
- 既有浅色改版是 M2 输入资产，不等于双主题完成。默认关闭的决策实现保留并回归，不能据此宣布 M3 已发布。
- SEC3 认证仍延期到最后，不阻塞 M2。
