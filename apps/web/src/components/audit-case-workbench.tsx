import { ArrowLeftOutlined, CopyOutlined } from "@ant-design/icons";
import type {
  AuditCase,
  ContractDocument,
  ContractParty,
  EvidenceLocator,
  FindingRevision,
  PaymentFacts,
  ReviewDecision,
  RuleAssessment,
  Severity,
  SubjectVerification,
} from "@contract-audit/audit/model";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Empty,
  Popconfirm,
  Radio,
  Result,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type EvidenceSourceGroup,
  evidenceSourceGroupLabels,
  evidenceSourceGroupOrder,
  findingTypeLabels,
  getAuditStageLabel,
  getAuditStep,
  getRuleCodeLabel,
  getRuleDispositionLabel,
  getSubjectDimensionSeverityLabel,
  getSubjectStatusLabel,
  severityLabels,
  shortAuditId,
  summarizeRuleOutcome,
} from "../audit-presentation";
import type { AuditConnectionState } from "../hooks/use-audit-events";
import { AuditStateBadge } from "./audit-state-badge";

export interface AuditCaseDetailData {
  case: AuditCase;
  snapshot: {
    facts: PaymentFacts;
    parties: ContractParty[];
    document: ContractDocument;
  };
  evidence: EvidenceLocator[];
  ruleAssessments: RuleAssessment[];
  subjectVerifications: SubjectVerification[];
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

const severityColors: Record<Severity, string> = {
  LOW: "green",
  MEDIUM: "orange",
  HIGH: "red",
};

const decisionLabels: Record<ReviewDecision, string> = {
  ACCEPTED: "已确认风险",
  REJECTED: "已判定误报",
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

const dispositionColors: Record<RuleAssessment["disposition"], string> = {
  POLICY_CONFLICT: "red",
  COMPLIANT: "green",
  NEEDS_HUMAN_REVIEW: "orange",
};

/** The payment rule's policy input is a synthetic document span, not contract text. */
const POLICY_INPUT_EVIDENCE_ID = "policy-limit";

/** The document block a locator points at, or null when it anchors an external record. */
const documentBlockId = (locator: EvidenceLocator): string | null =>
  locator.location.kind === "DOCUMENT_SPAN" ? locator.location.blockId : null;

const evidenceGroupFor = (locator: EvidenceLocator): EvidenceSourceGroup => {
  if (locator.location.kind === "EXTERNAL_RECORD") return "EXTERNAL";
  return locator.id === POLICY_INPUT_EVIDENCE_ID ? "POLICY" : "CONTRACT";
};

const isStale = (expiresAt: string | null): boolean =>
  expiresAt !== null && Date.parse(expiresAt) < Date.now();

/* ── Document rendering ─────────────────────── */

function isHeading(text: string): boolean {
  return (
    /^第[一二三四五六七八九十]+[章节条]/.test(text.trim()) ||
    (text.trim().startsWith("甲方") && text.trim().endsWith("乙方"))
  );
}

function renderDocumentBlocks(
  document: ContractDocument,
  selectedBlockId: string | null,
  problemBlockIds: Set<string>,
) {
  return document.blocks.map((block) => {
    const isHeadingBlock = isHeading(block.text);
    const isSelected = selectedBlockId === block.blockId;
    const hasProblem = problemBlockIds.has(block.blockId);
    const className = `document-block ${isHeadingBlock ? "heading" : ""} ${isSelected ? "selected" : ""} ${hasProblem ? "has-problem" : ""}`;
    return (
      <div key={block.blockId} className={className} data-block-id={block.blockId}>
        {block.text}
      </div>
    );
  });
}

/* ── Finding list item ──────────────────────── */

function FindingListItem({
  finding,
  active,
  onClick,
}: {
  finding: FindingRevision;
  active: boolean;
  onClick: () => void;
}) {
  const sev = finding.proposal.severity;
  const reviewed = finding.review !== null;
  return (
    <button type="button" className={`finding-item ${active ? "active" : ""}`} onClick={onClick}>
      <div className="f-top">
        <span className={`sev-badge ${sev.toLowerCase()}`}>{severityLabels[sev]}</span>
        {reviewed && finding.review ? (
          <Tag
            color={finding.review.decision === "ACCEPTED" ? "red" : "green"}
            style={{ fontSize: 10, margin: 0 }}
          >
            {decisionLabels[finding.review.decision]}
          </Tag>
        ) : (
          <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>
            待复核
          </Tag>
        )}
      </div>
      <div className="f-title">{findingTypeLabels[finding.proposal.findingType]}</div>
      <div className="f-loc">证据 {finding.proposal.evidenceIds.length} 条</div>
    </button>
  );
}

/* ── Subject verification item ──────────────── */

function SubjectVerificationItem({
  party,
  verification,
  onConfirm,
}: {
  party: ContractParty;
  verification: SubjectVerification | undefined;
  onConfirm: () => void;
}) {
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const status = verification?.status ?? null;
  const matched = verification?.status === "RESOLVED" ? verification.matched : null;
  // Only a settled subject may show risk counts: a factor reported against a
  // name we could not resolve says nothing about this contract's counterparty.
  const settledDimensions = verification?.status === "RESOLVED" ? verification.dimensions : [];
  const redLineCount = settledDimensions.filter(
    (dimension) => dimension.severity === "RED_LINE" && dimension.count > 0,
  ).length;
  const backgroundCount = settledDimensions.filter(
    (dimension) => dimension.severity === "BACKGROUND" && dimension.count > 0,
  ).length;
  const statusColor =
    status === "RESOLVED"
      ? "green"
      : status === "AMBIGUOUS"
        ? "orange"
        : status === "UNRESOLVED"
          ? "red"
          : "default";

  return (
    <div className="subject-item">
      <div className="subject-head">
        <b>
          {party.label} · {party.name}
        </b>
        <Tag color={statusColor} style={{ fontSize: 10, margin: 0 }}>
          {getSubjectStatusLabel(status)}
        </Tag>
      </div>

      {matched && (
        <div className="subject-meta">
          <span>
            主体 <b>{matched.name}</b>
          </span>
          <span>
            统一社会信用代码 <span className="mono">{matched.unifiedSocialCreditCode}</span>
          </span>
          <span>登记状态 {matched.registrationStatus}</span>
        </div>
      )}

      {(redLineCount > 0 || backgroundCount > 0) && (
        <div className="subject-dims">
          {redLineCount > 0 && (
            <Tag color="red" style={{ fontSize: 10, margin: 0 }}>
              {getSubjectDimensionSeverityLabel("RED_LINE")} {redLineCount} 项
            </Tag>
          )}
          {backgroundCount > 0 && (
            <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>
              {getSubjectDimensionSeverityLabel("BACKGROUND")} {backgroundCount} 项
            </Tag>
          )}
        </div>
      )}

      {verification?.status === "AMBIGUOUS" && verification.candidates.length > 0 && (
        <div className="subject-candidates">
          <Radio.Group
            value={selectedCandidate}
            onChange={(event) => setSelectedCandidate(event.target.value as string)}
          >
            {verification.candidates.map((candidate) => (
              <Radio
                key={`${candidate.name}-${candidate.unifiedSocialCreditCode}`}
                value={candidate.unifiedSocialCreditCode}
              >
                <span className="subject-candidate-name">{candidate.name}</span>
                <span className="mono subject-candidate-uscc">
                  {candidate.unifiedSocialCreditCode}
                </span>
                <span className="subject-candidate-reg">{candidate.registrationStatus}</span>
              </Radio>
            ))}
          </Radio.Group>
          <Button
            size="small"
            type="primary"
            disabled={selectedCandidate === null}
            onClick={onConfirm}
          >
            确认主体
          </Button>
        </div>
      )}

      {verification?.status === "UNAVAILABLE" && (
        <div className="subject-failure">
          <Tag color="default" style={{ fontSize: 10, margin: 0 }}>
            能力降级
          </Tag>
          <span>{verification.failureReason ?? "核验来源不可用"}</span>
        </div>
      )}
    </div>
  );
}

/* ── Inspector panel ────────────────────────── */

function InspectorPanel({
  finding,
  facts,
  ruleAssessments,
  parties,
  subjectVerifications,
  evidence,
  onOpenReview,
}: {
  finding: FindingRevision;
  facts: PaymentFacts;
  ruleAssessments: RuleAssessment[];
  parties: ContractParty[];
  subjectVerifications: SubjectVerification[];
  evidence: EvidenceLocator[];
  onOpenReview: (decision: "ACCEPTED" | "REJECTED") => void;
}) {
  const { message } = AntApp.useApp();
  const { proposal, review } = finding;
  const citedEvidence = evidence.filter((e) => proposal.evidenceIds.includes(e.id));
  const ratioPct = Math.round(facts.advancePaymentRatio * 100);
  const limitPct = Math.round(facts.policyLimitRatio * 100);
  const diffPct = ratioPct - limitPct;

  // Subject confirmation requires a human decision, so the action only explains
  // what is missing instead of calling an API that does not exist yet.
  const confirmSubject = () => {
    message.info("候选主体需人工确认，请审核人员选定主体后重新发起核验。");
  };

  return (
    <>
      <div className="inspector-body">
        <div className="inspector-title">
          <h3>{findingTypeLabels[proposal.findingType]}</h3>
          <Tag color={severityColors[proposal.severity]}>{severityLabels[proposal.severity]}</Tag>
        </div>

        <div className="facts-grid">
          <div className="fact-cell bad">
            <span>合同实际值</span>
            <b className="tnum">{ratioPct}%</b>
          </div>
          <div className="fact-cell ref">
            <span>制度上限</span>
            <b className="tnum">{limitPct}%</b>
          </div>
          <div className="fact-cell">
            <span>超出</span>
            <b className="tnum">{diffPct > 0 ? `+${diffPct}` : diffPct}pp</b>
          </div>
        </div>

        <div className="inspect-section">
          <h4>判断依据</h4>
          <Typography.Paragraph style={{ fontSize: 11.5, margin: 0, color: "#4E5969" }}>
            {proposal.rationale}
          </Typography.Paragraph>
        </div>

        <div className="inspect-section">
          <h4>违反规则 ({ruleAssessments.length})</h4>
          {ruleAssessments.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              暂无规则评估
            </Typography.Text>
          ) : (
            ruleAssessments.map((assessment) => (
              <div key={assessment.id} className="rule-card">
                <div className="row">
                  <b>{getRuleCodeLabel(assessment.ruleCode)}</b>
                  <Tag
                    color={dispositionColors[assessment.disposition]}
                    style={{ fontSize: 10, margin: 0 }}
                  >
                    {getRuleDispositionLabel(assessment.disposition)}
                  </Tag>
                </div>
                <small>规则代码 · {assessment.ruleCode}</small>
                <p className="rule-basis">{assessment.basis}</p>
              </div>
            ))
          )}
        </div>

        <div className="inspect-section">
          <h4>主体核验 ({parties.length})</h4>
          {parties.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              未识别到合同当事人
            </Typography.Text>
          ) : (
            <div className="subject-panel">
              {parties.map((party) => (
                <SubjectVerificationItem
                  key={party.id}
                  party={party}
                  verification={subjectVerifications.find((item) => item.partyId === party.id)}
                  onConfirm={confirmSubject}
                />
              ))}
            </div>
          )}
        </div>

        <div className="inspect-section">
          <h4>证据来源 ({citedEvidence.length})</h4>
          {citedEvidence.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              暂无关联证据
            </Typography.Text>
          ) : (
            evidenceSourceGroupOrder.map((group) => {
              const items = citedEvidence.filter((locator) => evidenceGroupFor(locator) === group);
              return (
                <div key={group} className="source-group">
                  <div className="source-group-head">
                    <b>{evidenceSourceGroupLabels[group]}</b>
                    <span className="source-count">{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <div className="source-empty">—</div>
                  ) : (
                    items.map((locator) => (
                      <div key={locator.id} className="source-item">
                        {locator.location.kind === "EXTERNAL_RECORD" ? (
                          <>
                            <strong>
                              {shortAuditId(locator.id)} · {locator.location.recordType}
                            </strong>
                            <div className="source-meta">
                              <span>提供方 {locator.location.provider}</span>
                              <span>主体 {locator.location.subject}</span>
                              <span>采集 {formatTime(locator.location.capturedAt)}</span>
                              <span>
                                有效期至{" "}
                                {locator.location.expiresAt
                                  ? formatTime(locator.location.expiresAt)
                                  : "长期"}
                              </span>
                              {isStale(locator.location.expiresAt) && (
                                <span className="stale-badge">已过期</span>
                              )}
                            </div>
                            <div className="source-meta">
                              <span>来源记录 · {locator.sourceRecordId.slice(0, 8)}…</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <strong>
                              {shortAuditId(locator.id)} · 区块 {locator.location.blockId}
                            </strong>
                            <div className="source-quote">
                              {locator.location.quotedText.slice(0, 60)}…
                            </div>
                            <div className="source-meta">
                              <span>来源记录 · {locator.sourceRecordId.slice(0, 8)}…</span>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="inspect-section">
          <h4>修复建议</h4>
          <div className="recommendation">{proposal.remediation}</div>
        </div>
      </div>

      {review === null ? (
        <div className="inspector-actions">
          <Button danger onClick={() => onOpenReview("REJECTED")}>
            判定误报
          </Button>
          <Button type="primary" onClick={() => onOpenReview("ACCEPTED")}>
            确认风险
          </Button>
        </div>
      ) : (
        <div className="inspector-actions" style={{ justifyContent: "flex-start" }}>
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: "decision", label: "复核结论", children: decisionLabels[review.decision] },
              ...(review.reason ? [{ key: "reason", label: "理由", children: review.reason }] : []),
              { key: "reviewer", label: "复核人", children: review.reviewerId },
              { key: "time", label: "时间", children: formatTime(review.reviewedAt) },
            ]}
          />
        </div>
      )}
    </>
  );
}

/* ── Main workbench ─────────────────────────── */

export function AuditCaseWorkbench({
  detail,
  connection,
  action,
  onOpenReview,
  onCancel,
  onRetry,
  onBack,
}: AuditCaseWorkbenchProps) {
  const {
    case: auditCase,
    snapshot,
    evidence,
    ruleAssessments,
    subjectVerifications,
    findings,
  } = detail;
  const stage = auditCase.stage;
  const failed = stage === "FAILED" || stage === "CANCELLED" || stage === "INTERRUPTED";
  const awaitingReview = stage === "AWAITING_REVIEW";
  const completed = stage === "COMPLETED";
  const running = !failed && !awaitingReview && !completed;

  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const documentRef = useRef<HTMLDivElement>(null);

  const problemBlockIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of findings) {
      for (const eid of f.proposal.evidenceIds) {
        const loc = evidence.find((e) => e.id === eid);
        const blockId = loc ? documentBlockId(loc) : null;
        if (blockId !== null) ids.add(blockId);
      }
    }
    return ids;
  }, [findings, evidence]);

  const selectedFinding = findings[selectedFindingIndex] ?? null;
  const selectedBlockId = useMemo(() => {
    if (!selectedFinding) return null;
    const firstEvidence = selectedFinding.proposal.evidenceIds
      .map((eid) => evidence.find((e) => e.id === eid))
      .find((e) => e !== undefined);
    return firstEvidence ? documentBlockId(firstEvidence) : null;
  }, [selectedFinding, evidence]);

  useEffect(() => {
    if (!selectedBlockId || !documentRef.current) return;
    const el = documentRef.current.querySelector(`[data-block-id="${selectedBlockId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedBlockId]);

  const showReview = (awaitingReview || completed) && findings.length > 0;
  const contractTitle = snapshot.document.blocks[0]?.text ?? "未命名合同";

  return (
    <article className="review-page">
      <div className="case-banner">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeftOutlined /> 返回审计队列
        </button>
        <div className="case-title-row">
          <h2>{contractTitle}</h2>
          <div className="case-status">
            <AuditStateBadge auditCase={auditCase} />
            <Tag
              color={
                connection === "connected" ? "blue" : connection === "closed" ? "default" : "orange"
              }
              style={{ fontSize: 11 }}
            >
              {connectionLabels[connection]}
            </Tag>
          </div>
        </div>
        <div className="case-meta">
          <span>
            审计 ID <b className="mono">{shortAuditId(auditCase.id)}</b>
            <Tooltip title="复制审计 ID">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => void navigator.clipboard.writeText(auditCase.id)}
              />
            </Tooltip>
          </span>
          <span>
            来源记录 <b className="mono">{auditCase.sourceRecordId.slice(0, 8)}…</b>
          </span>
          <span>
            创建时间 <b>{formatTime(auditCase.createdAt)}</b>
          </span>
          <span>
            更新时间 <b>{formatTime(auditCase.updatedAt)}</b>
          </span>
        </div>
        <div className="case-steps">
          <Steps
            size="small"
            current={getAuditStep(auditCase)}
            status={failed ? "error" : undefined}
            items={stepItems}
          />
        </div>
      </div>

      {running && (
        <div className="workbench-panel">
          <Alert
            type="info"
            showIcon
            message={`审计进行中 · 当前阶段：${getAuditStageLabel(stage)}`}
            description="完成后将进入人工复核。"
            style={{ flex: 1 }}
          />
          <Popconfirm
            title="取消该审计案件？"
            description="已完成的审计工作不会回滚。"
            okText="确认取消"
            cancelText="返回"
            okButtonProps={{ danger: true }}
            onConfirm={onCancel}
          >
            <Button danger loading={action?.type === "CANCEL"}>
              取消审计
            </Button>
          </Popconfirm>
        </div>
      )}

      {failed && (
        <div className="workbench-panel">
          <Result
            status={stage === "CANCELLED" ? "warning" : "error"}
            title={stage === "CANCELLED" ? "审计已取消" : "审计未完成"}
            subTitle={`当前状态：${getAuditStageLabel(stage)}。可重试重新执行。`}
            extra={
              <Popconfirm
                title="重试该审计案件？"
                description="将重新排队并从头执行审计。"
                okText="确认重试"
                cancelText="返回"
                onConfirm={onRetry}
              >
                <Button type="primary" loading={action?.type === "RETRY"}>
                  重试审计
                </Button>
              </Popconfirm>
            }
          />
        </div>
      )}

      {showReview && (
        <div className="review-workspace">
          {/* Left: finding navigation */}
          <aside className="finding-nav">
            <div className="pane-head">
              <b>风险发现</b>
              <span style={{ fontSize: 10, color: "#667085" }}>{findings.length} 项</span>
            </div>
            <div className="count-tabs">
              <span className="active">
                待处理 {findings.filter((f) => f.review === null).length}
              </span>
              <span>全部 {findings.length}</span>
            </div>
            <div className="finding-list">
              {findings.map((finding, index) => (
                <FindingListItem
                  key={finding.id}
                  finding={finding}
                  active={index === selectedFindingIndex}
                  onClick={() => setSelectedFindingIndex(index)}
                />
              ))}
            </div>
            <div className="coverage">
              <span>审查覆盖</span>
              <span>
                <b>{summarizeRuleOutcome(ruleAssessments)}</b>
              </span>
            </div>
          </aside>

          {/* Center: contract document */}
          <main className="document-stage" ref={documentRef}>
            <div className="document-page">
              <h1>{contractTitle}</h1>
              <div className="doc-no">
                合同版本 · 区块 {snapshot.document.blocks[0]?.blockId ?? "—"}
              </div>
              {renderDocumentBlocks(snapshot.document, selectedBlockId, problemBlockIds)}
            </div>
          </main>

          {/* Right: inspector */}
          <aside className="inspector">
            <div className="pane-head">
              <b>依据与复核</b>
              <span style={{ fontSize: 10, color: "#667085" }}>
                发现 {selectedFindingIndex + 1}/{findings.length}
              </span>
            </div>
            {selectedFinding ? (
              <InspectorPanel
                finding={selectedFinding}
                facts={snapshot.facts}
                ruleAssessments={ruleAssessments}
                parties={snapshot.parties}
                subjectVerifications={subjectVerifications}
                evidence={evidence}
                onOpenReview={onOpenReview}
              />
            ) : (
              <div className="inspector-body">
                <Empty description="暂无审计发现" />
              </div>
            )}
          </aside>
        </div>
      )}

      {!showReview && !running && !failed && (
        <div className="workbench-empty">
          <Empty description="等待审计完成" />
        </div>
      )}
    </article>
  );
}
