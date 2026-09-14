import { expect, test } from "bun:test";
import type { AgentTraceStep } from "@contract-audit/audit/model";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentTraceTimeline,
  groupTraceEntries,
  summarizeToolInput,
  toTraceEntries,
} from "./agent-trace-timeline";

const baseStep = (
  overrides: Partial<AgentTraceStep> & Pick<AgentTraceStep, "kind" | "sequence">,
): AgentTraceStep => ({
  at: "2026-09-14T10:00:00.000Z",
  label: overrides.kind,
  ref: null,
  input: null,
  output: null,
  isError: false,
  durationMs: null,
  tokens: null,
  runId: "run-1",
  ...overrides,
});

const messageStep = (sequence: number): AgentTraceStep =>
  baseStep({
    kind: "MESSAGE",
    sequence,
    at: "2026-09-14T10:00:01.000Z",
    output: { text: "开始审阅合同" },
  });

const searchCall = (sequence: number, query: string, at: string, ref: string): AgentTraceStep =>
  baseStep({
    kind: "TOOL_CALL",
    sequence,
    at,
    label: "search_contract",
    ref,
    input: { query },
    durationMs: 2,
  });

const searchResult = (sequence: number, at: string, ref: string): AgentTraceStep =>
  baseStep({
    kind: "TOOL_RESULT",
    sequence,
    at,
    label: "search_contract",
    ref,
    output: { matches: [] },
    durationMs: 2,
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

test("summarizeToolInput extracts the distinctive argument for each known tool", () => {
  expect(summarizeToolInput("search_contract", { query: "预付款" })).toBe("预付款");
  expect(summarizeToolInput("read_contract_block", { blockId: "blk_12" })).toBe("blk_12");
  expect(summarizeToolInput("get_evidence", { evidenceIds: ["a", "b"] })).toBe("2 条证据");
  expect(
    summarizeToolInput("submit_finding_proposal", { findingType: "PENALTY_CLAUSE_MISSING" }),
  ).toBe("缺少违约责任条款");
  expect(summarizeToolInput("get_rule_assessments", {})).toBeNull();
  expect(summarizeToolInput("search_contract", null)).toBeNull();
});

test("groupTraceEntries collapses consecutive same-name tool calls and splits on other kinds", () => {
  const steps: AgentTraceStep[] = [
    baseStep({ kind: "STAGE", sequence: 1, label: "RUN_STARTED" }),
    searchCall(2, "预付款", "2026-09-14T10:00:01.744Z", "c1"),
    searchResult(3, "2026-09-14T10:00:01.746Z", "c1"),
    searchCall(4, "违约金", "2026-09-14T10:00:01.746Z", "c2"),
    searchResult(5, "2026-09-14T10:00:01.748Z", "c2"),
    searchCall(6, "终止", "2026-09-14T10:00:01.748Z", "c3"),
    searchResult(7, "2026-09-14T10:00:01.749Z", "c3"),
    messageStep(8),
    searchCall(9, "管辖", "2026-09-14T10:00:20.736Z", "c4"),
    searchResult(10, "2026-09-14T10:00:20.737Z", "c4"),
  ];
  const groups = groupTraceEntries(toTraceEntries(steps));
  expect(groups.map((group) => group.entries.map((entry) => entry.step.label))).toEqual([
    ["RUN_STARTED"],
    ["search_contract", "search_contract", "search_contract"],
    ["MESSAGE"],
    ["search_contract"],
  ]);
});

test("consecutive same-tool calls render as one grouped row with argument chips", () => {
  const steps: AgentTraceStep[] = [
    searchCall(1, "预付款", "2026-09-14T10:00:01.744Z", "c1"),
    searchResult(2, "2026-09-14T10:00:01.746Z", "c1"),
    searchCall(3, "违约金", "2026-09-14T10:00:01.746Z", "c2"),
    searchResult(4, "2026-09-14T10:00:01.748Z", "c2"),
    searchCall(5, "终止", "2026-09-14T10:00:01.748Z", "c3"),
    searchResult(6, "2026-09-14T10:00:01.749Z", "c3"),
  ];
  const html = renderToStaticMarkup(<AgentTraceTimeline steps={steps} />);
  expect(html).toContain("×3");
  expect(html).toContain("search_contract ×3");
  expect(html).toContain("预付款");
  expect(html).toContain("违约金");
  expect(html).toContain("终止");
  expect(html).not.toContain(panelId(1));
});

test("a single tool call is not grouped and still shows its argument summary", () => {
  const steps: AgentTraceStep[] = [
    searchCall(1, "预付款", "2026-09-14T10:00:01.744Z", "c1"),
    searchResult(2, "2026-09-14T10:00:01.746Z", "c1"),
  ];
  const html = renderToStaticMarkup(<AgentTraceTimeline steps={steps} />);
  expect(html).not.toContain("×");
  expect(html).toContain("预付款");
  expect(html).toContain("search_contract");
});

test("timeline CSS keeps the offset in the grid instead of negatively positioning it", async () => {
  const css = await Bun.file(new URL("../styles.css", import.meta.url)).text();
  expect(css).not.toContain("left: -68px");
  expect(css).toContain("grid-template-columns: 4.75rem 12px minmax(0, 1fr)");
});

test("the timing overview exposes buttons that name the step they jump to", () => {
  const steps: AgentTraceStep[] = [
    baseStep({ kind: "STAGE", sequence: 1, label: "RUN_STARTED", at: "2026-09-14T10:00:00.000Z" }),
    searchCall(2, "预付款", "2026-09-14T10:00:02.000Z", "c1"),
    searchResult(3, "2026-09-14T10:00:02.010Z", "c1"),
    messageStep(4),
  ];
  const html = renderToStaticMarkup(<AgentTraceTimeline steps={steps} />);
  expect(html).toContain("trace-overview__hit");
  expect(html).toContain('aria-label="模型生成');
  expect(html).toContain("search_contract");
});
