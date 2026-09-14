import {
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import type {
  AuditCase,
  ContractDocument,
  ContractParty,
  EvidenceLocator,
  FindingRevision,
  PaymentFacts,
  ReviewDecision,
  RuleAssessment,
  RuleCode,
  Severity,
  SourceProvenance,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { PartyHistoryHit } from "@contract-audit/audit/party-history-rule";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Result,
  Space,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  assessmentsForFinding,
  canDownloadOriginal,
  describeSourceProvenance,
  type EvidenceSourceGroup,
  evidenceSourceGroupLabels,
  evidenceSourceGroupOrder,
  factCellsForFinding,
  findingTypeLabels,
  getAuditStageLabel,
  getAuditStep,
  getRuleCodeLabel,
  getRuleDispositionLabel,
  getSubjectDimensionSeverityLabel,
  getSubjectStatusLabel,
  groupAssessmentsByDisposition,
  severityLabels,
  shortAuditId,
  summarizeRuleCoverage,
  summarizeRuleOutcome,
  visibleFindings,
} from "../audit-presentation";
import type { AuditConnectionState } from "../hooks/use-audit-events";
import { AuditStateBadge } from "./audit-state-badge";

type AuditCaseSnapshotView = {
  facts: PaymentFacts;
  parties: ContractParty[];
  document: ContractDocument;
};

export interface AuditCaseDetailData {
  case: AuditCase;
  snapshot: AuditCaseSnapshotView | null;
  evidence: EvidenceLocator[];
  ruleAssessments: RuleAssessment[];
  subjectVerifications: SubjectVerification[];
  partyHistory: PartyHistoryHit[];
  findings: FindingRevision[];
  sourceProvenance?: SourceProvenance | null;
  originalDownloadable?: boolean;
  originalStorage?: "s3" | "local" | null;
}

export interface AuditCaseWorkbenchProps {
  detail: AuditCaseDetailData & { snapshot: AuditCaseSnapshotView };
  connection: AuditConnectionState;
  action: { type: "CANCEL" | "RETRY" | "REASSESS" } | null;
  onOpenReview: (decision: "ACCEPTED" | "REJECTED", finding: FindingRevision) => void;
  onCancel: () => void;
  /** Reruns the agent against the snapshot the case already holds. */
  onRetry: () => void;
  /** Rebuilds the snapshot from the current published rules, then reruns. */
  onReassess: () => void;
  onBack: () => void;
  /** Text on the back control; follows the entry point (review centre vs queue). */
  backLabel?: string;
  onOpenTrace: () => void;
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

const dayLabel = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return "";
};

const dispositionColors: Record<RuleAssessment["disposition"], string> = {
  POLICY_CONFLICT: "red",
  COMPLIANT: "green",
  NEEDS_HUMAN_REVIEW: "orange",
};

/** Legacy snapshots stored the payment limit as a fake document span with this id. */
const POLICY_INPUT_EVIDENCE_ID = "policy-limit";

/** The document block a locator points at, or null when it anchors outside the IR. */
const documentBlockId = (locator: EvidenceLocator): string | null =>
  locator.location.kind === "DOCUMENT_SPAN" ? locator.location.blockId : null;

const evidenceGroupFor = (locator: EvidenceLocator): EvidenceSourceGroup => {
  if (locator.location.kind === "EXTERNAL_RECORD") return "EXTERNAL";
  if (locator.location.kind === "PRIOR_CASE_RECORD") return "HISTORY";
  if (locator.location.kind === "POLICY_PARAMETER") return "POLICY";
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
}: {
  party: ContractParty;
  verification: SubjectVerification | undefined;
}) {
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
          <ul className="subject-candidate-list">
            {verification.candidates.map((candidate) => (
              <li key={`${candidate.name}-${candidate.unifiedSocialCreditCode}`}>
                <span className="subject-candidate-name">{candidate.name}</span>
                <span className="mono subject-candidate-uscc">
                  {candidate.unifiedSocialCreditCode}
                </span>
                <span className="subject-candidate-reg">{candidate.registrationStatus}</span>
              </li>
            ))}
          </ul>
          <div className="subject-note">本版不写入核验结果</div>
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
  partyHistory,
  evidence,
  onOpenReview,
  onFocusBlock,
}: {
  finding: FindingRevision;
  facts: PaymentFacts;
  ruleAssessments: RuleAssessment[];
  parties: ContractParty[];
  subjectVerifications: SubjectVerification[];
  partyHistory: PartyHistoryHit[];
  evidence: EvidenceLocator[];
  onOpenReview: (decision: "ACCEPTED" | "REJECTED", finding: FindingRevision) => void;
  onFocusBlock: (blockId: string) => void;
}) {
  const { proposal, review } = finding;
  const citedEvidence = evidence.filter((e) => proposal.evidenceIds.includes(e.id));
  // Only ratio findings have a fact pair to show; every other finding skips the grid.
  const factCells = factCellsForFinding(proposal.findingType, facts);

  return (
    <>
      <div className="inspector-body">
        <div className="inspector-title">
          <h3>{findingTypeLabels[proposal.findingType]}</h3>
          <Tag color={severityColors[proposal.severity]}>{severityLabels[proposal.severity]}</Tag>
        </div>

        {factCells && (
          <div className="facts-grid">
            {factCells.map((cell) => (
              <div
                key={cell.label}
                className={cell.tone === "neutral" ? "fact-cell" : `fact-cell ${cell.tone}`}
              >
                <span>{cell.label}</span>
                <b className="tnum">{cell.value}</b>
              </div>
            ))}
          </div>
        )}

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
                />
              ))}
            </div>
          )}
        </div>

        <div className="inspect-section">
          <h4>相对方历史案件 ({partyHistory.length})</h4>
          {partyHistory.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              未发现同一相对方的历史审核记录
            </Typography.Text>
          ) : (
            <div className="subject-panel">
              {partyHistory.map((hit) => (
                <div key={hit.priorCaseId} className="subject-item">
                  <div className="subject-head">
                    <b>{hit.title}</b>
                    <Link to="/audit-cases/$id" params={{ id: hit.priorCaseId }}>
                      打开
                    </Link>
                  </div>
                  <div className="subject-meta">
                    <span>相对方 {hit.partyName}</span>
                  </div>
                  <ul className="subject-candidates">
                    {hit.findings.map((item) => (
                      <li key={item.findingRevisionId}>
                        {findingTypeLabels[item.findingType]} · {decisionLabels[item.decision]} ·
                        法务{item.reviewerId} · {dayLabel(item.reviewedAt)}
                      </li>
                    ))}
                  </ul>
                </div>
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
                    <div className="source-empty">-</div>
                  ) : (
                    items.map((locator) =>
                      locator.location.kind === "EXTERNAL_RECORD" ? (
                        <div key={locator.id} className="source-item">
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
                        </div>
                      ) : locator.location.kind === "POLICY_PARAMETER" ? (
                        <div key={locator.id} className="source-item">
                          <strong>
                            {shortAuditId(locator.id)} · 制度参数 ·{" "}
                            {getRuleCodeLabel(locator.location.ruleCode)}
                          </strong>
                          <div className="source-quote">{locator.location.quotedValue}</div>
                          <div className="source-meta">
                            <span>参数 {locator.location.parameterKey}</span>
                            {locator.location.ruleVersionId && (
                              <span>规则版本 · {locator.location.ruleVersionId.slice(0, 8)}…</span>
                            )}
                          </div>
                        </div>
                      ) : locator.location.kind === "PRIOR_CASE_RECORD" ? (
                        <div key={locator.id} className="source-item">
                          <strong>
                            {shortAuditId(locator.id)} · {locator.location.title}
                          </strong>
                          <div className="source-meta">
                            <span>相对方 {locator.location.partyName}</span>
                            <span>
                              {findingTypeLabels[locator.location.findingType]} ·{" "}
                              {decisionLabels[locator.location.decision]}
                            </span>
                            <span>
                              法务{locator.location.reviewerId} ·{" "}
                              {dayLabel(locator.location.reviewedAt)}
                            </span>
                          </div>
                          <div className="source-meta">
                            <Link
                              to="/audit-cases/$id"
                              params={{ id: locator.location.priorCaseId }}
                            >
                              打开历史案件
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <button
                          key={locator.id}
                          type="button"
                          className="source-item source-item--button"
                          onClick={() => {
                            if (locator.location.kind === "DOCUMENT_SPAN")
                              onFocusBlock(locator.location.blockId);
                          }}
                        >
                          <strong>
                            {shortAuditId(locator.id)} · 区块
                            {"blockId" in locator.location ? locator.location.blockId : ""}
                          </strong>
                          <div className="source-quote">
                            {"quotedText" in locator.location
                              ? locator.location.quotedText.slice(0, 60)
                              : ""}
                            …
                          </div>
                          <div className="source-meta">
                            <span>来源记录 · {locator.sourceRecordId.slice(0, 8)}…</span>
                          </div>
                        </button>
                      ),
                    )
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
          <Button danger onClick={() => onOpenReview("REJECTED", finding)}>
            判定误报
          </Button>
          <Button type="primary" onClick={() => onOpenReview("ACCEPTED", finding)}>
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
  onReassess,
  onBack,
  backLabel = "返回审计队列",
  onOpenTrace,
}: AuditCaseWorkbenchProps) {
  const {
    case: auditCase,
    snapshot,
    evidence,
    ruleAssessments,
    subjectVerifications,
    partyHistory = [],
    findings,
    sourceProvenance = null,
    originalDownloadable = false,
    originalStorage = null,
  } = detail;
  const stage = auditCase.stage;
  const failed = stage === "FAILED" || stage === "CANCELLED" || stage === "INTERRUPTED";
  const awaitingReview = stage === "AWAITING_REVIEW";
  const completed = stage === "COMPLETED";
  const running = !failed && !awaitingReview && !completed;

  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const [findingTab, setFindingTab] = useState<"pending" | "all">("pending");
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
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

  useEffect(() => {
    if (!focusedBlockId || !documentRef.current) return;
    const el = documentRef.current.querySelector(`[data-block-id="${focusedBlockId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedBlockId]);

  // The tab filters the list but never the selection: indices always address
  // the full findings array, so the inspector header stays stable.
  const visible = useMemo(() => visibleFindings(findings, findingTab), [findings, findingTab]);
  const pendingCount = useMemo(
    () => findings.filter((finding) => finding.review === null).length,
    [findings],
  );
  const coverageGroups = useMemo(
    () => groupAssessmentsByDisposition(ruleAssessments),
    [ruleAssessments],
  );

  const selectFindingTab = (next: "pending" | "all") => {
    setFindingTab(next);
    if (next !== "pending") return;
    const current = findings[selectedFindingIndex];
    if (current && current.review === null) return;
    const firstUnreviewed = findings.findIndex((finding) => finding.review === null);
    if (firstUnreviewed >= 0) setSelectedFindingIndex(firstUnreviewed);
  };

  // Reconcile selection when findings change or the tab switches: on the
  // pending tab, never leave the inspector on a reviewed finding. When all
  // findings are reviewed, clear the selection.
  useEffect(() => {
    if (findingTab !== "pending") return;
    const current = findings[selectedFindingIndex];
    if (current && current.review === null) return;
    const firstUnreviewed = findings.findIndex((finding) => finding.review === null);
    setSelectedFindingIndex(firstUnreviewed >= 0 ? firstUnreviewed : -1);
  }, [findings, findingTab, selectedFindingIndex]);

  const coverageSections: { key: string; label: string; tone: string; items: string[] }[] = [
    {
      key: "compliant",
      label: "通过",
      tone: "green",
      items: coverageGroups.compliant.map((assessment) => getRuleCodeLabel(assessment.ruleCode)),
    },
    {
      key: "conflict",
      label: "违反",
      tone: "red",
      items: coverageGroups.conflict.map((assessment) => getRuleCodeLabel(assessment.ruleCode)),
    },
    {
      key: "needsReview",
      label: "证据不足",
      tone: "orange",
      items: coverageGroups.needsReview.map((assessment) => getRuleCodeLabel(assessment.ruleCode)),
    },
    {
      key: "notApplicable",
      label: "不适用",
      tone: "default",
      items: coverageGroups.notApplicable.map((code) => getRuleCodeLabel(code as RuleCode)),
    },
  ];

  const showReview = (awaitingReview || completed) && findings.length > 0;
  const contractTitle = snapshot.document.blocks[0]?.text ?? "未命名合同";
  const coverage = useMemo(() => summarizeRuleCoverage(ruleAssessments), [ruleAssessments]);

  return (
    <article className="review-page">
      <div className="case-banner">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeftOutlined /> {backLabel}
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
            <Button size="small" icon={<NodeIndexOutlined />} onClick={onOpenTrace}>
              运行轨迹
            </Button>
            {canDownloadOriginal({ sourceProvenance, originalDownloadable }) && (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={`/api/source-records/${auditCase.sourceRecordId}/original`}
              >
                下载原文
              </Button>
            )}
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
            来源记录 ID <b className="mono">{auditCase.sourceRecordId}</b>
          </span>
          <span>
            来源 <b>{describeSourceProvenance(sourceProvenance, originalStorage).primary}</b>
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

      {running && ruleAssessments.length > 0 && (
        <div style={{ padding: "0 16px 8px" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            规则覆盖 · {coverage.compliant}/{coverage.total} 项通过
          </Typography.Text>
        </div>
      )}

      {failed && (
        <div className="workbench-panel">
          <Result
            status={stage === "CANCELLED" ? "warning" : "error"}
            title={stage === "CANCELLED" ? "审计已取消" : "审计未完成"}
            subTitle={`当前状态：${getAuditStageLabel(stage)}。可按当前规则重评，或仅重试智能体。`}
            extra={
              <Space>
                <Popconfirm
                  title="按当前规则重评？"
                  description="将按当前生效的规则版本重建审查快照并重新排队；原快照保留。"
                  okText="确认重评"
                  cancelText="返回"
                  onConfirm={onReassess}
                >
                  <Button type="primary" loading={action?.type === "REASSESS"}>
                    按当前规则重评
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="仅重试智能体？"
                  description="将沿用现有审查快照重新排队，不重新执行规则评估。"
                  okText="确认重试"
                  cancelText="返回"
                  onConfirm={onRetry}
                >
                  <Button loading={action?.type === "RETRY"}>仅重试智能体</Button>
                </Popconfirm>
              </Space>
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
              <button
                type="button"
                className={findingTab === "pending" ? "active" : ""}
                onClick={() => selectFindingTab("pending")}
              >
                待处理 {pendingCount}
              </button>
              <button
                type="button"
                className={findingTab === "all" ? "active" : ""}
                onClick={() => selectFindingTab("all")}
              >
                全部 {findings.length}
              </button>
            </div>
            <div className="finding-list">
              {visible.map((finding) => (
                <FindingListItem
                  key={finding.id}
                  finding={finding}
                  active={findings[selectedFindingIndex]?.id === finding.id}
                  onClick={() =>
                    setSelectedFindingIndex(findings.findIndex((item) => item.id === finding.id))
                  }
                />
              ))}
            </div>
            <button type="button" className="coverage" onClick={() => setCoverageOpen(true)}>
              <span>审查覆盖</span>
              <span>
                <b>{summarizeRuleOutcome(ruleAssessments)}</b>
              </span>
            </button>
          </aside>

          {/* Center: contract document */}
          <main className="document-stage" ref={documentRef}>
            <div className="document-page">
              <h1>{contractTitle}</h1>
              <div className="doc-no">
                合同版本 · 区块 {snapshot.document.blocks[0]?.blockId ?? "-"}
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
                ruleAssessments={assessmentsForFinding(
                  selectedFinding.proposal.findingType,
                  ruleAssessments,
                )}
                parties={snapshot.parties}
                subjectVerifications={subjectVerifications}
                partyHistory={partyHistory}
                evidence={evidence}
                onOpenReview={onOpenReview}
                onFocusBlock={setFocusedBlockId}
              />
            ) : (
              <div className="inspector-body">
                <Empty description="暂无审计发现" />
              </div>
            )}
          </aside>
        </div>
      )}

      {showReview && (
        <Drawer
          title="审查覆盖"
          open={coverageOpen}
          onClose={() => setCoverageOpen(false)}
          size="min(420px, 100vw)"
          destroyOnHidden
        >
          {coverageSections.map((section) => (
            <div key={section.key} className="coverage-group">
              <div className="coverage-group__head">
                <Tag color={section.tone} style={{ margin: 0 }}>
                  {section.label}
                </Tag>
                <span className="coverage-group__count">{section.items.length} 项</span>
              </div>
              {section.items.length === 0 ? (
                <div className="coverage-group__empty">-</div>
              ) : (
                <ul className="coverage-group__list">
                  {section.items.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Drawer>
      )}

      {!showReview && !running && !failed && completed && findings.length === 0 && (
        <div className="workbench-empty">
          <Empty
            description={<span>本次审计未检出制度冲突</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
          <dl className="coverage-facts">
            <div>
              <dt>规则覆盖</dt>
              <dd>
                {coverage.compliant} / {coverage.total} 项通过
              </dd>
            </div>
            <div>
              <dt>证据完整度</dt>
              <dd>
                {coverage.withEvidence} / {coverage.total} 项规则附证据锚点
              </dd>
            </div>
            <div>
              <dt>后续处理</dt>
              <dd>无需人工复核</dd>
            </div>
          </dl>
        </div>
      )}
      {!showReview && !running && !failed && !completed && (
        <div className="workbench-empty">
          <Empty description="等待审计完成" />
        </div>
      )}
    </article>
  );
}
