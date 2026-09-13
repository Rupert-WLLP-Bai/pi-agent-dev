# P1 闭环模块开发计划 — 复核中心 · 整改跟踪 · 规则管理 · 案例验证

> 2026-09-13 · 依据 `docs/design/ui-design-spec.md` v1.2 §4.4/4.5/5.1/5.2 + `apps/web/public/pages-sketch.html` #04–#08
> 术语警告：仓库与规格中拼写为 **整改跟踪**（不是"整改追踪"），实现必须沿用现有字面。

## 完成状态（2026-09-13）

✅ 全部落地。main 分支：4 路由（/reviews /remediations /rules /rules/:id /cases）全部开放，导航启用；349 单测 + 25/25 Playwright 验收全绿；17 条规则（5 原有 + 12 调研新增）seed 已发布；验证案例 92 条物化；drizzle 快照链已修复（0007 调和迁移）；验收 spec 自清理不再污染共享开发库。四个 slice 分支保留：feat/review-center、feat/rules-management、feat/rules-expansion、feat/remediations。

## 1. 现状（侦察结论）

| 维度 | 现状 |
|---|---|
| 前端 | 4 个侧栏占位 `disabled: true`（app-shell.tsx），无路由、无页面 |
| 复核后端 | 仅 `POST /api/findings/:id/reviews`（ACCEPTED/REJECTED+reason）→ **任一复核即案件 COMPLETED**；无队列、无指派、无 SLA |
| 规则 | 5 条规则硬编码 TS（payment/penalty/termination/dispute/subject），参数默认值写死在 orchestrator（0.3 / 0.3 / 重庆），无 DB、无版本 |
| 案例验证 | 仅 `packages/audit/src/golden-set.ts`（12 例）+ `bun test` 基准；无持久化、无 API、无 UI |
| 整改 | 完全不存在 |
| 迁移 | journal idx 0–2，下一个 **0003** |
| 脏树 | main 上有 21 文件 +1258/−428 未提交（UI 可观测性/趋势图工作） |

## 2. 待用户确认的决策（grilling Q1–Q7）

| # | 决策 | 确认结果（2026-09-13 用户拍板） |
|---|---|---|
| Q1 | 脏树处理 | ✅ 已提交 baseline（15885c6）+ 计划文档（55f1180） |
| Q2 | 操作人模型 | ✅ 轻量操作人（无登录，自由文本） |
| Q3 | 复核语义 | ✅ 逐条复核，全审才 COMPLETED |
| Q4 | 规则管理深度 | ✅ 参数集版本化；动态 DSL 作为未来拓展方向写入文档，不实现 |
| Q5 | 验证案例数据源 | ✅ golden-set.ts canonical + seed 物化 |
| Q6 | 整改项来源 | ✅ ACCEPTED 自动生成 |
| Q7 | 演示数据 | ✅ 扩充规则库（网络调研目录驱动，Wave2 Slice G），演示命中多种情况 |

追加指令（用户）：实现全部交由 task agent，大脑只做完成后 review 并继续派发；不再中途确认，直到四个板块全部实现。

Slice G（新增，Wave2，基于 B）：按 RulesResearch 产出的规则目录实现 6–12 条新确定性规则（TS 模块 + golden 案例 + seed），使演示命中多样化风险。

## 3. 波次与并行结构（多 agent · 多 worktree）

```
W1 (并行, 两个 worktree):
  feat/review-center      Slice A 复核中心
  feat/rules-management   Slice B 规则管理
W2 (并行, 各自基于 W1 分支):
  feat/validation         Slice C 案例验证   (基于 B 的 rule_versions)
  feat/remediations       Slice D 整改跟踪   (基于 A 的复核语义)
W3 (main):
  Slice E 集成：合并、导航开放、CONTEXT.md 术语、ADR、演示数据、全量门禁
```

依赖关系：C 消费 B 的 rule_versions 契约；D 消费 A 的 ACCEPTED 复核路径。A/B 完全不相交。

