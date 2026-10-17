import type { AgentRun, AgentTraceStep } from "@contract-audit/audit/model";
import { Descriptions, Tag } from "antd";
import { formatModelIdentity, shortAuditId } from "../audit-presentation";
import {
  buildRunOverview,
  formatMetricMs,
  formatMetricUsage,
  METRIC_NOT_PROVIDED,
} from "../trace/normalize-trace-events";

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

/**
 * Compact run identity and metrics. Missing numbers show 未提供 — never 0.
 */
export function TraceRunOverviewCard({
  run,
  steps,
}: {
  run: AgentRun;
  steps: readonly AgentTraceStep[];
}) {
  const overview = buildRunOverview(run, steps);

  return (
    <div className="trace-overview" data-testid="trace-run-overview">
      <div className="trace-overview__identity">
        <Tag>{overview.provider}</Tag>
        <b className="mono">{formatModelIdentity(run.provider, run.model, run.version)}</b>
        <span className="trace-overview__muted">
          运行 <span className="mono">{shortAuditId(overview.runId)}</span>
        </span>
      </div>
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, md: 4 }}
        className="trace-overview__metrics"
        items={[
          {
            key: "duration",
            label: "总耗时",
            children: formatMetricMs(overview.durationMs),
          },
          {
            key: "usage",
            label: "用量",
            children: formatMetricUsage(overview.usage),
          },
          {
            key: "steps",
            label: "步骤",
            children: `${overview.stepCount}（消息 ${overview.messageCount} · 工具 ${overview.toolCallCount} · 阶段 ${overview.stageCount}）`,
          },
          {
            key: "started",
            label: "开始于",
            children: formatTime(overview.createdAt),
          },
          {
            key: "error",
            label: "错误",
            children: overview.error ?? METRIC_NOT_PROVIDED,
          },
        ]}
      />
    </div>
  );
}
