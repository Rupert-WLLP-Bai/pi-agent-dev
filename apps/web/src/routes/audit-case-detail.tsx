import type { FindingRevision } from "@contract-audit/audit/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp, Button, Result, Skeleton } from "antd";
import { useCallback, useState } from "react";
import {
  ApiRequestError,
  cancelAuditCase,
  getAuditCase,
  reassessAuditCase,
  retryAuditCase,
  submitReview,
} from "../api";
import type { AuditCaseOrigin } from "../app";
import { AuditCaseWorkbench } from "../components/audit-case-workbench";
import { ReviewDrawer } from "../components/review-drawer";
import { useAuditEvents } from "../hooks/use-audit-events";

// Stages where the backend can still move the case forward, so live updates are useful.
const streamStages = new Set([
  "QUEUED",
  "NORMALIZING",
  "RULE_ASSESSMENT",
  "SUBJECT_VERIFICATION",
  "AGENT_RUNNING",
  "AWAITING_REVIEW",
]);

interface ReviewTarget {
  finding: FindingRevision | null;
  decision: "ACCEPTED" | "REJECTED" | null;
}

const closedReview: ReviewTarget = { finding: null, decision: null };

/** Where a case detail opened from returns to, keyed by the entry point. */
const originHome: Record<AuditCaseOrigin, { label: string; to: "/reviews" | "/remediations" }> = {
  reviews: { label: "返回复核中心", to: "/reviews" },
  remediations: { label: "返回整改跟踪", to: "/remediations" },
};

export default function AuditCaseDetail({
  id,
  origin = null,
}: {
  id: string;
  /** Where the operator came from, so the workbench returns there. */
  origin?: AuditCaseOrigin | null;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [review, setReview] = useState<ReviewTarget>(closedReview);

  const detailQuery = useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) });

  const handleAuditEvent = useCallback(
    (event: { type: string }) => {
      // agent.trace carries tool payloads that don't change the case detail;
      // refetching here for every trace frame wastes a request and makes the
      // detail view flicker during a live run.
      if (event.type === "agent.trace") return;
      void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
    },
    [queryClient, id],
  );

  const detail = detailQuery.data;
  const streamEnabled = detail !== undefined && streamStages.has(detail.case.stage);
  const connection = useAuditEvents(id, handleAuditEvent, streamEnabled);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
    await queryClient.invalidateQueries({ queryKey: ["audit-cases"] });
  };

  const cancelMutation = useMutation({
    mutationFn: () => cancelAuditCase(id),
    onSuccess: async () => {
      await invalidateAll();
      message.success("已取消审计");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryAuditCase(id),
    onSuccess: async () => {
      await invalidateAll();
      message.success("已重新排队");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const reassessMutation = useMutation({
    mutationFn: () => reassessAuditCase(id),
    onSuccess: async () => {
      await invalidateAll();
      message.success("已按当前规则重评并重新排队");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const reviewMutation = useMutation({
    mutationFn: (input: {
      findingId: string;
      decision: "ACCEPTED" | "REJECTED";
      reason?: string;
    }) => submitReview(input.findingId, input.decision, input.reason),
    onSuccess: async () => {
      setReview(closedReview);
      await invalidateAll();
      message.success("复核已提交");
    },
    onError: (error: Error) => {
      if (error instanceof ApiRequestError && error.status === 409) {
        setReview(closedReview);
        message.warning("该发现已完成复核，请刷新查看最新状态");
        void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
      }
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="page workbench-loading" aria-busy="true">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (detailQuery.isError || detail === undefined) {
    return (
      <Result
        status="error"
        title="无法加载审计详情"
        subTitle={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
        extra={
          <Button type="primary" onClick={() => void detailQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const conflicted =
    reviewMutation.error instanceof ApiRequestError && reviewMutation.error.status === 409;
  const reviewError = reviewMutation.isError && !conflicted ? reviewMutation.error.message : null;

  if (detail.snapshot === null) {
    return (
      <div className="page workbench-loading" aria-busy="true">
        <Skeleton active paragraph={{ rows: 8 }} title={{ width: "40%" }} />
      </div>
    );
  }

  const loadedDetail = { ...detail, snapshot: detail.snapshot };

  return (
    <>
      <AuditCaseWorkbench
        detail={loadedDetail}
        connection={connection}
        action={
          cancelMutation.isPending
            ? { type: "CANCEL" }
            : reassessMutation.isPending
              ? { type: "REASSESS" }
              : retryMutation.isPending
                ? { type: "RETRY" }
                : null
        }
        onOpenReview={(decision, finding) =>
          setReview({
            finding,
            decision,
          })
        }
        onCancel={() => cancelMutation.mutate()}
        onRetry={() => retryMutation.mutate()}
        onReassess={() => reassessMutation.mutate()}
        backLabel={origin === null ? undefined : originHome[origin].label}
        onBack={() =>
          void navigate({ to: origin === null ? "/audit-cases" : originHome[origin].to })
        }
        onOpenTrace={() =>
          void navigate({
            to: "/audit-cases/$id/trace",
            params: { id },
            search: { runId: undefined, expand: true },
          })
        }
      />
      <ReviewDrawer
        finding={review.finding}
        decision={review.decision}
        open={review.finding !== null && review.decision !== null}
        submitting={reviewMutation.isPending}
        error={reviewError}
        onClose={() => setReview(closedReview)}
        onSubmit={(input) => reviewMutation.mutate(input)}
      />
    </>
  );
}
