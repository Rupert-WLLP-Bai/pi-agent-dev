import type { AgentTraceStep } from "@contract-audit/audit/model";
import { Button, Tag } from "antd";
import { useMemo, useState } from "react";
import {
  formatDuration,
  formatTraceOffset,
  formatTracePayload,
  getTraceStageLabel,
  traceStepKindLabels,
} from "../audit-presentation";

/** One timeline row: a step, plus the step that answered it when it was a call. */
export interface TraceEntry {
  key: string;
  step: AgentTraceStep;
  result: AgentTraceStep | null;
}

const entryKey = (step: AgentTraceStep): string => `${step.runId}:${step.sequence}`;

/**
 * Pairs each tool call with the result that answered it.
 *
 * Pairing is by `ref`, not by adjacency: the same tool can be called twice, and
 * two calls can be in flight at once. A result whose call is missing — a trace
 * that starts mid-run — is kept as its own row rather than dropped.
 */
export function toTraceEntries(steps: AgentTraceStep[]): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const awaitingResultAt = new Map<string, number>();

  for (const step of steps) {
    if (step.kind === "TOOL_CALL" && step.ref !== null) {
      awaitingResultAt.set(step.ref, entries.length);
      entries.push({ key: entryKey(step), step, result: null });
      continue;
    }
    if (step.kind === "TOOL_RESULT" && step.ref !== null) {
      const index = awaitingResultAt.get(step.ref);
      if (index !== undefined) {
        awaitingResultAt.delete(step.ref);
        entries[index] = { ...entries[index], result: step };
        continue;
      }
    }
    entries.push({ key: entryKey(step), step, result: null });
  }

  return entries;
}

/** Serialize a payload for display without truncation — the scrollable panel handles overflow. */
function payloadText(value: unknown): string | null {
  return formatTracePayload(value, Number.POSITIVE_INFINITY);
}

function Payload({ label, text, tone }: { label: string; text: string; tone?: "error" }) {
  return (
    <div className="trace-payload">
      <span className="trace-payload__label">{label}</span>
      <pre
        className={`trace-payload__body${tone === "error" ? " trace-payload__body--error" : ""}`}
      >
        {text}
      </pre>
    </div>
  );
}

// ── Timing overview bar ───────────────────────────────────────────

/**
 * A horizontal swimlane chart showing where time was spent during a run.
 *
 * The wall-clock span is computed from the maximum known *end* time (step
 * timestamp + duration), not the last step's start, so a final completed
 * call that runs past the last timestamp is not clipped.
 *
 * Each turn is one lane. Within a lane:
 * - The model-generation gap (time between the previous step's end and this
 *   step's start) is shown as a muted background bar — this is where the
 *   vast majority of wall-clock time goes, and making it visible is the
 *   single most important improvement over the old Gantt.
 * - Tool calls are colored blocks positioned at their actual start, with
 *   width proportional to their duration. Multiple calls in the same turn
 *   are stacked vertically so parallel execution is visible.
 * - Messages are narrow slivers.
 * - An in-flight call (no result yet) gets a zero-width marker at the right
 *   edge rather than disappearing.
 */
