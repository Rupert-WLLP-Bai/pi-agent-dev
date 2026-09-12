import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp } from "antd";
import { useState } from "react";
import {
  cancelAuditCase,
  createAuditCase,
  createAuditCaseFromFile,
  getAuditCases,
  retryAuditCase,
} from "../api";
import { AuditQueue } from "../components/audit-queue";
import { NewAuditDrawer } from "../components/new-audit-drawer";

export default function AuditCasesList() {
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const casesQuery = useQuery({ queryKey: ["audit-cases"], queryFn: getAuditCases });

  const settle = () => queryClient.invalidateQueries({ queryKey: ["audit-cases"] });

  const createMutation = useMutation({
    mutationFn: createAuditCase,
    onSuccess: ({ id }) => {
      setCreateOpen(false);
      void settle();
      void navigate({ to: "/audit-cases/$id", params: { id } });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const uploadMutation = useMutation({
    mutationFn: createAuditCaseFromFile,
    onSuccess: ({ id }) => {
      setCreateOpen(false);
      void settle();
      void navigate({ to: "/audit-cases/$id", params: { id } });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAuditCase,
    onSuccess: async () => {
      await settle();
      message.success("已取消审计");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const retryMutation = useMutation({
    mutationFn: retryAuditCase,
    onSuccess: async () => {
      await settle();
      message.success("已重新排队");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const action =
    cancelMutation.isPending && cancelMutation.variables
      ? { id: cancelMutation.variables, type: "CANCEL" as const }
      : retryMutation.isPending && retryMutation.variables
        ? { id: retryMutation.variables, type: "RETRY" as const }
        : null;

  return (
    <>
      <AuditQueue
        cases={(casesQuery.data ?? []) as never}
        loading={casesQuery.isLoading}
        refreshing={casesQuery.isFetching && !casesQuery.isLoading}
        error={casesQuery.error as Error | null}
        action={action}
        onOpen={(id) => void navigate({ to: "/audit-cases/$id", params: { id } })}
        onRefresh={() => void casesQuery.refetch()}
        onCancel={(id) => cancelMutation.mutate(id)}
        onRetry={(id) => retryMutation.mutate(id)}
        onCreate={() => setCreateOpen(true)}
      />
      <NewAuditDrawer
        open={createOpen}
        submitting={createMutation.isPending || uploadMutation.isPending}
        submitError={
          createMutation.isError
            ? createMutation.error.message
            : uploadMutation.isError
              ? uploadMutation.error.message
              : null
        }
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        onUploadFile={(input) => uploadMutation.mutate(input)}
      />
    </>
  );
}
