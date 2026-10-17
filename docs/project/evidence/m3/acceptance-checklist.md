# M3 验收对照清单

日期：2026-10-17。分支：`cursor/m2-v080-startup-5ade`。本表将任务板 M3 项映射到**现有**代码、脚本与证据；**不**将 PARTIAL 实现标为 DONE。

## 总览

| ID | 状态 | 摘要 |
| --- | --- | --- |
| M3-A01 | IN_PROGRESS | 契约与三适配器在树内；待 M3 合并闸门 |
| M3-A02 | IN_PROGRESS | 60 条 fixture + evaluate/smoke；专家标签与资源口径缺失 |
| M3-A03 | IN_PROGRESS | shadow worker + PG 表 + 单测；完整 feature-flag 回退待 S3.3 |
| M3-B01 | **BLOCKED** | 无独立人工 gold；不可由 Agent 代造 |
| M3-B02 | IN_PROGRESS | 面板与 DTO 已有；待 UX 签收截图 |
| M3-B03 | IN_PROGRESS | 发布文档与 Fake eval 已归档；Tag 未打 |

---

## M3-A01 · 决策公共契约

| 验收点 | 位置 | 证据 |
| --- | --- | --- |
| 版本化 Request/Advice/Feedback/查询/错误 | `packages/audit/src/decision.ts`、`decision-contract.ts` | S1 契约测试（任务板 S1.1 DONE） |
| Disabled / Fake / Laya 可替换 | `apps/api/src/decision/providers/*`、`createDecisionProvider` | `apps/api/src/decision/*.test.ts` |
| 默认 off | `decision/config.ts`、`DECISION_MODE` | `.env.example`；inventory |
| 最小脱敏输入 | `apps/api/src/decision/derive.ts`、问题目录 | 契约与 provider 测试 |

**剩余**：M3 范围统一 typecheck + 集成回归与发布决议（B03）。

---

## M3-A02 · Laya CPU 可行性

| 验收点 | 位置 | 证据 |
| --- | --- | --- |
| 60 条中文合成条款 | `tests/fixtures/decision/clauses.ts` | `FIXTURE_CATEGORIES`；标签注明 developer reference |
| 公平评测脚本 | `scripts/decision/evaluate.ts` | Fake：[decision-evaluate-fake.json](./decision-evaluate-fake.json) |
| Laya smoke / 设置 | `scripts/decision/smoke.ts`、`laya-setup.ts` | 历史 macroF1≈0.4033（参考标签，BASELINE）；本轮云端未重跑 Laya |
| Fake 与 Laya 分报 | evaluate 输出 `provider` 字段 | Fake JSON 已归档；Laya 需本地 endpoint |

**BLOCKED / 缺口**：专家签核标签、统一资源口径（CPU/内存）、可归档 Laya 评测 JSON 与 M3 闸门绑定。

**命令**：

```bash
# 离线（已通过，2026-10-17 云端）
bun scripts/decision/evaluate.ts --provider fake --out docs/project/evidence/m3/decision-evaluate-fake.json

# Laya（需本地服务）
bun scripts/decision/evaluate.ts --provider laya-cpu --endpoint http://127.0.0.1:3847 \
  --allowed-origin http://127.0.0.1:3847 --out artifacts/decision-evaluation-laya.json
```

---

## M3-A03 · Shadow Mode

| 验收点 | 位置 | 证据 |
| --- | --- | --- |
| 正式成功后派生 | `apps/api/src/decision/shadow-worker.ts`、`dispatcher` | dispatcher 单测：shadow 派生、抛错不失败案件 |
| 不写 Finding/规则/复核 | 领域边界 + worker 只写 shadow 表 | G2 契约；shadow 仓库测试 |
| 持久化与反馈 | `shadow-repository.ts`、`drizzle/0018_*.sql` | `scripts/decision/pg-smoke.ts`（需 PG） |
| 默认关、故障隔离 | `DECISION_MODE`、Disabled provider | config 测试 |

**剩余**：S3.3 迁移兼容/完整 off 回归；多副本仍非目标（单进程 dispatcher）。

---

## M3-B01 · 对照与人工标签评测

| 验收点 | 状态 | 说明 |
| --- | --- | --- |
| 固定输入 + Pi/规则/影子输出对照 | **BLOCKED** | 需专家 gold 签核；fixtures 仅为开发参考 |
| 指标报告（F1/延迟/冲突） | PARTIAL | `evaluate.ts` 对单 provider 可出数；三方对照未收口 |
| A5 / A8 反馈与 Guard 回归 | IN_PROGRESS | 代码在树；M3 发布证据未归档 |

**BLOCKED 原因**：任务板与 INTEGRATION-CONTRACT 明确要求——无真人签核不得称为独立人工 gold；本 Agent 不生成专家标签或伪造签核记录。

---

## M3-B02 · AI 建议可视化

| 验收点 | 位置 | 证据 |
| --- | --- | --- |
| 来源/版本/类别/概率/冲突/耗时 | `decision-advice-panel.tsx`、`decision-presentation.ts` | 组件单测 / 路由 |
| shadow 与未校准明示 | `SHADOW_DISCLAIMER`、Alert、`describeDecisionConfidence` | UI 已有；无需本轮大改 |
| 与 API 同一 DTO | `@contract-audit/audit/decision` 类型 | typed client |

**剩余**：M3 UX 签收截图、三档宽度浏览器实测（可复用 M2 视口清单流程）。

---

## M3-B03 · 关闭/兼容/发布

| 验收点 | 状态 | 说明 |
| --- | --- | --- |
| `DECISION_MODE=off` 核心不变 | IN_PROGRESS | 单测 + 局部 smoke；S3.3 完整回退待跑 |
| 历史影子可读 | IMPLEMENTED（待闸门） | off 后列表/详情路由 |
| v0.9.0 Tag / Release | TODO | [RELEASE-v0.9.0.md](../../RELEASE-v0.9.0.md) 候选已写 |
| Jev | CANCELLED | 保持 Disabled/Fake/Laya 可插拔说明 |
