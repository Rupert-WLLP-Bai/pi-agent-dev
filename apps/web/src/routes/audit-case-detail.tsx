import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp, Button, Result, Skeleton } from "antd";
import type { FindingRevision } from "@contract-audit/audit/model";
import {
  ApiRequestError,
  cancelAuditCase,
  getAuditCase,
  retryAuditCase,
  submitReview,
} from "../api";
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

export default function AuditCaseDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [review, setReview] = useState<ReviewTarget>(closedReview);

  const detailQuery = useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) });

  const handleAuditEvent = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
  }, [queryClient, id]);

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

  const reviewMutation = useMutation({
    mutationFn: (input: { findingId: string; decision: "ACCEPTED" | "REJECTED"; reason?: string }) =>
      submitReview(input.findingId, input.decision, input.reason),
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
      <div className="workbench-loading" aria-busy="true">
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
        extra={<Button type="primary" onClick={() => void detailQuery.refetch()}>重新加载</Button>}
      />
    );
  }

  const conflicted = reviewMutation.error instanceof ApiRequestError && reviewMutation.error.status === 409;
  const reviewError = reviewMutation.isError && !conflicted ? reviewMutation.error.message : null;

  return (
    <>
      <AuditCaseWorkbench
        detail={detail}
        connection={connection}
        action={
          cancelMutation.isPending
            ? { type: "CANCEL" }
            : retryMutation.isPending
              ? { type: "RETRY" }
              : null
        }
        onOpenReview={(decision) =>
          setReview({
            finding: detail.findings.find((finding) => finding.review === null) ?? null,
            decision,
          })
        }
        onCancel={() => cancelMutation.mutate()}
        onRetry={() => retryMutation.mutate()}
        onBack={() => void navigate({ to: "/audit-cases" })}
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
