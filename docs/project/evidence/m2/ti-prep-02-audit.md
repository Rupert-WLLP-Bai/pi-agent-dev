# TI-PREP-02 · Agent Execution 数据审计

日期：2026-10-17。状态：收口完成。依据：[execution-inspector](../../work-packages/execution-inspector.md)。本文件记录字段是否真实存在；缺失指标在 UI 必须显示「未提供」，空白间隔不得冒充模型耗时。

## 1. Run API

| 端点 | 用途 | 主要字段 |
| --- | --- | --- |
| `GET /api/agent-runs?limit=` | 跨案件最近运行 | `id`, `auditCaseId`, `provider`, `model`, `version`, `usage`, `durationMs`, `error`, `createdAt`, `contractTitle`, `parties`, `caseStatus`, `stepCount` |
| `GET /api/audit-cases/:id/trace` | 案件全部运行+步骤（最新在前） | `{ run, steps[] }`；`steps.kind` ∈ `STAGE \| TOOL_CALL \| TOOL_RESULT \| MESSAGE` |

实现：[apps/api/src/routes/agent-runs.ts](../../../../apps/api/src/routes/agent-runs.ts)。OpenAPI schema 允许 `usage`/`durationMs`/`error`/`tokens`/`input`/`output`/`ref`/`parentRef` 为 null。

## 2. Pi 事件映射

[packages/pi-agent/src/trace.ts](../../../../packages/pi-agent/src/trace.ts) 将 Pi session 事件映射为 `AgentTraceObservation`：

- `turn_start` / `turn_end` → `STAGE`（`TURN_STARTED` / `TURN_COMPLETED`），见 [ADR 0005](../../../adr/0005-turn-boundaries-in-the-agent-trace.md)
- 工具调用/结果 → `TOOL_CALL` / `TOOL_RESULT`，`ref` 配对；嵌套调用带 `parentRef`
- 助手文本 → `MESSAGE`
- 运行边界 → `RUN_STARTED` / `RUN_COMPLETED` / `RUN_FAILED`
- Provider 省略的 usage 字段保持 absent，不填 0

## 3. 持久化

表 `agent_runs` / `agent_trace_steps`（[apps/api/src/db/schema.ts](../../../../apps/api/src/db/schema.ts)）：

- 运行：`beginAgentRun` 先插入；`finishAgentRun` 回写 `usage`/`durationMs`/`error`
- 步骤：append-only；`(run_id, sequence)` 唯一；冲突 `onConflictDoNothing`
- 仓储：[apps/api/src/db/repositories/agent-trace.repository.ts](../../../../apps/api/src/db/repositories/agent-trace.repository.ts)

## 4. SSE

Dispatcher 在运行中发布 `agent.started` 与逐步 `agent.trace`（含完整 `step`）。前端 [use-audit-events.ts](../../../../apps/web/src/hooks/use-audit-events.ts) 用 EventSource；轨迹页对 `agent.trace` / `agent.started` 及案件终态失效 query，**不**做逐步增量合并（TI-M2 再验证去重/乱序）。

## 5. 指标可用性

| 指标 | 何时有值 | UI 缺失时 |
| --- | --- | --- |
| `run.durationMs` | `finishAgentRun` 后 | 「未提供」 |
| `run.usage` | 运行结束且 provider 回报 | 「未提供」 |
| `step.durationMs` | 工具/轮次关闭时（SDK 单调时钟） | 「未提供」；不得用相邻 `at` 差值冒充 |
| `step.tokens` | 主要在 `TURN_COMPLETED` | 「未提供」 |
| 墙钟间隔 | `at` 仅排序与展示 | 空白间隔 ≠ LLM 执行 |

## 6. 当前 UI 缺口（相对 TI-M1）

已有：[audit-trace.tsx](../../../../apps/web/src/routes/audit-trace.tsx)、[agent-trace-timeline.tsx](../../../../apps/web/src/components/agent-trace-timeline.tsx) — 单时间轴、工具配对与折叠、SSE 刷新。

缺失：对话/轨迹双视图；输入/模型/工具三泳道；运行概况对缺失指标的「未提供」文案；Inspector 页签（属 TI-M2）；规范化层的时间可信度/脱敏适配器。

## 7. 结论

数据面足以支撑 TI-M1 只读历史回放。契约冻结后即可实现轨迹 UI；不假定影子决策字段可查询。下一步：TI-PREP-03 冻结 TraceEvent 与文件所有权。
