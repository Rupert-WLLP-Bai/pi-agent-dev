import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Result, Skeleton } from "antd";
import { useState } from "react";
import {
  getValidationRun,
  listRules,
  listValidationCases,
  listValidationRuns,
  runValidation,
} from "../api";
import { ValidationCenter } from "../components/validation-center";
import { readOperator } from "../operator";

/**
 * 案例验证. Owns data access and the run mutation; `ValidationCenter` renders it.
 * A run validates the rule's open draft when one exists, otherwise the
 * published parameters — the same resolution the server applies, so "which
 * version did this run measure" is answerable from the run history.
 */
export default function ValidationPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [pickedRuleId, setPickedRuleId] = useState<string | null>(null);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);

  const rulesQuery = useQuery({ queryKey: ["rules"], queryFn: listRules });
  const rules = rulesQuery.data ?? [];
  const selectedRuleId = pickedRuleId ?? rules[0]?.id ?? null;
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;

  const casesQuery = useQuery({
    queryKey: ["validation-cases", selectedRule?.code ?? null],
    queryFn: () => listValidationCases({ ruleCode: selectedRule?.code }),
    enabled: selectedRule !== null,
  });

  const runsQuery = useQuery({
    queryKey: ["validation-runs", selectedRuleId],
    queryFn: () => listValidationRuns(selectedRuleId ?? undefined),
    enabled: selectedRuleId !== null,
  });
  const runs = runsQuery.data ?? [];
  const latestRun = runs[0] ?? null;
  // A run picked by the operator sticks only while it belongs to this rule;
  // otherwise the view follows the newest run.
  const activeRunId =
    pickedRunId !== null && runs.some((run) => run.id === pickedRunId)
      ? pickedRunId
      : (latestRun?.id ?? null);

  const detailQuery = useQuery({
    queryKey: ["validation-run", activeRunId],
    queryFn: () => {
      if (activeRunId === null) throw new Error("没有可加载的验证运行");
      return getValidationRun(activeRunId);
    },
    enabled: activeRunId !== null,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      runValidation({ ruleId: selectedRuleId ?? undefined, triggeredBy: readOperator() }),
    onSuccess: async (batch) => {
      const first = batch.runs[0];
      if (first) setPickedRunId(first.id);
      if (first) {
        message.success(
          first.status === "passed" ? "验证通过" : `验证未通过：${first.summary.failed} 例失败`,
        );
      } else {
        message.warning("没有可运行的规则版本");
      }
      const skipped = batch.skipped;
      if (skipped.length > 0) {
        message.warning(
          `已跳过：${skipped.map((item) => item.ruleName).join("、")}（${skipped[0].reason}）`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["validation-cases"] }),
        queryClient.invalidateQueries({ queryKey: ["validation-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["rules"] }),
        queryClient.invalidateQueries({ queryKey: ["rule"] }),
      ]);
    },
    onError: (error: Error) => message.error(error.message),
  });

  if (rulesQuery.isLoading) {
    return (
      <div className="page">
        <Skeleton active />
      </div>
    );
  }

  if (rulesQuery.isError) {
    return (
      <div className="page">
        <Result status="error" title="无法加载规则" subTitle={rulesQuery.error.message} />
      </div>
    );
  }

  return (
    <ValidationCenter
      rules={rules}
      selectedRuleId={selectedRuleId}
      onSelectRule={(id) => {
        setPickedRuleId(id);
        setPickedRunId(null);
      }}
      cases={casesQuery.data ?? []}
      latestRun={latestRun}
      runDetail={detailQuery.data ?? null}
      loading={casesQuery.isLoading || runsQuery.isLoading}
      detailLoading={detailQuery.isLoading}
      running={runMutation.isPending}
      error={casesQuery.error ?? runsQuery.error ?? detailQuery.error ?? null}
      onRun={() => runMutation.mutate()}
    />
  );
}
