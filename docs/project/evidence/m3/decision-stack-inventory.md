# M3 决策 / 影子模式 · 代码盘点

日期：2026-10-17。来源：云端探索任务（M3 decision stack inventory）。**不代替 M3 发布验收**；任务板 M3 行仍为 TODO / PARTIAL，须在 M2-B03 通过后再做合并闸门。

## 已实现（待 M3 统一验收）

| 区域 | 路径 / 要点 |
| --- | --- |
| 领域契约 | `packages/audit/src/decision.ts`、`decision-contract.ts`；`DecisionMode` = `off` \| `shadow` |
| Provider | `apps/api/src/decision/` — Disabled / Fake / Laya CPU；`createDecisionProvider` |
| 配置 | `decision/config.ts` — `DECISION_MODE` 仅 `shadow` 启用，否则 **off**（默认）；见 `.env.example` |
| 影子 worker | `shadow-worker.ts`、`derive.ts`、`shadow-repository.ts`；`dispatcher` 正式成功后派生 |
| 持久化 | `shadow_jobs`、`shadow_feedback`（`drizzle/0018_*.sql`） |
| HTTP | `routes/decisions.ts` — 列表/详情/反馈/保留策略 |
| 前端 | `routes/decision-advice.tsx`、`decision-advice-panel.tsx`；影子免责声明、未校准标注 |
| 脚本 | `scripts/decision/evaluate.ts`、`smoke.ts`、`pg-smoke.ts`、`laya-setup.ts` |
| Fixtures | `tests/fixtures/decision/clauses.ts`（60 条开发参考标签） |

## 相对任务板的缺口（关闭 M3 前须补证据）

| 任务 | 缺口 |
| --- | --- |
| M3-A02 | 专家签核标签、资源口径、可归档评测 JSON；Fake 与真实推理分报 |
| M3-B01 | 无独立人工 gold；规则/Pi/影子三方对照未作为发布证据收口 |
| M3-B02 | 面板已有能力，待 M3 UX 签收与截图归档 |
| M3-B03 | **未发布 v0.9.0**；迁移回滚 / feature-flag 兼容（S3.3）；Laya 不合格时保持关闭的发布决议 |

## 执行顺序

1. 先完成 M2（含 v0.8.0 闸门）。  
2. 再对上表缺口跑 M3 合并验收，默认 `DECISION_MODE=off` 不变。  
3. 认证（SEC3）仍最后处理。
