import { expect, test } from "bun:test";
import type { AgentTraceObservation } from "@contract-audit/audit/model";
import { createPiTraceReporter } from "./trace";

function recorder() {
  const observations: AgentTraceObservation[] = [];
  let clock = 0;
  const reporter = createPiTraceReporter(
    (observation) => observations.push(observation),
    () => clock,
  );
  return {
    observations,
    reporter,
    advance: (ms: number) => {
      clock += ms;
    },
    labels: () => observations.map((observation) => observation.label),
  };
}

test("pairs tool results and rounds SDK timing independently of the wall clock", () => {
  const { observations, reporter, advance, labels } = recorder();

  reporter.observe({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "get_rule_assessments",
    args: { evidenceIds: ["a"] },
  });
  advance(2500);
  reporter.observe({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "get_rule_assessments",
    result: { assessments: [] },
    isError: false,
    durationMs: 25.6,
  });

  expect(labels()).toEqual(["get_rule_assessments", "get_rule_assessments"]);
  expect(observations[0]).toMatchObject({
    kind: "TOOL_CALL",
    ref: "call-1",
    input: { evidenceIds: ["a"] },
    output: null,
  });
  expect(observations[1]).toMatchObject({
    kind: "TOOL_RESULT",
    ref: "call-1",
    input: null,
    output: { assessments: [] },
    isError: false,
    durationMs: 26,
  });
});

test("marks a failed tool result as an error", () => {
  const { observations, reporter } = recorder();

  reporter.observe({
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "get_evidence",
    args: { evidenceIds: ["nope"] },
  });
  reporter.observe({
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "get_evidence",
    result: "UNKNOWN_EVIDENCE: nope",
    isError: true,
  });

  expect(observations[1]?.isError).toBe(true);
  expect(observations[1]?.output).toBe("UNKNOWN_EVIDENCE: nope");
});

test("records a provider error so a 400 is not mistaken for a silent no-tool run", () => {
  const { observations, reporter } = recorder();

  reporter.observe({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "400: unknown variant `developer`",
    },
  });

  expect(reporter.lastProviderError).toBe("400: unknown variant `developer`");
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    kind: "MESSAGE",
    isError: true,
    output: "400: unknown variant `developer`",
  });
});

test("captures assistant text with its token counts, and skips other messages", () => {
  const { observations, reporter } = recorder();

  reporter.observe({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "先读取规则评估。" },
        { type: "toolCall", id: "call-1", name: "get_rule_assessments", arguments: {} },
      ],
      usage: { input: 8687, output: 1170, totalTokens: 9857 },
    },
  });
  reporter.observe({
    type: "message_end",
    message: { role: "toolResult", content: [{ type: "text", text: "[]" }] },
  });

  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    kind: "MESSAGE",
    label: "assistant",
    output: "先读取规则评估。",
    tokens: { input: 8687, output: 1170 },
  });
});

test("records the run boundary once, however often the session starts", () => {
  const { observations, reporter } = recorder();

  reporter.observe({ type: "agent_start" });
  reporter.observe({ type: "agent_start" });
  reporter.observe({ type: "tool_execution_start", toolCallId: "c", toolName: "t" });
  reporter.observe({ type: "agent_end", messages: [] });

  expect(observations.map((observation) => observation.label)).toEqual(["RUN_STARTED", "t"]);
  expect(reporter.toolCalls).toBe(1);
});

test("reports the run outcome itself, because agent_end cannot tell success from abort", () => {
  const { observations, reporter } = recorder();

  reporter.observe({ type: "agent_end", messages: [] });
  reporter.close("failed");
  reporter.close("completed");

  expect(observations.map((observation) => observation.label)).toEqual(["RUN_FAILED"]);
});

test("ignores events it does not model instead of failing the audit", () => {
  const { observations, reporter } = recorder();

  reporter.observe(null);
  reporter.observe("not an event");
  reporter.observe({ type: "compaction_start", reason: "threshold" });
  reporter.observe({ type: "agent_settled", aborted: false });
  reporter.observe({ type: "tool_execution_start", toolCallId: 7, toolName: "t" });

  expect(observations).toEqual([]);
});

test("records each turn as its own boundary, carrying the turn's usage", () => {
  const { observations, reporter } = recorder();

  reporter.observe({ type: "turn_start" });
  reporter.observe({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "search_contract",
    args: { query: "预付款" },
  });
  reporter.observe({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "search_contract",
    result: { matches: [] },
    isError: false,
    durationMs: 12,
  });
  reporter.observe({
    type: "turn_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "查不到预付款条款。" }],
      stopReason: "stop",
      usage: {
        input: 900,
        output: 40,
        cacheRead: 512,
        cacheWrite: 0,
        totalTokens: 940,
      },
    },
    toolResults: [{ callId: "c1" }],
  });
  reporter.observe({ type: "turn_start" });
  reporter.observe({
    type: "turn_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "完成。" }],
      stopReason: "stop",
      usage: { input: 960, output: 12 },
    },
    toolResults: [],
  });

  expect(observations.map((observation) => observation.label)).toEqual([
    "TURN_STARTED",
    "search_contract",
    "search_contract",
    "TURN_COMPLETED",
    "TURN_STARTED",
    "TURN_COMPLETED",
  ]);
  const closed = observations[3];
  expect(closed).toMatchObject({
    kind: "STAGE",
    label: "TURN_COMPLETED",
    input: { turnIndex: 1 },
    output: { toolResults: 1 },
    tokens: { input: 900, output: 40, cacheRead: 512, total: 940 },
  });
  expect(typeof closed.durationMs).toBe("number");
  // A turn that closed without its own start — a trace that begins mid-run —
  // records nothing rather than a bogus boundary.
  reporter.observe({ type: "turn_end", message: {}, toolResults: [] });
  expect(observations).toHaveLength(6);
});

test("nests calls a tool made, keyed by the parent's call id", () => {
  const { observations, reporter } = recorder();

  reporter.observe({
    type: "tool_execution_start",
    toolCallId: "outer/1",
    toolName: "get_evidence",
    args: { evidenceIds: ["ev-1"] },
    parentToolCallId: "outer",
  });
  reporter.observe({
    type: "tool_execution_end",
    toolCallId: "outer/1",
    toolName: "get_evidence",
    result: [{ id: "ev-1" }],
    isError: false,
    parentToolCallId: "outer",
  });

  expect(observations).toMatchObject([
    { kind: "TOOL_CALL", ref: "outer/1", parentRef: "outer" },
    { kind: "TOOL_RESULT", ref: "outer/1", parentRef: "outer" },
  ]);
});
