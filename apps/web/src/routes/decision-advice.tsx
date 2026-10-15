import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type DecisionFeedbackInput,
  getDecisionAdvice,
  listDecisionAdvice,
  submitDecisionFeedback,
} from "../api";
import { DecisionAdvicePanel } from "../components/decision-advice-panel";
import { readOperator } from "../operator";

/**
 * 审计案件 - 辅助决策 page.
 *
 * One page holds the case's shadow advice: a list of every recorded decision
 * and the detail of whichever one is selected, with independent feedback. The
 * advice is read-only; nothing here can create, retry or delete a decision.
 *
 * Feedback idempotency: each operator action mints one key and the mutation
 * reuses it for that action's retries. A new action mints a new key, so
 * replaying the *same* submission is idempotent while a genuinely different
 * choice appends a new event. The key is generated per submit, and a submit
 * already in flight reuses the pending key rather than minting another.
 */
export default function DecisionAdvicePage({ auditCaseId }: { auditCaseId: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The key for the action currently being submitted. Cleared once the request
  // settles, so the next submit mints a fresh key.
  const pendingKey = useRef<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["decision-advice", auditCaseId],
    queryFn: () => listDecisionAdvice(auditCaseId),
    retry: false,
  });

  const items = listQuery.data?.items ?? [];
  const activeId = selectedId ?? items[0]?.decisionId ?? null;

  const detailQuery = useQuery({
    queryKey: ["decision-detail", activeId],
    queryFn: () => getDecisionAdvice(activeId as string),
    enabled: activeId !== null,
    retry: false,
  });

  const feedbackMutation = useMutation({
    mutationFn: (input: DecisionFeedbackInput & { decisionId: string }) =>
      submitDecisionFeedback(input.decisionId, {
        decision: input.decision,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: async () => {
      pendingKey.current = null;
      await queryClient.invalidateQueries({ queryKey: ["decision-detail", activeId] });
      await queryClient.invalidateQueries({ queryKey: ["decision-advice", auditCaseId] });
    },
    onError: () => {
      // The key is retained on failure so a network retry replays the same
      // submission instead of appending a second event.
    },
  });

  const submitFeedback = useCallback(
    (decisionId: string, decision: DecisionFeedbackInput["decision"], reason: string) => {
      const key = pendingKey.current ?? crypto.randomUUID();
      pendingKey.current = key;
      feedbackMutation.mutate({ decisionId, decision, reason, idempotencyKey: key });
    },
    [feedbackMutation],
  );

  const list = useMemo(
    () =>
      listQuery.data === undefined
        ? undefined
        : {
            mode: listQuery.data.mode,
            provider: listQuery.data.provider,
            items: listQuery.data.items,
          },
    [listQuery.data],
  );

  const detail = useMemo(
    () =>
      detailQuery.data === undefined
        ? undefined
        : { advice: detailQuery.data.advice, feedback: detailQuery.data.feedback },
    [detailQuery.data],
  );

  return (
    <div className="page decision-page">
      <DecisionAdvicePanel
        list={list}
        loading={listQuery.isFetching}
        error={listQuery.error as Error | null}
        onRefresh={() => void listQuery.refetch()}
        detail={detail}
        detailLoading={detailQuery.isFetching && detail === undefined}
        detailError={detailQuery.error as Error | null}
        onSelect={setSelectedId}
        onSubmitFeedback={submitFeedback}
        submittingFeedback={feedbackMutation.isPending}
        feedbackError={feedbackMutation.error as Error | null}
        actor={readOperator()}
      />
    </div>
  );
}
