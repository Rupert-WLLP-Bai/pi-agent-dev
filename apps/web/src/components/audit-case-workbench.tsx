import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Popconfirm,
  Result,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
  AuditCase,
  EvidenceLocator,
  FindingRevision,
  FindingType,
  PaymentFacts,
  ReviewDecision,
  RuleAssessment,
  Severity,
} from "@contract-audit/audit/model";
import { getAuditStageLabel, getAuditStep, shortAuditId } from "../audit-presentation";
import type { AuditConnectionState } from "../hooks/use-audit-events";
import { AuditStateBadge } from "./audit-state-badge";

export interface AuditCaseDetailData {
  case: AuditCase;
  snapshot: {
    facts: PaymentFacts;
    evidence: EvidenceLocator[];
    ruleAssessment: RuleAssessment;
  };
  findings: FindingRevision[];
}

export interface AuditCaseWorkbenchProps {
  detail: AuditCaseDetailData;
  connection: AuditConnectionState;
  action: { type: "CANCEL" | "RETRY" } | null;
  onOpenReview: (decision: "ACCEPTED" | "REJECTED") => void;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}

const connectionLabels: Record<AuditConnectionState, string> = {
  connecting: "正在连接",
  connected: "实时更新",
  reconnecting: "正在重连",
  closed: "已断开",
};

const findingTypeLabels: Record<FindingType, string> = {
  ADVANCE_PAYMENT_POLICY_CONFLICT: "预付款比例超过制度上限",
  NEEDS_HUMAN_REVIEW: "需要人工复核",
};

const severityLabels: Record<Severity, string> = {
  LOW: "低风险",
  MEDIUM: "中风险",
  HIGH: "高风险",
};

const severityColors: Record<Severity, string> = {
  LOW: "blue",
  MEDIUM: "orange",
  HIGH: "red",
};

const decisionLabels: Record<ReviewDecision, string> = {
  ACCEPTED: "已接受",
  REJECTED: "已驳回",
};

const stepItems = [
  { title: "已创建" },
  { title: "规则评估" },
  { title: "Agent 分析" },
  { title: "人工复核" },
  { title: "已完成" },
];

const formatTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

const formatRatio = (ratio: number): string => `${(ratio * 100).toFixed(0)}%`;

function FactComparison({ facts }: { facts: PaymentFacts }) {
  return (
    <dl className="fact-compare">
      <div className="fact-compare__cell">
        <dt>预付款比例</dt>
        <dd>{formatRatio(facts.advancePaymentRatio)}</dd>
      </div>
      <div className="fact-compare__cell">
        <dt>制度上限</dt>
        <dd>{formatRatio(facts.policyLimitRatio)}</dd>
      </div>
    </dl>
  );
}

function RuleAssessmentPanel({ assessment }: { assessment: RuleAssessment }) {
  return (
    <section className="context-card">
      <Typography.Title level={4} className="context-card__title">规则评估</Typography.Title>
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: "rule",
            label: "规则",
            children: assessment.ruleCode === "ADVANCE_PAYMENT_LIMIT"
              ? "预付款上限规则"
              : assessment.ruleCode,
          },
          {
            key: "disposition",
            label: "结论",
            children: assessment.disposition === "POLICY_CONFLICT" ? "存在制度冲突" : "符合制度",
          },
        ]}
      />
    </section>
  );
}

