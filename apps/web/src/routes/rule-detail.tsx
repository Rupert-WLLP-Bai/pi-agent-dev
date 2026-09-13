import type { RuleVersionRecord, ValidationRunRecord } from "@contract-audit/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp, Button, Result, Skeleton, Space, Tag, Typography } from "antd";
import { useState } from "react";
import {
  createRuleVersion,
  getRule,
  publishRule,
  updateRule,
  updateRuleVersion,
  validateRule,
} from "../api";
import { RuleEditor } from "../components/rule-editor";
import type { RuleParams } from "../rule-presentation";

/** The operator the API records as the actor until user accounts exist (P2). */
const OPERATOR = "规则管理员";

/**
 * 规则编辑器. The five zones live in `RuleEditor`; this route owns data access
 * and the mutations. The editor is keyed by the working version so switching
 * draft/published remounts the form rather than carrying stale parameters.
 *
 * §未来拓展: dynamic DSL rules are a documented direction, not implemented —
 * the logic stays deterministic TypeScript reading a versioned parameter set.
 */
export default function RuleDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [validationRun, setValidationRun] = useState<ValidationRunRecord | null>(null);

  const detailQuery = useQuery({ queryKey: ["rule", id], queryFn: () => getRule(id) });
  const detail = detailQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["rule", id] });

  const saveInfoMutation = useMutation({
    mutationFn: (input: { name: string; contractType: string; description: string }) =>
      updateRule(id, input),
    onSuccess: () => {
      void invalidate();
      message.success("基础信息已保存");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const saveDraftMutation = useMutation({
    mutationFn: (input: { params: RuleParams; stances: RuleVersionRecord["stances"] }) =>
      detail?.activeDraft
        ? updateRuleVersion(id, detail.activeDraft.id, input)
        : createRuleVersion(id, input),
    onSuccess: () => {
      void invalidate();
      message.success("草稿已保存");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validateRule(id, OPERATOR),
    onSuccess: (run) => {
      setValidationRun(run);
      void invalidate();
      message.success(
        run.status === "passed" ? "验证通过" : `验证未通过：${run.summary.failed} 例失败`,
      );
    },
    onError: (error: Error) => message.error(error.message),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishRule(id, OPERATOR),
    onSuccess: () => {
      void invalidate();
      message.success("规则已发布");
    },
    onError: (error: Error) => message.error(error.message),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="page">
        <Skeleton active />
      </div>
    );
  }

  if (detailQuery.isError || detail === undefined) {
    return (
      <div className="page">
        <Result
          status="404"
          title="规则不存在"
          subTitle={detailQuery.error?.message}
          extra={
            <Button type="primary" onClick={() => void navigate({ to: "/rules" })}>
              返回规则管理
            </Button>
          }
        />
      </div>
    );
  }

  const workingVersionId = detail.activeDraft?.id ?? detail.versions[0]?.id ?? detail.rule.id;

  return (
    <div className="page">
      <div className="page-head">
        <Space direction="vertical" size={2}>
          <Button type="link" style={{ padding: 0 }} onClick={() => void navigate({ to: "/rules" })}>
            ← 返回规则管理
          </Button>
          <Space align="center" wrap>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {detail.rule.name}
            </Typography.Title>
            <Tag className="mono">{detail.rule.code}</Tag>
            {detail.activeDraft ? (
              <Tag color="warning">草稿 v{detail.activeDraft.version}</Tag>
            ) : (
              <Tag color="success">已发布 v{detail.versions[0]?.version ?? "—"}</Tag>
            )}
          </Space>
          <Typography.Text type="secondary">
            {detail.rule.contractType} · {detail.rule.description || "暂无描述"}
          </Typography.Text>
        </Space>
      </div>

      <RuleEditor
        key={workingVersionId}
        detail={detail}
        validationRun={validationRun}
        savingInfo={saveInfoMutation.isPending}
        savingDraft={saveDraftMutation.isPending}
        validating={validateMutation.isPending}
        publishing={publishMutation.isPending}
        onSaveInfo={(input) => saveInfoMutation.mutate(input)}
        onSaveDraft={(input) => saveDraftMutation.mutate(input)}
        onValidate={() => validateMutation.mutate()}
        onPublish={() => publishMutation.mutate()}
      />
    </div>
  );
}
