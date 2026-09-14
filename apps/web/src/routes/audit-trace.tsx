import type { AgentRunTrace, AuditCase, FindingRevision } from "@contract-audit/audit/model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Card, Empty, Result, Segmented, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAgentRunTraces, getAuditCase } from "../api";
import {
  agentRunStateLabels,
  agentRunStateTagColors,
  findingTypeLabels,
  formatDuration,
  formatModelIdentity,
  getAgentRunState,
  shortAuditId,
} from "../audit-presentation";
import { AgentTraceTimeline } from "../components/agent-trace-timeline";
import { AuditStateBadge } from "../components/audit-state-badge";
import { TokenUsage } from "../components/token-usage";
import { type AuditConnectionState, useAuditEvents } from "../hooks/use-audit-events";

// Stages where the backend can still produce trace steps for this case.
const liveStages = new Set([
  "QUEUED",
  "NORMALIZING",
  "RULE_ASSESSMENT",
  "SUBJECT_VERIFICATION",
  "AGENT_RUNNING",
]);

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

/**
 * One case's Agent Run traces. A retried case has more than one run, so the
 * page keeps every run selectable instead of hiding the earlier attempts.
 */
export default function AuditTracePage({
  id,
  initialRunId,
  defaultExpanded = false,
}: {
  id: string;
  initialRunId: string | null;
  /** Open every trace payload on first render instead of collapsing them. */
  defaultExpanded?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);

  const caseQuery = useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) });
  const tracesQuery = useQuery({
    queryKey: ["audit-case-trace", id],
    queryFn: () => getAgentRunTraces(id),
  });

  const detail = caseQuery.data;
  const streamEnabled = detail !== undefined && liveStages.has(detail.case.stage);

  const handleAuditEvent = useCallback(
    (event: { type: string }) => {
      // Only trace frames and lifecycle transitions grow or change the trace.
      // filtering.proposed / audit.awaiting_review don't add steps, so a
      // refetch here would be wasted work during a live run.
      if (event.type === "agent.trace" || event.type === "agent.started") {
        void queryClient.invalidateQueries({ queryKey: ["audit-case-trace", id] });
      }
      // Case-level transitions (completion, failure, cancellation) change the
      // case status, which determines whether the run is still "live".
      if (
        event.type === "audit.completed" ||
        event.type === "audit.failed" ||
        event.type === "audit.cancelled" ||
        event.type === "audit.awaiting_review"
      ) {
        void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
        void queryClient.invalidateQueries({ queryKey: ["audit-case-trace", id] });
      }
    },
    [queryClient, id],
  );

  const connection = useAuditEvents(id, handleAuditEvent, streamEnabled);

  const traces = tracesQuery.data ?? [];
  const selected = traces.find((trace) => trace.run.id === selectedRunId) ?? traces.at(0) ?? null;

  // When an initialRunId from the URL doesn't match any loaded trace, fall
  // back to the newest run so the page is never blank. This must run before
  // any early return to satisfy the Rules of Hooks.
  useEffect(() => {
    if (selected !== null && selected.run.id !== selectedRunId) {
      setSelectedRunId(selected.run.id);
    }
  }, [selected, selectedRunId]);

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
  const selectedIsLive =
    selected !== null &&
    getAgentRunState(selected.run, detail.case.status, traces[0]?.run.id === selected.run.id) ===
      "RUNNING";

  return (
    <div className="page">
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
            {selectedIsLive ? (
              <Tag
                color={
                  connection === "connected"
                    ? "blue"
                    : connection === "closed"
                      ? "default"
                      : "orange"
                }
                style={{ fontSize: 11 }}
              >
                {connection === "connected" ? "实时更新" : "未连接"}
              </Tag>
            ) : null}
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

      {tracesQuery.isLoading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      ) : tracesQuery.isError ? (
        <Result
          status="error"
          title="无法加载运行轨迹"
          subTitle={tracesQuery.error?.message}
          extra={
            <Button type="primary" onClick={() => void tracesQuery.refetch()}>
              重新加载
            </Button>
          }
        />
      ) : selected === null ? (
        <Card>
          <Empty description="该案件还没有智能体运行记录" />
        </Card>
      ) : (
        <RunTraceSection
          trace={selected}
          caseStatus={detail.case.status}
          isLatest={traces[0]?.run.id === selected.run.id}
          findings={detail.findings}
          connection={connection}
          isFetching={tracesQuery.isFetching}
          defaultExpanded={defaultExpanded}
        />
      )}
    </div>
  );
}

function RunTraceSection({
  trace,
  caseStatus,
  isLatest,
  findings,
  connection,
  isFetching,
  defaultExpanded,
}: {
  trace: AgentRunTrace;
  caseStatus: AuditCase["status"];
  isLatest: boolean;
  findings: FindingRevision[];
  connection: AuditConnectionState;
  isFetching: boolean;
  defaultExpanded: boolean;
}) {
  const { run, steps } = trace;
  const state = getAgentRunState(run, caseStatus, isLatest);
  const duration = formatDuration(run.durationMs);

  // Tail-follow: keep the viewport pinned to the newest step while a run is
  // live, but only if the viewer was already near the bottom — scrolling away
  // to inspect an earlier step must not be yanked back.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const wasNearTail = useRef(true);
  const stepCount = steps.length;

  // Track whether the viewport was near the bottom of the page. The page
  // itself scrolls (not an inner container), so we listen on window.
  useEffect(() => {
    const onScroll = () => {
      wasNearTail.current = window.scrollY + window.innerHeight > document.body.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stepCount is an intentional trigger — the view has to re-follow each time a step lands, not only when the run state changes.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || state !== "RUNNING") return;
    if (wasNearTail.current) {
      sentinel.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [stepCount, state]);

  return (
    <Card
      className="trace-card"
      title={
        <span className="trace-card__title">
          <Tag color={agentRunStateTagColors[state]}>{agentRunStateLabels[state]}</Tag>
          <b className="mono">{formatModelIdentity(run.provider, run.model, run.version)}</b>
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
          {steps.length} 步 · {duration ?? "-"}
        </span>
      }
    >
      {run.error === null ? null : (
        <Alert type="error" showIcon title="本次运行以失败结束" description={run.error} />
      )}
      <div className="trace-card__meta trace-card__meta--block">
        运行 ID <b className="mono">{shortAuditId(run.id)}</b> · 开始于 {formatTime(run.createdAt)}
        {run.usage === null ? null : (
          <>
            {" · "}
            <TokenUsage usage={run.usage} />
          </>
        )}
      </div>
      <AgentTraceTimeline steps={steps} defaultExpanded={defaultExpanded} />
      {findings.length > 0 ? (
        <div className="trace-findings">
          <div className="trace-findings__label">本次运行产生的审计发现</div>
          {findings.map((finding) => (
            <div key={finding.id} className="trace-finding">
              <Tag
                color={
                  finding.proposal.severity === "HIGH"
                    ? "red"
                    : finding.proposal.severity === "MEDIUM"
                      ? "orange"
                      : "blue"
                }
              >
                {finding.proposal.severity}
              </Tag>
              <span className="trace-finding__type">
                {findingTypeLabels[finding.proposal.findingType]}
              </span>
              {finding.review !== null ? (
                <Tag color={finding.review.decision === "ACCEPTED" ? "success" : "error"}>
                  {finding.review.decision === "ACCEPTED" ? "已采纳" : "已驳回"}
                </Tag>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div ref={sentinelRef} />
    </Card>
  );
}
