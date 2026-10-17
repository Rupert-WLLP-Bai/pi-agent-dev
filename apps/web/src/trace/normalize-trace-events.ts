import type { AgentRun, AgentTraceStep, AgentTraceTokens } from "@contract-audit/audit/model";

/** Presentation lane for the three-lane trajectory (TI-M1). */
export type TraceLane = "input" | "model" | "tool";

/** Whether `at` is trustworthy enough to show as recorded wall time. */
export type TraceTimeTrust = "recorded" | "inferred" | "invalid";

/**
 * UI projection of one persisted AgentTraceStep.
 * Wire semantics stay in packages/audit; this layer only adds lane / trust /
 * pairing helpers and never invents durations from blank gaps.
 */
export interface TraceEvent {
  id: string;
  runId: string;
  sequence: number;
  kind: AgentTraceStep["kind"];
  at: string;
  label: string;
  ref: string | null;
  parentRef: string | null;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number | null;
  tokens: AgentTraceTokens | null;
  lane: TraceLane;
  timeTrust: TraceTimeTrust;
  pairId: string | null;
  redacted: boolean;
  /** Original step retained for raw mapping / debug. */
  raw: AgentTraceStep;
}

export interface TraceRunOverview {
  runId: string;
  provider: string;
  model: string;
  version: string;
  createdAt: string;
  stepCount: number;
  durationMs: number | null;
  usage: Record<string, number> | null;
  error: string | null;
  messageCount: number;
  toolCallCount: number;
  stageCount: number;
}

/** Contractual copy for any metric the producer left null. */
export const METRIC_NOT_PROVIDED = "未提供";

export function formatMetricMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return METRIC_NOT_PROVIDED;
  }
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatMetricTokens(tokens: AgentTraceTokens | null | undefined): string {
  if (tokens === null || tokens === undefined) return METRIC_NOT_PROVIDED;
  const total =
    typeof tokens.total === "number"
      ? tokens.total
      : tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
  return `${total.toLocaleString("zh-CN")} tok`;
}

export function formatMetricUsage(usage: Record<string, number> | null | undefined): string {
  if (usage === null || usage === undefined) return METRIC_NOT_PROVIDED;
  const total = usage.totalTokens ?? usage.total ?? usage.input_tokens ?? usage.input;
  if (typeof total === "number" && Number.isFinite(total)) {
    return `${total.toLocaleString("zh-CN")} tok`;
  }
  const keys = Object.keys(usage);
  return keys.length === 0 ? METRIC_NOT_PROVIDED : `${keys.length} 项`;
}

function laneFor(kind: AgentTraceStep["kind"]): TraceLane {
  if (kind === "TOOL_CALL" || kind === "TOOL_RESULT") return "tool";
  // STAGE and MESSAGE are model-side; dedicated human input events do not exist
  // on the wire yet, so the input lane is reserved for run overview metadata.
  return "model";
}

function timeTrustOf(at: string): TraceTimeTrust {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "invalid";
  return "recorded";
}

/**
 * Map persisted steps into TraceEvents. Order is by sequence ascending; never
 * by wall-clock adjacency. Missing durations stay null.
 */
export function normalizeTraceEvents(steps: readonly AgentTraceStep[]): TraceEvent[] {
  const sorted = [...steps].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.runId.localeCompare(b.runId);
  });

  return sorted.map((step) => ({
    id: `${step.runId}:${step.sequence}`,
    runId: step.runId,
    sequence: step.sequence,
    kind: step.kind,
    at: step.at,
    label: step.label,
    ref: step.ref,
    parentRef: step.parentRef,
    input: step.input,
    output: step.output,
    isError: step.isError,
    durationMs: step.durationMs,
    tokens: step.tokens,
    lane: laneFor(step.kind),
    timeTrust: timeTrustOf(step.at),
    pairId: step.ref,
    redacted: false,
    raw: step,
  }));
}

/** Pair tool calls with their results by ref (same rules as the timeline). */
export function pairToolEvents(events: readonly TraceEvent[]): Array<{
  call: TraceEvent;
  result: TraceEvent | null;
}> {
  const pairs: Array<{ call: TraceEvent; result: TraceEvent | null }> = [];
  const awaiting = new Map<string, number>();

  for (const event of events) {
    if (event.kind === "TOOL_CALL" && event.ref !== null) {
      awaiting.set(event.ref, pairs.length);
      pairs.push({ call: event, result: null });
      continue;
    }
    if (event.kind === "TOOL_RESULT" && event.ref !== null) {
      const index = awaiting.get(event.ref);
      if (index !== undefined) {
        awaiting.delete(event.ref);
        const existing = pairs[index];
        if (existing) existing.result = event;
      }
    }
  }
  return pairs;
}

export function buildRunOverview(
  run: AgentRun,
  steps: readonly AgentTraceStep[],
): TraceRunOverview {
  let messageCount = 0;
  let toolCallCount = 0;
  let stageCount = 0;
  for (const step of steps) {
    if (step.kind === "MESSAGE") messageCount += 1;
    else if (step.kind === "TOOL_CALL") toolCallCount += 1;
    else if (step.kind === "STAGE") stageCount += 1;
  }
  return {
    runId: run.id,
    provider: run.provider,
    model: run.model,
    version: run.version,
    createdAt: run.createdAt,
    stepCount: steps.length,
    durationMs: run.durationMs,
    usage: run.usage,
    error: run.error,
    messageCount,
    toolCallCount,
    stageCount,
  };
}

/** Chat-view rows: assistant messages and paired tool summaries in sequence order. */
export function toChatTurns(events: readonly TraceEvent[]): Array<{
  key: string;
  role: "assistant" | "tool" | "stage";
  event: TraceEvent;
  result?: TraceEvent | null;
}> {
  const turns: Array<{
    key: string;
    role: "assistant" | "tool" | "stage";
    event: TraceEvent;
    result?: TraceEvent | null;
  }> = [];
  const consumedResults = new Set<string>();
  const resultByRef = new Map<string, TraceEvent>();
  for (const event of events) {
    if (event.kind === "TOOL_RESULT" && event.ref !== null) {
      resultByRef.set(event.ref, event);
    }
  }

  const toolCallRefs = new Set<string>();
  for (const event of events) {
    if (event.kind === "TOOL_CALL" && event.ref !== null) {
      toolCallRefs.add(event.ref);
    }
  }

  for (const event of events) {
    if (event.kind === "TOOL_RESULT") {
      if (event.ref !== null && consumedResults.has(event.id)) continue;
      // Results paired under their call are rendered once with the call.
      if (event.ref !== null && toolCallRefs.has(event.ref)) continue;
      turns.push({ key: event.id, role: "tool", event, result: event });
      continue;
    }
    if (event.kind === "MESSAGE") {
      turns.push({ key: event.id, role: "assistant", event });
      continue;
    }
    if (event.kind === "TOOL_CALL") {
      const result = event.ref !== null ? (resultByRef.get(event.ref) ?? null) : null;
      if (result) consumedResults.add(result.id);
      turns.push({ key: event.id, role: "tool", event, result });
      continue;
    }
    if (event.kind === "STAGE") {
      turns.push({ key: event.id, role: "stage", event });
    }
  }
  return turns;
}