function TimingOverview({ entries }: { entries: TraceEntry[] }) {
  if (entries.length < 2) return null;

  const firstAt = new Date(entries[0].step.at).getTime();

  // Compute the span from the maximum known end time.
  let lastEnd = firstAt;
  for (const entry of entries) {
    const start = new Date(entry.step.at).getTime();
    const dur = entry.result?.durationMs ?? entry.step.durationMs ?? 0;
    lastEnd = Math.max(lastEnd, start + dur);
  }
  const span = Math.max(lastEnd - firstAt, 1);

  // Group entries into turns. A turn starts at RUN_STARTED and at each
  // TOOL_CALL or MESSAGE that follows a STAGE or another turn's end. In
  // practice the trace is sequential per turn, so we segment by detecting
  // gaps: a new turn starts when the current step begins after the previous
  // step's end plus a threshold. Since tool durations are ~0ms, any gap > 0
  // is model generation time within a turn. We split turns at STAGE steps.
  interface OverviewLane {
    id: string;
    label: string;
    bars: OverviewBar[];
  }
  interface OverviewBar {
    key: string;
    leftPct: number;
    widthPct: number;
    color: string;
    title: string;
  }

  const lanes: OverviewLane[] = [];
  let currentLane: OverviewLane | null = null;
  let prevEnd = firstAt;

  for (const entry of entries) {
    const { step, result } = entry;
    const start = new Date(step.at).getTime();
    const dur = result?.durationMs ?? step.durationMs ?? 0;
    const end = start + dur;

    if (step.kind === "STAGE") {
      if (
        step.label === "RUN_STARTED" ||
        step.label === "RUN_COMPLETED" ||
        step.label === "RUN_FAILED"
      ) {
        // Don't create lanes for run-level stages; they are zero-width markers.
        continue;
      }
      // Other stages start a new lane.
      // The step's own key identifies the lane: a tool can run twice, so the
      // label is not unique enough to be a React key.
      currentLane = { id: entry.key, label: getTraceStageLabel(step.label), bars: [] };
      lanes.push(currentLane);
      prevEnd = start;
      continue;
    }

    if (currentLane === null) {
      currentLane = { id: "run", label: "运行", bars: [] };
      lanes.push(currentLane);
    }

    // Model-generation gap: the time between the previous step's end and
    // this step's start. This is the LLM thinking time and is the dominant
    // cost — showing it as a distinct bar is the key visual.
    const gap = start - prevEnd;
    if (gap > 1) {
      const gapLeft = ((prevEnd - firstAt) / span) * 100;
      const gapWidth = (gap / span) * 100;
      currentLane.bars.push({
        key: `${entry.key}-gap`,
        leftPct: gapLeft,
        widthPct: Math.max(gapWidth, 0.5),
        color: "#fde68a",
        title: `模型生成 ${(gap / 1000).toFixed(1)}s`,
      });
    }

    const leftPct = ((start - firstAt) / span) * 100;
    const widthPct = Math.max((dur / span) * 100, dur > 0 ? 0.8 : 0);
    const color =
      step.kind === "TOOL_CALL"
        ? result?.isError
          ? "#ff4d4f"
          : "#722ed1"
        : step.kind === "TOOL_RESULT"
          ? result?.isError
            ? "#ff4d4f"
            : "#722ed1"
          : step.kind === "MESSAGE"
            ? "#13c2c2"
            : "#d9d9d9";

    currentLane.bars.push({
      key: entry.key,
      leftPct,
      widthPct: widthPct > 0 ? widthPct : 0.5,
      color,
      title: `${step.label} · ${formatDuration(dur) ?? "—"} · +${((start - firstAt) / 1000).toFixed(2)}s`,
    });

    prevEnd = Math.max(prevEnd, end);
  }

  return (
    <div className="trace-overview" aria-hidden>
      {lanes.map((lane) => (
        <div key={lane.id} className="trace-overview__lane" title={lane.label}>
          {lane.bars.map((bar) => (
            <div
              key={bar.key}
              className="trace-overview__bar"
              style={{
                left: `${bar.leftPct}%`,
                width: `${bar.widthPct}%`,
                background: bar.color,
              }}
              title={bar.title}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function AgentTraceTimeline({ steps }: { steps: AgentTraceStep[] }) {
  // Store *expanded* keys (default empty = everything collapsed). This is
  // the inverse of the old approach (which stored collapsed keys), and it
  // means new steps that arrive during a live run start collapsed — matching
  // the default — instead of appearing expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Tool/message/result entries that have payloads worth expanding.
  const collapsibleKeys = useMemo(
    () =>
      toTraceEntries(steps)
        .filter(
          (e) =>
            e.step.kind === "TOOL_CALL" ||
            e.step.kind === "TOOL_RESULT" ||
            e.step.kind === "MESSAGE",
        )
        .map((e) => e.key),
    [steps],
  );

  if (steps.length === 0) {
    return <p className="trace-empty">本次运行没有可展示的轨迹步骤。</p>;
  }

  const origin = steps[0].at;
  const entries = toTraceEntries(steps);

  const isExpanded = (key: string) => expanded.has(key);
  const allExpanded = collapsibleKeys.length > 0 && collapsibleKeys.every((k) => expanded.has(k));

  const toggleEntry = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(collapsibleKeys));
    }
  };

  return (
    <div className="trace-timeline-wrap">
      <div className="trace-timeline-toolbar">
        <span className="trace-timeline-toolbar__label">执行时序</span>
        <div className="trace-timeline-legend">
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#fde68a" }} />
            模型生成
          </span>
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#722ed1" }} />
            工具调用
          </span>
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#13c2c2" }} />
            模型输出
          </span>
        </div>
        {collapsibleKeys.length > 0 ? (
          <Button type="link" size="small" onClick={toggleAll}>
            {allExpanded ? "全部收起" : "全部展开"}
          </Button>
        ) : null}
      </div>
      <TimingOverview entries={entries} />
      <ol className="trace-timeline">
        {entries.map((entry) => {
          const { step, result } = entry;
          const offset = formatTraceOffset(origin, step.at);
          const entryExpanded = isExpanded(entry.key);

          if (step.kind === "STAGE") {
            const duration = formatDuration(step.durationMs);
            return (
              <li
                key={entry.key}
                className={`trace-stage trace-stage--${step.label.toLowerCase()}`}
              >
                <span className="trace-offset">{offset}</span>
                <span className="trace-stage__label">{getTraceStageLabel(step.label)}</span>
                {duration === null ? null : (
                  <span className="trace-stage__duration">{duration}</span>
                )}
              </li>
            );
          }

          if (step.kind === "MESSAGE") {
            const text = payloadText(step.output);
            return (
              <li key={entry.key} className="trace-step trace-step--message">
                <button
                  type="button"
                  className="trace-step__head trace-step__head--toggle"
                  onClick={() => toggleEntry(entry.key)}
                  aria-expanded={entryExpanded}
                  aria-controls={`${entry.key}-panel`}
                >
                  <span className="trace-offset">{offset}</span>
                  <Tag color="blue">{traceStepKindLabels.MESSAGE}</Tag>
                  {step.tokens === null ? null : (
                    <span className="trace-step__meta">
                      输入 {step.tokens.input.toLocaleString("en-US")} · 输出{" "}
                      {step.tokens.output.toLocaleString("en-US")}
                    </span>
                  )}
                  <span className="trace-step__chevron" aria-hidden>
                    {entryExpanded ? "▾" : "▸"}
                  </span>
                </button>
                {entryExpanded && text !== null ? (
                  <div id={`${entry.key}-panel`}>
                    <Payload label="内容" text={text} />
                  </div>
                ) : null}
              </li>
            );
          }

          // Standalone TOOL_RESULT (call missing — trace started mid-run).
          // Read from the step itself, not from `result`, which is null here.
          if (step.kind === "TOOL_RESULT" && result === null) {
            const output = payloadText(step.output);
            const duration = formatDuration(step.durationMs);
            const isError = step.isError;
            const hasContent = output !== null;

            return (
              <li
                key={entry.key}
                className={`trace-step trace-step--tool${isError ? " trace-step--error" : ""}`}
              >
                {hasContent ? (
                  <button
                    type="button"
                    className="trace-step__head trace-step__head--toggle"
                    onClick={() => toggleEntry(entry.key)}
                    aria-expanded={entryExpanded}
                    aria-controls={`${entry.key}-panel`}
                  >
                    <span className="trace-offset">{offset}</span>
                    <Tag color={isError ? "red" : "geekblue"}>
                      {traceStepKindLabels.TOOL_RESULT}
                    </Tag>
                    <b className="trace-step__tool">{step.label}</b>
                    {duration === null ? null : (
                      <span className="trace-step__meta">{duration}</span>
                    )}
                    <span className="trace-step__chevron" aria-hidden>
                      {entryExpanded ? "▾" : "▸"}
                    </span>
                  </button>
                ) : (
                  <div className="trace-step__head">
                    <span className="trace-offset">{offset}</span>
                    <Tag color={isError ? "red" : "geekblue"}>
                      {traceStepKindLabels.TOOL_RESULT}
                    </Tag>
                    <b className="trace-step__tool">{step.label}</b>
                    {duration === null ? null : (
                      <span className="trace-step__meta">{duration}</span>
                    )}
                  </div>
                )}
                {hasContent && entryExpanded ? (
                  <div id={`${entry.key}-panel`} className="trace-step__body">
                    <Payload
                      label={isError ? "错误" : "返回"}
                      text={output}
                      tone={isError ? "error" : undefined}
                    />
                  </div>
                ) : null}
              </li>
            );
          }

          // Paired TOOL_CALL + TOOL_RESULT.
          const input = payloadText(step.input);
          const output = payloadText(result?.output);
          const duration = formatDuration(result?.durationMs ?? step.durationMs);
          const isError = result?.isError === true;
          const hasContent = input !== null || output !== null;

          return (
            <li
              key={entry.key}
              className={`trace-step trace-step--tool${isError ? " trace-step--error" : ""}`}
            >
              {hasContent ? (
                <button
                  type="button"
                  className="trace-step__head trace-step__head--toggle"
                  onClick={() => toggleEntry(entry.key)}
                  aria-expanded={entryExpanded}
                  aria-controls={`${entry.key}-panel`}
                >
                  <span className="trace-offset">{offset}</span>
                  <Tag color={isError ? "red" : "geekblue"}>{traceStepKindLabels.TOOL_CALL}</Tag>
                  <b className="trace-step__tool">{step.label}</b>
                  {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
                  {result === null ? <span className="trace-step__meta">等待返回…</span> : null}
                  <span className="trace-step__chevron" aria-hidden>
                    {entryExpanded ? "▾" : "▸"}
                  </span>
                </button>
              ) : (
                <div className="trace-step__head">
                  <span className="trace-offset">{offset}</span>
                  <Tag color={isError ? "red" : "geekblue"}>{traceStepKindLabels.TOOL_CALL}</Tag>
                  <b className="trace-step__tool">{step.label}</b>
                  {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
                  {result === null ? <span className="trace-step__meta">等待返回…</span> : null}
                </div>
              )}
              {hasContent && entryExpanded ? (
                <div id={`${entry.key}-panel`} className="trace-step__body">
                  {input === null ? null : <Payload label="入参" text={input} />}
                  {output === null ? null : (
                    <Payload
                      label={isError ? "错误" : "返回"}
                      text={output}
                      tone={isError ? "error" : undefined}
                    />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