function EvidencePanel({
  citedIds,
  evidence,
}: {
  citedIds: string[];
  evidence: EvidenceLocator[];
}) {
  return (
    <section className="context-card">
      <Typography.Title level={4} className="context-card__title">证据定位</Typography.Title>
      {citedIds.length === 0 ? (
        <Typography.Text type="secondary">暂无关联证据</Typography.Text>
      ) : (
        <ul className="evidence-list">
          {citedIds.map((citingId) => {
            const locator = evidence.find((item) => item.id === citingId);
            return (
              <li key={citingId}>
                {locator ? (
                  <blockquote className="evidence-quote">
                    {locator.quotedText}
                    <cite>证据：{locator.id}（区块 {locator.blockId}）</cite>
                  </blockquote>
                ) : (
                  <Typography.Text type="danger">证据不可用：{citingId}</Typography.Text>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FindingPanel({
  finding,
  facts,
  onOpenReview,
}: {
  finding: FindingRevision;
  facts: PaymentFacts;
  onOpenReview: (decision: "ACCEPTED" | "REJECTED") => void;
}) {
  const { proposal, review } = finding;
  return (
    <section className="finding-panel" aria-label="审计发现">
      <div className="finding-panel__head">
        <Typography.Title level={3} className="finding-panel__title">
          {findingTypeLabels[proposal.findingType]}
        </Typography.Title>
        <Tag color={severityColors[proposal.severity]}>{severityLabels[proposal.severity]}</Tag>
      </div>
      <Typography.Paragraph>{proposal.rationale}</Typography.Paragraph>
      <FactComparison facts={facts} />
      <div className="finding-remediation">
        <Typography.Text strong>整改建议</Typography.Text>
        <Typography.Paragraph>{proposal.remediation}</Typography.Paragraph>
      </div>
      {review === null ? (
        <div className="workbench-actions">
          <Space wrap>
            <Button onClick={() => onOpenReview("ACCEPTED")}>接受建议</Button>
            <Button type="primary" danger onClick={() => onOpenReview("REJECTED")}>驳回建议</Button>
          </Space>
        </div>
      ) : (
        <div className="finding-review">
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: "decision", label: "复核结论", children: decisionLabels[review.decision] },
              ...(review.reason
                ? [{ key: "reason", label: "复核理由", children: review.reason }]
                : []),
              { key: "reviewer", label: "复核人", children: review.reviewerId },
              { key: "reviewed-at", label: "复核时间", children: formatTime(review.reviewedAt) },
            ]}
          />
        </div>
      )}
    </section>
  );
}

export function AuditCaseWorkbench({
  detail,
  connection,
  action,
  onOpenReview,
  onCancel,
  onRetry,
  onBack,
}: AuditCaseWorkbenchProps) {
  const { case: auditCase, snapshot, findings } = detail;
  const stage = auditCase.stage;
  const failed = stage === "FAILED" || stage === "CANCELLED" || stage === "INTERRUPTED";
  const awaitingReview = stage === "AWAITING_REVIEW";
  const completed = stage === "COMPLETED";
  const running = !failed && !awaitingReview && !completed;
  const citedIds = [...new Set(findings.flatMap((finding) => finding.proposal.evidenceIds))];

  return (
    <article className="workbench">
      <header className="workbench-header">
        <Button
          type="link"
          className="workbench-back"
          icon={<ArrowLeftOutlined aria-hidden="true" />}
          onClick={onBack}
        >
          返回审计队列
        </Button>
        <div className="workbench-title-row">
          <Space align="center" wrap>
            <AuditStateBadge auditCase={auditCase} />
            <Typography.Text
              className="workbench-id"
              copyable={{ text: auditCase.id, tooltips: ["复制审计 ID", "已复制"] }}
            >
              {shortAuditId(auditCase.id)}
            </Typography.Text>
          </Space>
          <span
            className={`workbench-connection workbench-connection--${connection}`}
            role="status"
            aria-live="polite"
          >
            {connectionLabels[connection]}
          </span>
        </div>
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 3 }}
          items={[
            { key: "created", label: "创建时间", children: formatTime(auditCase.createdAt) },
            { key: "updated", label: "更新时间", children: formatTime(auditCase.updatedAt) },
            { key: "stage", label: "当前阶段", children: getAuditStageLabel(stage) },
          ]}
        />
        <Steps
          size="small"
          responsive
          current={getAuditStep(auditCase)}
          status={failed ? "error" : undefined}
          items={stepItems}
        />
      </header>

      {running && (
        <section className="workbench-panel" aria-label="审计进度">
          <Alert
            type="info"
            showIcon
            title="审计进行中"
            description={`当前阶段：${getAuditStageLabel(stage)}。完成后将进入人工复核。`}
          />
          <Popconfirm
            title="取消该审计？"
            description="已完成的审计工作不会回滚。"
            okText="确认取消"
            cancelText="返回"
            okButtonProps={{ danger: true }}
            onConfirm={onCancel}
          >
            <Button danger loading={action?.type === "CANCEL"}>取消审计</Button>
          </Popconfirm>
        </section>
      )}

      {failed && (
        <section className="workbench-panel" aria-label="审计异常">
          <Result
            status={stage === "CANCELLED" ? "warning" : "error"}
            title={stage === "CANCELLED" ? "审计已取消" : "审计未完成"}
            subTitle={`当前状态：${getAuditStageLabel(stage)}。可重试重新执行。`}
          />
          <Popconfirm
            title="重试该审计？"
            description="将重新排队并从头执行审计。"
            okText="确认重试"
            cancelText="返回"
            onConfirm={onRetry}
          >
            <Button type="primary" loading={action?.type === "RETRY"}>重试审计</Button>
          </Popconfirm>
        </section>
      )}

      {(awaitingReview || completed) && (
        <div className="workbench-grid">
          <div className="workbench-main">
            {findings.length === 0 ? (
              <Empty description="暂无审计发现" />
            ) : (
              findings.map((finding) => (
                <FindingPanel
                  key={finding.id}
                  finding={finding}
                  facts={snapshot.facts}
                  onOpenReview={onOpenReview}
                />
              ))
            )}
          </div>
          <aside className="workbench-context" aria-label="规则与证据">
            <RuleAssessmentPanel assessment={snapshot.ruleAssessment} />
            <EvidencePanel citedIds={citedIds} evidence={snapshot.evidence} />
          </aside>
        </div>
      )}
    </article>
  );
}
