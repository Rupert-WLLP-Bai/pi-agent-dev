import { expect, test } from "bun:test";
import type { AgentRun } from "@contract-audit/audit/model";
import {
  agentRunStateLabels,
  agentRunStateTagColors,
  formatDuration,
  formatTraceOffset,
  formatTracePayload,
  getAgentRunState,
  getTraceStageLabel,
  tokenUsageBreakdown,
  traceStepKindLabels,
} from "./audit-presentation";

const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: "run-1",
  auditCaseId: "case-1",
  provider: "pi",
  model: "deepseek-v4-flash",
  version: "0.85.1",
  usage: null,
  durationMs: null,
  error: null,
  createdAt: "2026-09-13T10:00:00.000Z",
  ...overrides,
});

test("formatDuration reports sub-second in milliseconds and the rest in seconds", () => {
  expect(formatDuration(null)).toBeNull();
  expect(formatDuration(0)).toBe("0 ms");
  expect(formatDuration(850)).toBe("850 ms");
  expect(formatDuration(1000)).toBe("1.0 s");
  expect(formatDuration(29120)).toBe("29.1 s");
});

test("tokenUsageBreakdown counts the prompt as input plus cache so in and out sum to the total", () => {
  expect(tokenUsageBreakdown(null)).toBeNull();
  expect(tokenUsageBreakdown({ input: 8687, output: 1170 })).toEqual({
    input: 8687,
    output: 1170,
    total: 9857,
    cacheRead: 0,
    cacheWrite: 0,
    cacheRate: 0,
  });
  // Cached tokens belong to the prompt, so the cache share divides by their sum.
  expect(
    tokenUsageBreakdown({
      input: 1000,
      output: 500,
      cacheRead: 3000,
      cacheWrite: 1000,
      total: 5500,
    }),
  ).toEqual({
    input: 5000,
    output: 500,
    total: 5500,
    cacheRead: 3000,
    cacheWrite: 1000,
    cacheRate: 60,
  });
  // No prompt means no ratio to report.
  expect(tokenUsageBreakdown({ output: 10, total: 10 })?.cacheRate).toBeNull();
});

test("formatTracePayload returns null for empty values and truncates long ones", () => {
  expect(formatTracePayload(null)).toBeNull();
  expect(formatTracePayload(undefined)).toBeNull();
  expect(formatTracePayload("hello")).toBe("hello");
  const long = "x".repeat(5000);
  const result = formatTracePayload(long, 100);
  expect(result).toContain("已截断");
  expect(result).toContain("5,000");
  expect(result?.startsWith("x".repeat(100))).toBe(true);
});

test("formatTraceOffset shows elapsed seconds from the run start", () => {
  const start = "2026-09-13T10:00:00.000Z";
  expect(formatTraceOffset(start, "2026-09-13T10:00:00.000Z")).toBe("+0.00s");
  expect(formatTraceOffset(start, "2026-09-13T10:00:02.500Z")).toBe("+2.50s");
});

test("getAgentRunState distinguishes failed, succeeded, running, and orphaned runs", () => {
  expect(getAgentRunState(run({ error: "TIMEOUT" }), "FAILED")).toBe("FAILED");
  expect(getAgentRunState(run({ durationMs: 29000 }), "COMPLETED")).toBe("SUCCEEDED");
  expect(getAgentRunState(run(), "RUNNING")).toBe("RUNNING");
  // A run that never finished and whose case settled was orphaned — calling it
  // running would promise a trace that will never grow.
  expect(getAgentRunState(run(), "COMPLETED")).toBe("INTERRUPTED");
});

test("agent run state labels and tones cover every state", () => {
  for (const state of ["RUNNING", "SUCCEEDED", "FAILED", "INTERRUPTED"] as const) {
    expect(agentRunStateLabels[state]).toBeTruthy();
    expect(agentRunStateTagColors[state]).toBeTruthy();
  }
});

test("getTraceStageLabel maps known stages to Chinese and passes through unknown ones", () => {
  expect(getTraceStageLabel("RUN_STARTED")).toBe("开始运行");
  expect(getTraceStageLabel("RUN_COMPLETED")).toBe("运行完成");
  expect(getTraceStageLabel("get_rule_assessments")).toBe("get_rule_assessments");
});

test("traceStepKindLabels covers every step kind", () => {
  for (const kind of ["STAGE", "TOOL_CALL", "TOOL_RESULT", "MESSAGE"] as const) {
    expect(traceStepKindLabels[kind]).toBeTruthy();
  }
});
