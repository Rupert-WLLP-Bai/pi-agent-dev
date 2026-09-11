import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Divider, List, Space, Spin, Tag, Typography, message } from "antd";
import { getAuditCase, submitReview } from "../api";
import type { AuditCaseStatus, AuditStage, FindingRevision, Severity } from "@contract-audit/audit/model";

const statusColors: Record<AuditCaseStatus, string> = {
  PENDING: "blue", RUNNING: "orange", COMPLETED: "green", FAILED: "red", CANCELLED: "default", INTERRUPTED: "purple",
};
const stageColors: Record<AuditStage, string> = {
  QUEUED: "blue", NORMALIZING: "cyan", RULE_ASSESSMENT: "cyan", AGENT_RUNNING: "orange", AWAITING_REVIEW: "cyan", COMPLETED: "green", FAILED: "red", CANCELLED: "default", INTERRUPTED: "purple",
};
const severityColors: Record<Severity, string> = { LOW: "blue", MEDIUM: "orange", HIGH: "red" };

const displayColor = (status: AuditCaseStatus, stage: AuditStage): string =>
  (stageColors[stage] ?? statusColors[status] ?? "default");

export default function AuditCaseDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) });
  useEffect(() => {
    const events = new EventSource(`/api/audit-cases/${encodeURIComponent(id)}/events`);
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["audit-case", id] }); };
    events.onmessage = refresh;
    events.onerror = refresh;
    return () => events.close();
  }, [id, queryClient]);

  const reviewMutation = useMutation({
    mutationFn: ({ findingId, decision }: { findingId: string; decision: "ACCEPTED" | "REJECTED" }) => submitReview(findingId, decision),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["audit-case", id] }); },
    onError: (error: Error) => message.error(error.message),
  });
  if (detailQuery.isLoading) return <main style={{ padding: 32, textAlign: "center" }}><Spin /></main>;
  if (detailQuery.isError || !detailQuery.data) return <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}><Alert type="error" message="无法加载审计详情" description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined} /></main>;

  const { case: auditCase, snapshot, findings } = detailQuery.data;
  const assessment = snapshot.ruleAssessment;
  const displayStatus: AuditCaseStatus | AuditStage = auditCase.stage === "AWAITING_REVIEW" || auditCase.stage === "COMPLETED" ? auditCase.stage : auditCase.status;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card title="审计详情" extra={<Tag color={displayColor(auditCase.status, auditCase.stage)}>{displayStatus}</Tag>}>
          <Descriptions column={2}>
            <Descriptions.Item label="审计 ID">{auditCase.id}</Descriptions.Item>
            <Descriptions.Item label="当前阶段">{auditCase.stage}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(auditCase.createdAt).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        </Card>
        <Card title="制度规则评估">
          <Space direction="vertical">
            <Typography.Text>结论：<Tag color={assessment.disposition === "POLICY_CONFLICT" ? "red" : "green"}>{assessment.disposition}</Tag></Typography.Text>
            {assessment.disposition === "POLICY_CONFLICT" && <Typography.Text strong>预付款比例高于制度上限</Typography.Text>}
            <Typography.Text>预付款比例：{formatRatio(snapshot.facts.advancePaymentRatio)}</Typography.Text>
            <Typography.Text>制度上限：{formatRatio(snapshot.facts.policyLimitRatio)}</Typography.Text>
          </Space>
        </Card>
        <Card title="证据定位">
          <List dataSource={snapshot.evidence} locale={{ emptyText: "暂无证据" }} renderItem={(evidence) => <List.Item><Space direction="vertical"><Typography.Text>{evidence.quotedText}</Typography.Text><Typography.Text type="secondary">证据：{evidence.id}（区块 {evidence.blockId}）</Typography.Text></Space></List.Item>} />
        </Card>
        <Card title={`审计发现（${findings.length}）`}>
          <List dataSource={findings} locale={{ emptyText: "暂无发现" }} renderItem={(finding: FindingRevision) => <FindingItem finding={finding} reviewing={reviewMutation.isPending} onReview={(decision) => reviewMutation.mutate({ findingId: finding.id, decision })} />} />
        </Card>
      </Space>
    </main>
  );
}

function formatRatio(ratio: number) {
  return `${(ratio * 100).toFixed(0)}%`;
}

function FindingItem({ finding, reviewing, onReview }: { finding: FindingRevision; reviewing: boolean; onReview: (decision: "ACCEPTED" | "REJECTED") => void }) {
  const { proposal, review } = finding;
  return <List.Item><Space direction="vertical" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{proposal.findingType} <Tag color={severityColors[proposal.severity]}>{proposal.severity}</Tag></Typography.Title>
    <Typography.Paragraph>{proposal.rationale}</Typography.Paragraph>
    <Typography.Text>整改建议：{proposal.remediation}</Typography.Text>
    <Divider style={{ margin: "8px 0" }} />
    {review ? <Typography.Text strong>{review.decision === "ACCEPTED" ? "已接受" : "已驳回"}</Typography.Text> : <Space><Button type="primary" loading={reviewing} onClick={() => onReview("ACCEPTED")}>接受</Button><Button danger loading={reviewing} onClick={() => onReview("REJECTED")}>驳回</Button></Space>}
  </Space></List.Item>;
}
