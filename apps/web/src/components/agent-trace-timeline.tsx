import type { AgentTraceStep } from "@contract-audit/audit/model";
import { Button, Tag } from "antd";
import { useState } from "react";
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
 * A horizontal Gantt-style bar showing each step's duration proportional to
 * the total run time. Stages are thin markers; tool calls are colored blocks;
 * messages are narrow slivers. Gives an instant visual of where time was
 * spent — the "timing overview" from the DeepSeek harness pattern.
 */
function TimingOverview({ entries }: { entries: TraceEntry[] }) {
  // Use the wall-clock span: last step's end minus first step's start.
  if (entries.length < 2) return null;
  const firstAt = new Date(entries[0].step.at).getTime();
  const lastAt = new Date(entries.at(-1)?.step.at ?? firstAt).getTime();
  const span = Math.max(lastAt - firstAt, 1);

  return (
    <div className="trace-overview" aria-hidden>
      {entries.map((entry) => {
        const { step, result } = entry;
        const start = new Date(step.at).getTime() - firstAt;
        const dur = result?.durationMs ?? step.durationMs ?? 0;
        const widthPct = Math.max((dur / span) * 100, dur > 0 ? 0.8 : 0);
        const leftPct = (start / span) * 100;
        const color =
          step.kind === "STAGE"
            ? "#1677ff"
            : step.kind === "TOOL_CALL"
              ? result?.isError
                ? "#ff4d4f"
                : "#722ed1"
              : step.kind === "MESSAGE"
                ? "#13c2c2"
                : "#d9d9d9";
        return (
          <div
            key={entry.key}
            className="trace-overview__bar"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              background: color,
            }}
            title={`${step.label} · ${formatDuration(dur) ?? "—"} · +${(start / 1000).toFixed(2)}s`}
          />
        );
      })}
    </div>
  );
}

export function AgentTraceTimeline({ steps }: { steps: AgentTraceStep[] }) {
  // Tool calls and messages start collapsed — the header (tool name,
  // duration, offset) is always visible; click to inspect the payload.
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);

  if (steps.length === 0) {
    return <p className="trace-empty">本次运行没有可展示的轨迹步骤。</p>;
  }

  const origin = steps[0].at;
  const entries = toTraceEntries(steps);

  // Tool/message entries that have payloads worth collapsing.
  const collapsibleKeys = entries
    .filter((e) => e.step.kind === "TOOL_CALL" || e.step.kind === "MESSAGE")
    .map((e) => e.key);

  // null = first render: everything collapsed (the default).
  const effectiveCollapsed = collapsed ?? new Set(collapsibleKeys);
  const isCollapsed = (key: string) => effectiveCollapsed.has(key);

  const toggleEntry = (key: string) => {
    setCollapsed((prev) => {
      const base = prev ?? new Set(collapsibleKeys);
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setAllExpanded(effectiveCollapsed.size === 0 && !effectiveCollapsed.has(key));
  };

  const toggleAll = () => {
    if (allExpanded) {
      setCollapsed(new Set(collapsibleKeys));
      setAllExpanded(false);
    } else {
      setCollapsed(new Set());
      setAllExpanded(true);
    }
  };

  return (
    <div className="trace-timeline-wrap">
      <div className="trace-timeline-toolbar">
        <span className="trace-timeline-toolbar__label">执行时序</span>
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
          const entryCollapsed = isCollapsed(entry.key);
          const hasPayload = step.kind === "TOOL_CALL" || step.kind === "MESSAGE";

          if (step.kind === "STAGE") {
            const turn =
              step.input !== null && typeof step.input === "object" && "turnIndex" in step.input
                ? Number((step.input as { turnIndex: unknown }).turnIndex) + 1
                : null;
            const duration = formatDuration(step.durationMs);
            return (
              <li
                key={entry.key}
                className={`trace-stage trace-stage--${step.label.toLowerCase()}`}
              >
                <span className="trace-offset">{offset}</span>
                <span className="trace-stage__label">{getTraceStageLabel(step.label)}</span>
                {turn === null ? null : <span className="trace-stage__turn">第 {turn} 回合</span>}
                {duration === null ? null : (
                  <span className="trace-stage__duration">{duration}</span>
                )}
              </li>
            );
          }

          if (step.kind === "MESSAGE") {
            const text = formatTracePayload(step.output);
            return (
              <li key={entry.key} className="trace-step trace-step--message">
                {hasPayload ? (
                  <button
                    type="button"
                    className="trace-step__head trace-step__head--toggle"
                    onClick={() => toggleEntry(entry.key)}
                  >
                    <span className="trace-offset">{offset}</span>
                    <Tag color="blue">{traceStepKindLabels.MESSAGE}</Tag>
                    {step.tokens === null ? null : (
                      <span className="trace-step__meta">
                        输入 {step.tokens.input.toLocaleString("en-US")} · 输出{" "}
                        {step.tokens.output.toLocaleString("en-US")}
                      </span>
                    )}
                    <span className="trace-step__chevron">{entryCollapsed ? "▸" : "▾"}</span>
                  </button>
                ) : (
                  <div className="trace-step__head">
                    <span className="trace-offset">{offset}</span>
                    <Tag color="blue">{traceStepKindLabels.MESSAGE}</Tag>
                    {step.tokens === null ? null : (
                      <span className="trace-step__meta">
                        输入 {step.tokens.input.toLocaleString("en-US")} · 输出{" "}
                        {step.tokens.output.toLocaleString("en-US")}
                      </span>
                    )}
                  </div>
                )}
                {hasPayload && !entryCollapsed && text !== null ? (
                  <Payload label="内容" text={text} />
                ) : null}
              </li>
            );
          }

          const input = formatTracePayload(step.input);
          const output = formatTracePayload(result?.output);
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
                >
                  <span className="trace-offset">{offset}</span>
                  <Tag color={isError ? "red" : "geekblue"}>{traceStepKindLabels.TOOL_CALL}</Tag>
                  <b className="trace-step__tool">{step.label}</b>
                  {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
                  {result === null ? <span className="trace-step__meta">等待返回…</span> : null}
                  <span className="trace-step__chevron">{entryCollapsed ? "▸" : "▾"}</span>
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
              {hasContent && !entryCollapsed ? (
                <div className="trace-step__body">
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
