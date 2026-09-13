import { expect, test } from "bun:test";
import type { AgentTraceStep } from "@contract-audit/audit/model";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentTraceTimeline } from "./agent-trace-timeline";

const messageStep = (sequence: number): AgentTraceStep => ({
  kind: "MESSAGE",
  at: "2026-09-14T10:00:01.000Z",
  label: "MESSAGE",
  ref: null,
  input: null,
  output: { text: "开始审阅合同" },
  isError: false,
  durationMs: null,
  tokens: null,
  runId: "run-1",
  sequence,
});

/** The payload panel for a step is rendered only while that step is expanded. */
const panelId = (sequence: number) => `id="run-1:${sequence}-panel"`;

test("a timeline stays collapsed by default", () => {
  const html = renderToStaticMarkup(<AgentTraceTimeline steps={[messageStep(1)]} />);
  expect(html).not.toContain(panelId(1));
});

test("defaultExpanded opens every collapsible step on first render", () => {
  const html = renderToStaticMarkup(
    <AgentTraceTimeline steps={[messageStep(1), messageStep(2)]} defaultExpanded />,
  );
  expect(html).toContain(panelId(1));
  expect(html).toContain(panelId(2));
});
