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

test("pairs a tool call with its result and measures the gap", () => {
  const { observations, reporter, advance, labels } = recorder();

  reporter.observe({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "get_rule_assessments",
    args: { evidenceIds: ["a"] },
  });
  advance(25);
  reporter.observe({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "get_rule_assessments",
    result: { assessments: [] },
    isError: false,
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
    durationMs: 25,
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
  reporter.observe({ type: "turn_start" });
  reporter.observe({ type: "tool_execution_start", toolCallId: 7, toolName: "t" });

  expect(observations).toEqual([]);
});
