# M3 · v0.9.0 发布准备记录

2026-10-17。本记录描述**已在树内的影子决策栈**与 v0.9.0 候选边界；**不等同于已打 Tag 的正式发布**。M2/v0.8.0 浏览器闸门仍进行中；M3 合并验收在 M2-B03 之后收口。

## 默认行为与配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DECISION_MODE` | `off` | 仅显式设为 `shadow` 时启用影子派生与建议；任何其他值均视为 **off** |
| Provider 选择 | 由 `createDecisionProvider` 解析 | `disabled`（off）、`fake`（确定性本地）、`laya-cpu`（本地 HTTP，需受控 origin） |

配置入口：`apps/api/src/decision/config.ts`、根 `.env.example`。影子 worker 在正式审计成功后派生，失败隔离不污染案件状态（见 `dispatcher` + `shadow-worker.ts`）。

## 已交付适配器（可替换）

| Provider | 路径 | 用途 |
| --- | --- | --- |
| Disabled | `apps/api/src/decision/providers/disabled.ts` | 默认 off；不推理 |
| Fake | `apps/api/src/decision/providers/fake.ts` | 离线评测与 PG smoke；无外部模型 |
| Laya CPU | `apps/api/src/decision/providers/laya-cpu.ts` | 本地 loopback 推理；需 `laya-setup` 与 allowlist origin |

公共契约：`packages/audit/src/decision.ts`、`decision-contract.ts`。HTTP：`apps/api/src/routes/decisions.ts`。UI：`apps/web/src/routes/decision-advice.tsx`、`decision-advice-panel.tsx`（含影子免责声明与未校准标注）。

## 已知限制（不得夸大）

- **无专家人工 gold**：`tests/fixtures/decision/clauses.ts` 60 条为**开发参考标签**；不得称为独立人工签核或生产准确率。
- **Laya macroF1 仅参考**：历史实跑约 macroF1=0.4033（参考标签，P95≈495ms，60/60 回答）；未校准，**不是**正式规则或 Finding 依据。见 [BASELINE](./BASELINE.md) 与 M3-A02 任务板。
- **Fake 评测分报**：本轮云端归档 Fake 路径见 [decision-evaluate-fake.json](./evidence/m3/decision-evaluate-fake.json)（macroF1≈0.306，标签来源同上）；与 Laya 数字不可混称为“模型正确率”。
- **Jev 接入已取消**：不引入远程商业决策依赖；扩展说明见任务板 Jev 子范围 CANCELLED。
- **M3-B01 BLOCKED**：规则/Pi/影子三方对照需**真人签核** gold；Agent 不可代造标签或 KPI。
- **SEC3 认证延期**：决策详情当前与主 API 同开放边界；部署侧须限制网络访问。

## 回退

1. 设置 `DECISION_MODE=off`（或移除该变量）并重启 API。
2. 已持久化的 `shadow_jobs` / `shadow_feedback` **保持只读可查**；正式案件、Finding、复核、整改、快照**不被改写**。
3. 迁移 `drizzle/0018_*` 已提交；回退版本时按 [task-management](./task-management.md) 与 Drizzle 兼容策略处理，**不删除**已审阅业务数据。

## 验收与证据索引

| 文档 | 用途 |
| --- | --- |
| [decision-stack-inventory.md](./evidence/m3/decision-stack-inventory.md) | 代码盘点 |
| [acceptance-checklist.md](./evidence/m3/acceptance-checklist.md) | M3-A01–B03 对照 |
| [decision-evaluate-fake.json](./evidence/m3/decision-evaluate-fake.json) | 离线 Fake 评测 JSON |

离线评测命令（无需 Laya、无需凭据）：

```bash
bun scripts/decision/evaluate.ts --provider fake \
  --out docs/project/evidence/m3/decision-evaluate-fake.json
```

Laya 路径需本地 endpoint 与 `--allowed-origin`；见脚本头注释与 `scripts/decision/laya-setup.ts`。

## 发布状态

- **Tag v0.9.0**：未创建（M3-B03 TODO）。
- **合并闸门**：M3-A01–A03、M3-B02 为 IN_PROGRESS；M3-B01 专家 gold **BLOCKED**。
