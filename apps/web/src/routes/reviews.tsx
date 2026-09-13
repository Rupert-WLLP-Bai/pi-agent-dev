import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp } from "antd";
import { type AssignCaseInput, assignCase, listReviewQueue } from "../api";
import { ReviewCenter } from "../components/review-center";

export default function ReviewCenterPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const queueQuery = useQuery({ queryKey: ["review-queue"], queryFn: listReviewQueue });

  const assignMutation = useMutation({
    mutationFn: async ({ caseIds, input }: { caseIds: string[]; input: AssignCaseInput }) => {
      // A batch is a run of per-case calls: there is no bulk endpoint, and a
      // partial failure leaves the successful cases assigned. The refetch then
      // shows exactly which rows took the change.
      for (const caseId of caseIds) await assignCase(caseId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      message.success("已更新复核指派");
    },
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <ReviewCenter
      items={queueQuery.data ?? []}
      loading={queueQuery.isLoading}
      refreshing={queueQuery.isFetching && !queueQuery.isLoading}
      error={queueQuery.error as Error | null}
      assigning={assignMutation.isPending}
      onOpen={(caseId) =>
        void navigate({
          to: "/audit-cases/$id",
          params: { id: caseId },
          search: { origin: "reviews" },
        })
      }
      onRefresh={() => void queueQuery.refetch()}
      onAssign={(caseIds, input) => assignMutation.mutate({ caseIds, input })}
    />
  );
}
