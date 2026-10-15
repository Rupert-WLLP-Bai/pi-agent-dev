# M1 文件所有权

当前依据：2026-10-15 Milestone-Based Development Master Plan。最多三个主要Subagent；Main负责集成、运行共享服务/迁移、提交、发布闸门与Tag。旧五Agent工作树及其提交保留为历史，当前不再分派工作。

| Owner | 唯一可编辑范围 | 当前执行者/状态 | 交接约束 |
| --- | --- | --- | --- |
| Main | 所有文档、根配置、公共领域/API契约、`apps/api/src/app.ts`、版本与发布；本轮集成中的`routes/decisions.ts`、`scripts/demo/cli.ts`、`managed-environment.ts`、`tests/acceptance/db-cleanup.ts`及其`tests/integration/acceptance-cleanup.test.ts`回归 | 主会话；M1 A | 文件移交后才允许子Agent修改；独占共享迁移/服务和最终Git操作 |
| A Frontend/UX | `apps/web/**` | FrontendIntegrationResume，当前typed API改动已冻结；此前VisualRedesign改动已交接 | 不改公共DTO、API、根配置或文档；新暗色/主题切换须等M1发布后 |
| B Backend/AI | `apps/api/**`、`packages/audit/**`、`packages/pi-agent/**`及API迁移；排除Main临时持有的集成文件 | DecisionIntegrationResume，当前切片已冻结、等待M1后续差异任务 | 公共接口先由Main冻结；只生成迁移建议，不执行共享迁移 |
| C QA/DevOps/Delivery | `tests/**`、`scripts/qa/**`、`scripts/demo/**`及明确分配的CI工作流；排除Main临时持有的两个演示脚本与cleanup修复/回归 | QualityDeliveryResume，QA切片已冻结并交接 | 根级配置、Compose、文档变更交Main；验收只使用明确隔离TEST目标；不动DEV数据 |

同一文件始终一个Owner。跨Owner需求由Main发布到现有[公共契约](../architecture/INTEGRATION-CONTRACT.md)，再交接。子任务不重复启动数据库、重置数据、迁移或更新全局配置；测试由Main统一调度，所有实际运行结果区分执行者和源代码版本。

当前M1门禁未通过，不启动正式M2/M3/M4开发。既有浅色改版和默认关闭的决策实现予以保留并回归，不能据此宣布后续Milestone已发布。