## 4. 迁移编号预分配（避免 worktree 冲突）

- A → `0003_review_queue.sql`：`audit_cases.assignee text null`、`audit_cases.review_priority text null`
- B → `0004_rule_versions.sql`：`rules`、`rule_versions`
- C → `0005_validation.sql`：`validation_cases`、`validation_runs`、`validation_results`
- D → `0006_remediations.sql`：`remediations`
- 每个 slice 手写 SQL + 追加 `meta/_journal.json` 条目（idx 已错开，合并无冲突）

## 5. Slice 规格

### Slice A — 复核中心 `/reviews`

**后端**
- 复核语义升级（Q3）：`appendReviewRevision` 不再直接置 COMPLETED；改为"全部链头发现均有 Human Review → COMPLETED"；零发现案件保持现状。更新 `tests/acceptance/agent-trace.spec.ts`、`audit-case.spec.ts` 中单条复核即完成的断言。
- 新增（`apps/api/src/routes/reviews.ts`）：
  - `GET /api/reviews/queue`：链头 FindingProposal 投影（合同名、发现标题、severity、证据冲突标记=NEEDS_HUMAN_REVIEW、assignee、priority、dueAt、剩余时长），排序：证据冲突 > 高风险 > 临近超时。
  - `POST /api/audit-cases/:id/assignment`：`{assignee?, priority?}`（受理/转交/优先级，批量逐案调用即可）。
- SLA：`dueAt = case.created_at + SLA_HOURS`（config 新增，默认 24h），派生值不入库。
- 事件：`review.assigned` 加入 AuditEvent union（packages/audit/src/ports.ts）。

**前端**
- `routes/reviews.tsx` + `components/review-center.tsx`：左队列（筛选：待我处理/临近超时/证据不足/已转交）+ 右侧复用案件工作区（跳 `/audit-cases/:id?origin=reviews`）。
- 批量操作仅 转交 + 设置优先级（Dropdown）；禁止批量确认/驳回。
- 案件工作区返回链接已支持 `origin` 参数（spec §4.3）。

**测试**：队列排序纯函数 bun:test；`tests/acceptance/review-center.spec.ts`（受理→复核→关闭全流程）。

### Slice B — 规则管理 `/rules` + `/rules/:id`

**后端**
- 表：`rules`（code 唯一、name、适用合同类型、描述）；`rule_versions`（rule_id、version、`params jsonb`、`stances jsonb`（首选/可退让/不可接受/例外审批）、status: draft|published|retired、published_by、published_at、last_validation_run_id null、created_at）。Seed 5 条规则 + v1 已发布（参数=现默认值）。
- 新 `apps/api/src/routes/rules.ts` + `RuleRepository`（独立文件，不动 AuditCaseRepository）：
  - `GET /api/rules`（表格列：规则名/代码/适用类型/当前版本/状态/最近验证/发布人）
  - `GET /api/rules/:id`（含版本历史 + 当前草稿）
  - `POST /api/rules`、`POST /api/rules/:id/versions`（新建草稿：params+stances）
  - `POST /api/rules/:id/publish`：门禁=该草稿存在全绿验证运行，否则 409 + 原因（发布按钮禁用态的前置）
- 运行时接线：`createAuditSnapshot` 接受注入的规则参数（port 化），API 层从已发布版本读取；snapshot 的 rule_assessment 记录 `ruleVersion`（满足 spec §4.3 V2 的引用要求）。golden bench 与 fakes 同步适配。

**前端**
- `routes/rules.tsx`（表格 + 搜索 + 状态/类型筛选）+ `routes/rule-detail.tsx`（五区：基础信息/审查逻辑/条款立场/验证案例/发布记录）；发布按钮在无全绿验证时禁用并显示原因。

**测试**：发布门禁 bun:test（409 路径）；`tests/acceptance/rules.spec.ts`。

### Slice C — 案例验证 `/cases`（基于 B）

