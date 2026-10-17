import { Empty, Segmented, Tag } from "antd";
import { useMemo, useState } from "react";
import {
  formatTraceOffset,
  formatTracePayload,
  getTraceStageLabel,
  traceStepKindLabels,
} from "../audit-presentation";
import {
  formatMetricMs,
  formatMetricTokens,
  type TraceEvent,
  type TraceLane,
} from "../trace/normalize-trace-events";

const LANE_OPTIONS: Array<{ value: TraceLane | "all"; label: string }> = [
  { value: "all", label: "全部泳道" },
  { value: "input", label: "输入" },
  { value: "model", label: "模型" },
  { value: "tool", label: "工具" },
];

const LANE_LABEL: Record<TraceLane, string> = {
  input: "输入",
  model: "模型",
  tool: "工具",
};

/**
 * Compact three-lane trajectory list. Filter by lane; durations stay explicit
 * 未提供 when missing. Monospace payloads; no invented busy gaps.
 */
export function TraceLaneView({
  events,
  runStartedAt,
}: {
  events: readonly TraceEvent[];
  runStartedAt: string;
}) {
  const [lane, setLane] = useState<TraceLane | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const visible = useMemo(
    () => (lane === "all" ? events : events.filter((e) => e.lane === lane)),
    [events, lane],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="trace-lanes" data-testid="trace-lane-view">
      <div className="trace-lanes__toolbar">
        <Segmented
          size="small"
          value={lane}
          options={LANE_OPTIONS}
          onChange={(value) => setLane(value as TraceLane | "all")}
        />
        <span className="trace-lanes__hint">等宽载荷 · 缺失耗时显示「未提供」</span>
      </div>
      {visible.length === 0 ? (
        <Empty description={lane === "input" ? "输入概况见上方运行卡片" : "此泳道暂无事件"} />
      ) : (
        <ol className="trace-lanes__list">
          {visible.map((event) => {
            const open = expanded.has(event.id);
            const title = event.kind === "STAGE" ? getTraceStageLabel(event.label) : event.label;
            return (
              <li
                key={event.id}
                id={`trace-event-${event.id}`}
                className={`trace-lanes__row trace-lanes__row--${event.lane}${event.isError ? " trace-lanes__row--error" : ""}`}
              >
                <button
                  type="button"
                  className="trace-lanes__toggle"
                  aria-expanded={open}
                  onClick={() => toggle(event.id)}
                >
                  <span className="trace-lanes__lane">{LANE_LABEL[event.lane]}</span>
                  <Tag>{traceStepKindLabels[event.kind]}</Tag>
                  <span className="trace-lanes__title mono">{title}</span>
                  <span className="trace-lanes__meta mono">
                    {event.timeTrust === "invalid"
                      ? "时间无效"
                      : formatTraceOffset(runStartedAt, event.at)}
                    {" · "}
                    {formatMetricMs(event.durationMs)}
                    {" · "}
                    {formatMetricTokens(event.tokens)}
                  </span>
                </button>
                {open ? (
                  <div className="trace-lanes__payload">
                    <pre className="mono">
                      {formatTracePayload({
                        input: event.input,
                        output: event.output,
                        ref: event.ref,
                        parentRef: event.parentRef,
                      }) ?? "未提供"}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
