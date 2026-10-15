---
status: accepted
---

# Record nested Tool Calls as an observed parent link in the Agent Trace

A deepseek-harness-style multi-layer trace was requested for the audit-case trace page: when a tool invokes another tool, the trace must show the outer call with its inner calls beneath it, as evidence of what actually executed. The Agent Trace therefore records nesting as an observed parent link: a trace step for a Tool Call a tool made carries `parentRef` set to the `toolCallId` of the Tool Call that was running, and top-level Tool Calls carry none. The tree the UI renders is read off that link — it is never computed, inferred, or synthesized.

Concretely, only `get_rule_assessments` was turned into an orchestrating tool: it now issues real nested `get_evidence` calls through the session's `ctx.executeTool()`. Every other bounded tool remains a leaf, so the demo trace shows genuine two-layer execution rather than a shape that merely looks layered.

## Considered Options

- **Computing depth from trace order.** Pairing an inner call with the most recent unfinished outer call would forge hierarchy from a flat stream: the result would look identical whether the inner call truly ran inside the outer tool or merely followed it. A trace that cannot distinguish "ran inside" from "ran after" is not evidence of execution, which is the whole point of the Agent Trace.
- **Progress-event pseudo-steps.** Emitting synthetic TOOL_CALL/TOOL_RESULT steps from a tool's progress reporting would draw a tree with no execution behind it: no SDK event, no real tool run, no failure surface. It records narration, not work.
- **A self-referencing parent foreign key on the producer side.** The producer only learns a call's `toolCallId` when the sink accepts the TOOL_CALL step; it has no way to name the parent before that. A FK would either require two-phase ids or a second update per step, and it would let the producer assert a parent the SDK never observed.

## Context

Pi 1.2.0 exposes exactly the primitives this decision needs:

- `ctx.executeTool(name, args, options?)` on the tool context runs another tool through the same validation, hooks, and permission checks as a model-issued call. The call gets the id `<calling id>/<n>`, and the `tool_call`, `tool_result`, and `tool_execution_*` events carry `parentToolCallId`. It never appears in the transcript; a bounded record of it is kept as `nestedCalls` on the calling tool's result message.
- Nested execution goes through the agent's tool pipeline (`runToolCall`) with the nested runner's own hooks, so a nested call is a real call that can really fail.
- `NESTED_CALL_LIMITS` caps the nested-call record at `maxCalls: 256` per calling tool call (plus per-call and total argument-byte caps and a 500-character error cap); calls beyond the count are dropped and the record is marked incomplete. The trace surface is bounded by construction.
- The trace reporter reads `parentToolCallId` defensively from each raw event and maps it to `parentRef`, skipping malformed events rather than crashing the audit.

## Consequences

- The Agent Trace is evidence of real execution: an inner row exists only because the outer tool actually invoked it, and `parentRef` quotes an observed parent id, never a position or a guess.
- Nested calls do not enter the model transcript, so the agent's context is unchanged by orchestration; the nested work is visible only in the trace and in the bounded `nestedCalls` summary on the outer call's result.
- Nesting is recorded, not bounded at the UI: the SDK's 256-call cap per calling tool call is the enforcement point, and the trace records whatever the SDK reports, incomplete records included.
- Legacy traces without `parentRef` remain flat and render as top-level calls, so historical Agent Traces stay readable unchanged.
