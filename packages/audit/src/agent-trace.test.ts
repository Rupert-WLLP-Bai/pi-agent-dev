import { expect, test } from "bun:test";
import type { AgentTraceObservation } from "@contract-audit/audit/model";
import { createAgentTraceCollector } from "./agent-trace";

const observation = (label: string): AgentTraceObservation => ({
  kind: "TOOL_CALL",
  at: new Date(0).toISOString(),
  label,
  ref: null,
  input: null,
  output: null,
  isError: false,
  durationMs: null,
  tokens: null,
});

test("numbers steps in observation order and writes them one at a time", async () => {
  const written: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const collector = createAgentTraceCollector("run-1", async (step) => {
    written.push(step.sequence);
    if (step.sequence === 0) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
  });

  collector.sink(observation("first"));
  collector.sink(observation("second"));
  // Let the queued writes start. The first one is now open, so the second must
  // still be waiting behind it rather than writing concurrently.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(written).toEqual([0]);

  releaseFirst?.();
  await collector.flush();

  expect(written).toEqual([0, 1]);
  expect(collector.steps.map((step) => step.runId)).toEqual(["run-1", "run-1"]);
  expect(collector.steps.map((step) => step.label)).toEqual(["first", "second"]);
});

test("keeps collecting after a write fails", async () => {
  const collector = createAgentTraceCollector("run-1", async (step) => {
    if (step.sequence === 0) throw new Error("TRACE_WRITE_FAILED");
  });

  collector.sink(observation("first"));
  collector.sink(observation("second"));
  await collector.flush();

  expect(collector.steps.map((step) => step.label)).toEqual(["first", "second"]);
});
