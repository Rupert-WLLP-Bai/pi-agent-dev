import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp } from "antd";
import {
  closeRemediation,
  listRemediations,
  type UpdateRemediationInput,
  updateRemediation,
} from "../api";
import { RemediationKanban } from "../components/remediation-board";

export default function RemediationBoardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const boardQuery = useQuery({ queryKey: ["remediations"], queryFn: listRemediations });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["remediations"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRemediationInput }) =>
      updateRemediation(id, input),
    onSuccess: async () => {
      await invalidate();
      message.success("已更新整改项");
    },
    onError: (error: Error) => message.error(error.message),
  });

  // mutateAsync so the drawer can show a refused close (the owner trying to
  // confirm their own fix) beside the field that caused it.
  const closeMutation = useMutation({
    mutationFn: ({ id, closedBy }: { id: string; closedBy: string }) =>
      closeRemediation(id, closedBy),
    onSuccess: async () => {
      await invalidate();
      message.success("整改项已关闭");
    },
  });

  return (
    <RemediationKanban
      board={boardQuery.data}
      loading={boardQuery.isLoading}
      refreshing={boardQuery.isFetching && !boardQuery.isLoading}
      error={boardQuery.error as Error | null}
      updating={updateMutation.isPending}
      onRefresh={() => void boardQuery.refetch()}
      onUpdate={(id, input) => updateMutation.mutate({ id, input })}
      onClose={async (id, closedBy) => {
        await closeMutation.mutateAsync({ id, closedBy });
      }}
      onOpenCase={(caseId) =>
        void navigate({
          to: "/audit-cases/$id",
          params: { id: caseId },
          search: { origin: "remediations" },
        })
      }
    />
  );
}
