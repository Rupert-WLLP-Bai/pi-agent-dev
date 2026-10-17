import { describe, expect, test } from "bun:test";
import type { AgentRun, AgentTraceStep } from "@contract-audit/audit/model";
import {
  buildRunOverview,
  formatMetricMs,
  formatMetricTokens,
  formatMetricUsage,
  METRIC_NOT_PROVIDED,
  normalizeTraceEvents,
  pairToolEvents,
  toChatTurns,
} from "./normalize-trace-events";

const baseStep = (
  over: Partial<AgentTraceStep> & Pick<AgentTraceStep, "sequence" | "kind">,
): AgentTraceStep => ({
  runId: "run-1",
  at: "2026-10-17T12:00:00.000Z",
  label: "label",
  ref: null,
  parentRef: null,
  input: null,
  output: null,
  isError: false,
  durationMs: null,
  tokens: null,
  ...over,
});

describe("normalizeTraceEvents", () => {
  test("sorts by sequence and assigns lanes", () => {
    const events = normalizeTraceEvents([
      baseStep({ sequence: 2, kind: "TOOL_CALL", label: "search_contract", ref: "c1" }),
      baseStep({ sequence: 1, kind: "STAGE", label: "RUN_STARTED" }),
      baseStep({ sequence: 3, kind: "MESSAGE", label: "assistant" }),
    ]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events[0]?.lane).toBe("model");
    expect(events[1]?.lane).toBe("tool");
    expect(events[2]?.lane).toBe("model");
    expect(events[0]?.timeTrust).toBe("recorded");
  });

  test("marks invalid timestamps without inventing duration", () => {
    const [event] = normalizeTraceEvents([
      baseStep({ sequence: 1, kind: "STAGE", at: "not-a-date", durationMs: null }),
    ]);
    expect(event?.timeTrust).toBe("invalid");
    expect(event?.durationMs).toBeNull();
  });
});

describe("metric formatting", () => {
  test("null metrics render 未提供", () => {
    expect(formatMetricMs(null)).toBe(METRIC_NOT_PROVIDED);
    expect(formatMetricTokens(null)).toBe(METRIC_NOT_PROVIDED);
    expect(formatMetricUsage(null)).toBe(METRIC_NOT_PROVIDED);
  });

  test("finite durations format", () => {
    expect(formatMetricMs(250)).toBe("250 ms");
    expect(formatMetricMs(1500)).toBe("1.50 s");
  });
});

describe("pairToolEvents / toChatTurns", () => {
  test("pairs tool call and result by ref", () => {
    const events = normalizeTraceEvents([
      baseStep({
        sequence: 1,
        kind: "TOOL_CALL",
        label: "search_contract",
        ref: "c1",
        input: { q: "a" },
      }),
      baseStep({
        sequence: 2,
        kind: "TOOL_RESULT",
        label: "search_contract",
        ref: "c1",
        output: { n: 1 },
      }),
    ]);
    const pairs = pairToolEvents(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.call.ref).toBe("c1");
    expect(pairs[0]?.result?.kind).toBe("TOOL_RESULT");
  });

  test("chat turns collapse paired tools", () => {
    const events = normalizeTraceEvents([
      baseStep({ sequence: 1, kind: "STAGE", label: "TURN_STARTED" }),
      baseStep({ sequence: 2, kind: "MESSAGE", label: "assistant", output: "hello" }),
      baseStep({ sequence: 3, kind: "TOOL_CALL", label: "search_contract", ref: "c1" }),
      baseStep({ sequence: 4, kind: "TOOL_RESULT", label: "search_contract", ref: "c1" }),
    ]);
    const turns = toChatTurns(events);
    expect(turns.map((t) => t.role)).toEqual(["stage", "assistant", "tool"]);
    expect(turns[2]?.result?.kind).toBe("TOOL_RESULT");
  });
});

describe("buildRunOverview", () => {
  test("aggregates step kinds and keeps null metrics", () => {
    const run: AgentRun = {
      id: "run-1",
      auditCaseId: "case-1",
      provider: "fake",
      model: "fake-agent",
      version: "0",
      usage: null,
      durationMs: null,
      error: null,
      createdAt: "2026-10-17T12:00:00.000Z",
    };
    const overview = buildRunOverview(run, [
      baseStep({ sequence: 1, kind: "STAGE", label: "RUN_STARTED" }),
      baseStep({ sequence: 2, kind: "MESSAGE", label: "assistant" }),
      baseStep({ sequence: 3, kind: "TOOL_CALL", label: "search_contract", ref: "c1" }),
    ]);
    expect(overview.stepCount).toBe(3);
    expect(overview.messageCount).toBe(1);
    expect(overview.toolCallCount).toBe(1);
    expect(overview.stageCount).toBe(1);
    expect(overview.durationMs).toBeNull();
    expect(overview.usage).toBeNull();
  });
});
