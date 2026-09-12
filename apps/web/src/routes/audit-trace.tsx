import type { AgentRunTrace, AuditCase } from "@contract-audit/audit/model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Card, Empty, Result, Segmented, Skeleton, Tag } from "antd";
import { useCallback, useState } from "react";
import { getAgentRunTraces, getAuditCase } from "../api";
import {
  agentRunStateLabels,
  agentRunStateTones,
  describeTokenUsage,
  formatDuration,
  getAgentRunState,
  shortAuditId,
} from "../audit-presentation";
import { AgentTraceTimeline } from "../components/agent-trace-timeline";
import { AuditStateBadge } from "../components/audit-state-badge";
import { type AuditConnectionState, useAuditEvents } from "../hooks/use-audit-events";

// Stages where the backend can still produce trace steps for this case.
const liveStages = new Set([
  "QUEUED",
  "NORMALIZING",
  "RULE_ASSESSMENT",
  "SUBJECT_VERIFICATION",
  "AGENT_RUNNING",
  "AWAITING_REVIEW",
]);

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

/**
 * One case's Agent Run traces. A retried case has more than one run, so the
 * page keeps every run selectable instead of hiding the earlier attempts.
 */
export default function AuditTracePage({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const caseQuery = useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) });
  const tracesQuery = useQuery({
    queryKey: ["audit-case-trace", id],
    queryFn: () => getAgentRunTraces(id),
  });

  const detail = caseQuery.data;
  const traces = tracesQuery.data ?? [];
  const streamEnabled = detail !== undefined && liveStages.has(detail.case.stage);

  const handleAuditEvent = useCallback(() => {
    // Each event may be a new trace step, so the trace is refetched alongside
    // the case: a viewer watching a run must see it grow, not freeze.
    void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
    void queryClient.invalidateQueries({ queryKey: ["audit-case-trace", id] });
  }, [queryClient, id]);

  const connection = useAuditEvents(id, handleAuditEvent, streamEnabled);

  if (caseQuery.isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (caseQuery.isError || detail === undefined) {
    return (
      <Result
        status="error"
        title="无法加载该审计案件"
        subTitle={caseQuery.error?.message}
        extra={
          <Button type="primary" onClick={() => void navigate({ to: "/audit-cases" })}>
            返回审计队列
          </Button>
        }
      />
    );
  }

  const contractTitle = detail.snapshot.document.blocks[0]?.text ?? "未命名合同";
  const selected = traces.find((trace) => trace.run.id === selectedRunId) ?? traces.at(0) ?? null;

  return (
    <div className="trace-page">
      <div className="case-banner">
        <button
          type="button"
          className="back-link"
          onClick={() => void navigate({ to: "/audit-cases/$id", params: { id } })}
        >
          ← 返回案件详情
        </button>
        <div className="case-title-row">
          <h2>{contractTitle}</h2>
          <div className="case-status">
            <AuditStateBadge auditCase={detail.case} />
            <Tag
              color={
                connection === "connected" ? "blue" : connection === "closed" ? "default" : "orange"
              }
              style={{ fontSize: 11 }}
            >
              {connection === "connected" ? "实时更新" : "未连接"}
            </Tag>
          </div>
        </div>
        <div className="case-meta">
          <span>
            审计 ID <b className="mono">{shortAuditId(detail.case.id)}</b>
          </span>
          <span>
            运行次数 <b>{traces.length}</b>
          </span>
        </div>
      </div>

      {traces.length > 1 ? (
        <Segmented
          className="trace-run-picker"
          value={selected?.run.id}
          onChange={(value) => setSelectedRunId(String(value))}
          options={traces.map((trace, index) => ({
            value: trace.run.id,
            label: `第 ${traces.length - index} 次运行`,
          }))}
        />
      ) : null}

      {selected === null ? (
        <Card>
          <Empty description="该案件还没有智能体运行记录" />
        </Card>
      ) : (
        <RunTraceSection
          trace={selected}
          caseStatus={detail.case.status}
          connection={connection}
          isFetching={tracesQuery.isFetching}
        />
      )}
    </div>
  );
}

function RunTraceSection({
  trace,
  caseStatus,
  connection,
  isFetching,
}: {
  trace: AgentRunTrace;
  caseStatus: AuditCase["status"];
  connection: AuditConnectionState;
  isFetching: boolean;
}) {
  const { run, steps } = trace;
  const state = getAgentRunState(run, caseStatus);
  const usage = describeTokenUsage(run.usage);
  const duration = formatDuration(run.durationMs);

  return (
    <Card
      className="trace-card"
      title={
        <span className="trace-card__title">
          <Tag color={agentRunStateTones[state]}>{agentRunStateLabels[state]}</Tag>
          <b className="mono">
            {run.provider} / {run.model}@{run.version}
          </b>
          {state === "RUNNING" && connection === "connected" ? (
            <span className="trace-live">● 跟踪中</span>
          ) : null}
          {isFetching && state !== "RUNNING" ? (
            <span className="trace-card__meta">正在刷新…</span>
          ) : null}
        </span>
      }
      extra={
        <span className="trace-card__meta">
          {steps.length} 步 · {duration ?? "—"}
          {usage === null ? "" : ` · ${usage}`}
        </span>
      }
    >
      {run.error === null ? null : (
        <Alert type="error" showIcon title="本次运行以失败结束" description={run.error} />
      )}
      <div className="trace-card__meta trace-card__meta--block">
        运行 ID <b className="mono">{run.id}</b> · 开始于 {formatTime(run.createdAt)}
      </div>
      <AgentTraceTimeline steps={steps} />
    </Card>
  );
}
