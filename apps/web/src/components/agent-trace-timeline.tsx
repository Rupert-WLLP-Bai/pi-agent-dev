import type { AgentTraceStep } from "@contract-audit/audit/model";
import { Tag } from "antd";
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

export function AgentTraceTimeline({ steps }: { steps: AgentTraceStep[] }) {
  if (steps.length === 0) {
    return <p className="trace-empty">本次运行没有可展示的轨迹步骤。</p>;
  }

  const origin = steps[0].at;

  return (
    <ol className="trace-timeline">
      {toTraceEntries(steps).map((entry) => {
        const { step, result } = entry;
        const offset = formatTraceOffset(origin, step.at);

        if (step.kind === "STAGE") {
          const turn =
            step.input !== null && typeof step.input === "object" && "turnIndex" in step.input
              ? Number((step.input as { turnIndex: unknown }).turnIndex) + 1
              : null;
          const duration = formatDuration(step.durationMs);
          return (
            <li key={entry.key} className={`trace-stage trace-stage--${step.label.toLowerCase()}`}>
              <span className="trace-offset">{offset}</span>
              <span className="trace-stage__label">{getTraceStageLabel(step.label)}</span>
              {turn === null ? null : <span className="trace-stage__turn">第 {turn} 回合</span>}
              {duration === null ? null : <span className="trace-stage__duration">{duration}</span>}
            </li>
          );
        }

        if (step.kind === "MESSAGE") {
          const text = formatTracePayload(step.output);
          return (
            <li key={entry.key} className="trace-step trace-step--message">
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
              {text === null ? null : <Payload label="内容" text={text} />}
            </li>
          );
        }

        const input = formatTracePayload(step.input);
        const output = formatTracePayload(result?.output);
        const duration = formatDuration(result?.durationMs ?? step.durationMs);
        const isError = result?.isError === true;

        return (
          <li
            key={entry.key}
            className={`trace-step trace-step--tool${isError ? " trace-step--error" : ""}`}
          >
            <div className="trace-step__head">
              <span className="trace-offset">{offset}</span>
              <Tag color={isError ? "red" : "geekblue"}>{traceStepKindLabels.TOOL_CALL}</Tag>
              <b className="trace-step__tool">{step.label}</b>
              {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
              {result === null ? <span className="trace-step__meta">等待返回…</span> : null}
            </div>
            {input === null ? null : <Payload label="入参" text={input} />}
            {output === null ? null : (
              <Payload
                label={isError ? "错误" : "返回"}
                text={output}
                tone={isError ? "error" : undefined}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
