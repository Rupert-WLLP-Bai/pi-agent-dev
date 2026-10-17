# TraceEvent 契约（TI-PREP-03）

状态：冻结（2026-10-17）。版本：`trace-event.v1`。  
依赖：[TI-PREP-02 审计](../project/evidence/m2/ti-prep-02-audit.md)、[ADR 0005](../adr/0005-turn-boundaries-in-the-agent-trace.md)、领域模型 `AgentTraceStep` / `AgentRun`。

本契约冻结 Execution Inspector 消费的事件形状与文件所有权。未冻结前不得改轨迹产品代码；冻结后实现不得悄悄改 wire 语义。

## 1. 权威来源

| 层级 | 权威 | 说明 |
| --- | --- | --- |
| 领域 | `packages/audit/src/model.ts` → `AgentRun`, `AgentTraceStep`, `AgentTraceStepKind`, `AgentTraceStage`, `AgentTraceTokens` | 持久化与 API 的源类型 |
| HTTP | `GET /api/audit-cases/:id/trace`, `GET /api/agent-runs` | 历史只读 |
| 实时 | SSE `agent.trace` / `agent.started` | 增量提示；UI 可 refetch 全量，合并语义属 TI-M2 |
| UI 规范化 | `apps/web/src/trace/normalize-trace-events.ts` → `TraceEvent` | 展示投影；不改变领域结论 |

## 2. TraceEvent（UI 投影）

每个持久化 `AgentTraceStep` 映射为一个 `TraceEvent`。字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | string | `${runId}:${sequence}`，稳定 |
| `runId` | string | 来自步骤 |
| `sequence` | number | 来自收集器；排序主键 |
| `kind` | `STAGE \| TOOL_CALL \| TOOL_RESULT \| MESSAGE` | 原样 |
| `at` | string (ISO) | 原样；解析失败 → `timeTrust: "invalid"` |
| `label` | string | 工具名或 stage 码 |
| `ref` / `parentRef` | string \| null | 原样；配对仅用 `ref` |
| `input` / `output` | unknown \| null | 原样；UI 折叠展示 |
| `isError` | boolean | 原样 |
| `durationMs` | number \| null | null → 展示「未提供」 |
| `tokens` | `{input,output,...} \| null` | null → 「未提供」 |
| `lane` | `input \| model \| tool` | STAGE/MESSAGE→`model`；TOOL_*→`tool`；未来人类/系统输入→`input`（当前无独立 kind 时 STAGE 入口可标 input） |
| `timeTrust` | `recorded \| inferred \| invalid` | 有合法 `at`→`recorded`；禁止用间隔推断耗时 |
| `pairId` | string \| null | 工具配对用的 `ref` |
| `redacted` | boolean | 脱敏适配后为 true |

### 泳道映射（TI-M1）

- **input**：运行输入概况（快照身份、操作人）— 来自案件/运行元数据，不是逐步事件时在概况区展示。
- **model**：`MESSAGE`、`STAGE`（含 TURN_* / RUN_*）。
- **tool**：`TOOL_CALL`、`TOOL_RESULT`。

### 缺失指标

凡 `null`/`undefined` 的 `durationMs`、`tokens`、`usage` 一律渲染文案 **「未提供」**。不得：

- 用相邻事件墙钟差冒充模型或工具耗时；
- 把缺失 usage 填成 0；
- 把空白间隔画成忙碌条。

## 3. 运行概况（Run Overview）

来自 `AgentRun` + 步骤聚合：

- 身份：`provider` / `model` / `version`
- `durationMs`、`usage`、`error`、`createdAt`、`stepCount`
- 缺失字段：「未提供」
- 状态：沿用现有 `getAgentRunState`，不新造状态机

## 4. 文件所有权（冻结）

| Owner | 路径 | 职责 |
| --- | --- | --- |
| Main | `docs/architecture/TRACE-EVENT-CONTRACT.md`、本工作包说明、公共 DTO 变更 | 契约变更门禁 |
| TI-A (B) | `packages/pi-agent/src/trace.ts`、`packages/audit/src/{model,agent-trace,ports}.ts`、`apps/api/src/db/repositories/agent-trace.repository.ts`、`apps/api/src/routes/agent-runs.ts`、SSE 发布路径 | 生产、持久化、API |
| TI-B (A) | `apps/web/src/trace/**`、`apps/web/src/routes/audit-trace.tsx`、`apps/web/src/routes/audit-runs.tsx`、`apps/web/src/components/agent-trace-*.tsx` | 规范化、双视图、泳道、Inspector UI |
| TI-C (C) | `apps/web/src/**/*.test.*` 中轨迹相关、`tests/acceptance/*trace*`、QA 报告脚本中的轨迹场景 | 单元/集成/E2E |

跨 Owner 改 wire 字段必须先改本契约并经 Main 确认。

## 5. 非目标（本冻结）

- TI-M2 Inspector 页签、搜索筛选、SSE 增量合并协议（后续增补修订）
- 影子决策关联（字段不可查询时标「未关联」；不假定 M3）
- 认证 / SEC3

## 6. 兼容与回滚

- 旧轨迹无 `TURN_*` 的仍可读；UI 可用合成根轮次展示（ADR 0005）
- 回滚：恢复契约上一版并还原 `apps/web/src/trace/**`；数据库步骤表不重写
