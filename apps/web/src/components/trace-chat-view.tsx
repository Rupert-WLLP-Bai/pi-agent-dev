import { Collapse, Empty, Tag } from "antd";
import { formatTracePayload, getTraceStageLabel, traceStepKindLabels } from "../audit-presentation";
import { formatMetricMs, type TraceEvent, toChatTurns } from "../trace/normalize-trace-events";

/**
 * Conversation-oriented view of a run: stages, assistant text, and paired tools.
 */
export function TraceChatView({ events }: { events: readonly TraceEvent[] }) {
  const turns = toChatTurns(events);
  if (turns.length === 0) {
    return <Empty description="暂无对话内容" />;
  }

  return (
    <ol className="trace-chat" data-testid="trace-chat-view">
      {turns.map((turn) => {
        if (turn.role === "stage") {
          return (
            <li key={turn.key} className="trace-chat__stage">
              <Tag>{getTraceStageLabel(turn.event.label)}</Tag>
              <span className="trace-chat__meta mono">
                {turn.event.timeTrust === "invalid" ? "时间无效" : turn.event.at}
              </span>
            </li>
          );
        }
        if (turn.role === "assistant") {
          const text =
            typeof turn.event.output === "string"
              ? turn.event.output
              : typeof turn.event.input === "string"
                ? turn.event.input
                : (formatTracePayload(turn.event.output ?? turn.event.input) ?? "");
          return (
            <li key={turn.key} className="trace-chat__bubble trace-chat__bubble--assistant">
              <div className="trace-chat__role">助手</div>
              <pre className="trace-chat__body">{text || "（无文本）"}</pre>
              <div className="trace-chat__meta">
                {traceStepKindLabels.MESSAGE} · 耗时 {formatMetricMs(turn.event.durationMs)}
              </div>
            </li>
          );
        }
        const result = turn.result ?? null;
        return (
          <li key={turn.key} className="trace-chat__bubble trace-chat__bubble--tool">
            <div className="trace-chat__role">
              工具 <span className="mono">{turn.event.label}</span>
              {turn.event.isError || result?.isError ? <Tag color="error">错误</Tag> : null}
            </div>
            <Collapse
              size="small"
              items={[
                {
                  key: "io",
                  label: `请求 / 结果 · 耗时 ${formatMetricMs(result?.durationMs ?? turn.event.durationMs)}`,
                  children: (
                    <div className="trace-chat__io">
                      <div>
                        <div className="trace-chat__io-label">请求</div>
                        <pre className="mono">
                          {formatTracePayload(turn.event.input) ?? "未提供"}
                        </pre>
                      </div>
                      <div>
                        <div className="trace-chat__io-label">结果</div>
                        <pre className="mono">
                          {result ? (formatTracePayload(result.output) ?? "未提供") : "未提供"}
                        </pre>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </li>
        );
      })}
    </ol>
  );
}