**后端**
- 表：`validation_cases`（rule_code、类型：正例/反例/边界例/历史误报/证据缺失、名称、输入、期望处置）；`validation_runs`（rule_version_id、triggered_by、时间、汇总）；`validation_results`（run_id、case_id、expected、actual、passed|failed|needs_review、差异说明）。Seed 从 golden-set.ts 物化。
- `apps/api/src/routes/validation.ts`：
  - `GET /api/validation/cases`
  - `POST /api/validation/runs`（body: ruleId 或全部）→ 以该版本 params 跑 `createAuditSnapshot`，逐例比对处置，持久化 run+results，返回与同规则上一次运行的回归差异。
  - `GET /api/validation/runs/:id`
- 语义：`needs_review` 不计通过也不计失败；结果绑定规则版本（可回滚基线）。

**前端**：`routes/validation.tsx`：五类汇总卡（正例/反例/边界例/误报+证据缺失）+ 结果表（案例/类型/结果/差异说明）+ "按规则版本运行验证"。回写 B 的"最近验证"列。

**测试**：run+diff 比较纯函数 bun:test；`tests/acceptance/validation.spec.ts`。

### Slice D — 整改跟踪 `/remediations`（基于 A）

**后端**
- 表：`remediations`（case_id、finding_revision_id（被 ACCEPTED 的链头）、摘要、severity、owner text、due_at、status: pending|in_progress|awaiting_review|closed、closed_by、closed_at、时间戳）。
- 自动创建：A 的复核路径中 ACCEPTED → 事务内插入 remediation（pending）+ 事件 `remediation.created`。
- `apps/api/src/routes/remediations.ts`：
  - `GET /api/remediations`（看板投影：四列 + 计数）
  - `PATCH /api/remediations/:id`（owner/due/进度说明；状态只能 pending→in_progress→awaiting_review）
  - `POST /api/remediations/:id/close`（独立关闭动作=复核人确认；校验前置状态 awaiting_review；记录 closed_by）
- 事件：`remediation.transitioned`、`remediation.closed`。

**前端**：`routes/remediations.tsx` 看板（四列；卡片=合同名/风险摘要/责任人/截止；逾期三重编码）+ 卡片详情 Drawer（流转操作、关闭确认、跳转案件工作区）。

**测试**：状态机转移规则 bun:test（非法转移 409）；`tests/acceptance/remediations.spec.ts`（复核确认→自动建卡→流转→关闭）。

### Slice E — 集成（main）

- 合并 4 分支（迁移编号已预分配合并即顺）；`app.tsx` 注册 4 路由；`app-shell.tsx` 启用 4 项（按 spec：完成即出现，不留"即将上线"）。
- `api.ts` 合并各 slice 客户端包装。
- CONTEXT.md 新术语：**Remediation Item（整改项）**、**Rule Version（规则版本）**、**Validation Case（验证案例）**、**Validation Run（验证运行）**；各自带 Avoid 词。
- ADR 候选：0003 规则版本化（参数集 + 确定性逻辑分离）；0004 每发现复核完成语义。
- 演示数据（Q7）：规则 5 条已发布 + 各类型验证案例与运行结果 + 各状态整改项。
- 全量门禁：`bun run verify` + `bun run acceptance`（绿后才算完成）。

## 6. 共享文件契约

- A/B 各自新文件为主；`app.tsx`、`app-shell.tsx`、`api.ts`、`db/schema.ts` 的注册/导出统一留到 E 合并（slice 内也允许各自编辑——worktree 隔离，E 负责合并）。
- `packages/audit/src/ports.ts` 的 AuditEvent union：A 加 review.assigned + remediation 事件由 D 加；E 合并。
- 每 slice 跳过格式化/全局门禁（orchestrator 在 E 统一跑）；每 slice 必须自证：`bun check` + 本 slice 相关 `bun test` 通过。

## 7. 验证门禁（每波后）

1. `bun check`（类型）
2. 包级 `bun test`（本 slice 单测）
3. `bun run acceptance`（Playwright，含新增 spec）
4. 红树不合并；修复子代理 → 重跑门禁。
