import type {
  AuditCase,
  AuditCaseStatus,
  AuditStage,
  FindingType,
  RuleAssessment,
  RuleCode,
  RuleDisposition,
  Severity,
  SourceProvenance,
  SourceType,
  SubjectMatchStatus,
  SubjectRiskDimension,
} from "@contract-audit/audit/model";

export type AuditLifecycleFilter =
  | "ALL"
  | "AWAITING_REVIEW"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "ABNORMAL";
export type AuditCaseAction = "VIEW" | "CANCEL" | "RETRY";
export type AuditTone = "neutral" | "info" | "warning" | "danger" | "success";
export type AuditDisplayKey = AuditCaseStatus | "AWAITING_REVIEW";

export interface AuditDisplayState {
  key: AuditDisplayKey;
  label: string;
  tone: AuditTone;
}

export interface AuditQueueStats {
  awaitingReview: number;
  processing: number;
  abnormal: number;
  completedToday: number;
}

const displayStates: Record<AuditDisplayKey, Omit<AuditDisplayState, "key">> = {
  PENDING: { label: "排队中", tone: "info" },
  RUNNING: { label: "审计中", tone: "warning" },
  AWAITING_REVIEW: { label: "待复核", tone: "info" },
  COMPLETED: { label: "已完成", tone: "success" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  INTERRUPTED: { label: "已中断", tone: "warning" },
};

export function getAuditDisplayState(auditCase: AuditCase): AuditDisplayState {
  const key: AuditDisplayKey =
    auditCase.stage === "AWAITING_REVIEW" ? "AWAITING_REVIEW" : auditCase.status;
  return { key, ...displayStates[key] };
}

export const getAuditStageLabel = (stage: AuditStage): string =>
  ({
    QUEUED: "等待处理",
    NORMALIZING: "合同规范化",
    RULE_ASSESSMENT: "规则评估",
    SUBJECT_VERIFICATION: "主体核验",
    AGENT_RUNNING: "Agent 分析",
    AWAITING_REVIEW: "人工复核",
    COMPLETED: "已完成",
    FAILED: "失败",
    CANCELLED: "已取消",
    INTERRUPTED: "已中断",
  })[stage];

export function getAuditStep(auditCase: AuditCase): number {
  if (auditCase.stage === "COMPLETED") return 4;
  if (auditCase.stage === "AWAITING_REVIEW") return 3;
  if (auditCase.stage === "AGENT_RUNNING") return 2;
  if (
    auditCase.stage === "RULE_ASSESSMENT" ||
    auditCase.stage === "SUBJECT_VERIFICATION" ||
    auditCase.stage === "NORMALIZING"
  )
    return 1;
  return 0;
}

/** Chinese label for a rule, keyed by its stable code. */
export const getRuleCodeLabel = (code: RuleCode): string =>
  ({
    ADVANCE_PAYMENT_LIMIT: "预付款上限规则",
    SUBJECT_RED_LINE_RISK: "主体红线规则",
    TERMINATION_CLAUSE_PRESENT: "终止条款规则",
    PENALTY_RATIO_LIMIT: "违约金上限规则",
    DISPUTE_JURISDICTION: "争议管辖规则",
  })[code];

export const getRuleDispositionLabel = (disposition: RuleDisposition): string =>
  ({
    POLICY_CONFLICT: "违反",
    COMPLIANT: "通过",
    NEEDS_HUMAN_REVIEW: "需人工复核",
  })[disposition];

/** Worst disposition across every assessment, for the workbench coverage summary. */
export const summarizeRuleOutcome = (assessments: RuleAssessment[]): string => {
  if (assessments.some((item) => item.disposition === "POLICY_CONFLICT")) return "违反";
  if (assessments.some((item) => item.disposition === "NEEDS_HUMAN_REVIEW")) return "需人工复核";
  return assessments.length === 0 ? "无评估" : "通过";
};

export const getSubjectStatusLabel = (status: SubjectMatchStatus | null): string =>
  ({
    RESOLVED: "已匹配主体",
    AMBIGUOUS: "多个候选",
    UNRESOLVED: "未匹配到主体",
    UNAVAILABLE: "核验不可用",
    null: "未核验",
  })[status ?? "null"];

export const getSubjectDimensionSeverityLabel = (
  severity: SubjectRiskDimension["severity"],
): string => (severity === "RED_LINE" ? "红线" : "背景");

/** Chinese labels for the channel a contract entered through. */
const sourceTypeLabels: Record<SourceType, string> = {
  TEXT_PASTE: "文本粘贴",
  FILE_UPLOAD: "文件上传",
  DEMO: "内置演示",
};

export const getSourceTypeLabel = (type: SourceType): string => sourceTypeLabels[type];

/**
 * The two lines of a queue row's 来源 cell. A record with no recorded
 * provenance shows a dash: `CONTEXT.md` treats a Source Record's origin as a
 * fact, and a missing fact is not evidence of a paste.
 */
export function describeSourceProvenance(provenance: SourceProvenance | null): {
  primary: string;
  secondary: string | null;
} {
  if (provenance === null) return { primary: "—", secondary: null };
  const label = getSourceTypeLabel(provenance.type);
  return provenance.displayName === null
    ? { primary: label, secondary: null }
    : { primary: provenance.displayName, secondary: label };
}

export interface RuleCoverage {
  total: number;
  compliant: number;
  needsReview: number;
  conflict: number;
  /** Assessments carrying at least one evidence anchor. */
  withEvidence: number;
}

/**
 * Rule coverage for a case, used where a case needs to state what was checked
 * rather than what was found — notably the no-risk terminal state, which must
 * show completed coverage instead of a bare success message.
 */
export function summarizeRuleCoverage(assessments: RuleAssessment[]): RuleCoverage {
  return assessments.reduce<RuleCoverage>(
    (coverage, assessment) => {
      coverage.total += 1;
      if (assessment.disposition === "COMPLIANT") coverage.compliant += 1;
      if (assessment.disposition === "NEEDS_HUMAN_REVIEW") coverage.needsReview += 1;
      if (assessment.disposition === "POLICY_CONFLICT") coverage.conflict += 1;
      if (assessment.evidenceIds.length > 0) coverage.withEvidence += 1;
      return coverage;
    },
    { total: 0, compliant: 0, needsReview: 0, conflict: 0, withEvidence: 0 },
  );
}

/**
 * Queue-row label for counterparty (subject) red-line risk. Distinct from the
 * clause-risk column: it flags the party, not the contract text.
 */
export const subjectRedLineLabel = "主体风险";

export const findingTypeLabels: Record<FindingType, string> = {
  ADVANCE_PAYMENT_POLICY_CONFLICT: "预付款比例超过制度上限",
  SUBJECT_RED_LINE_RISK: "相对方主体风险",
  TERMINATION_CLAUSE_MISSING: "缺少合同终止/解除条款",
  PENALTY_RATIO_POLICY_CONFLICT: "违约金比例超过制度上限",
  PENALTY_CLAUSE_MISSING: "缺少违约责任条款",
  DISPUTE_JURISDICTION_CONFLICT: "争议管辖地与我方不一致",
  DISPUTE_CLAUSE_MISSING: "缺少争议解决条款",
  NEEDS_HUMAN_REVIEW: "需要人工复核",
};

/** Chinese labels for finding severities. */
export const severityLabels: Record<Severity, string> = {
  LOW: "低风险",

  MEDIUM: "中风险",
  HIGH: "高风险",
};

/** Chinese label for a finding type; unknown codes surface as-is. */
export function getFindingTypeLabel(type: string): string {
  if (type in findingTypeLabels) return findingTypeLabels[type as FindingType];
  return type;
}

/** Fixed order and labels of the evidence groups shown in the inspector. */
export const evidenceSourceGroupLabels = {
  CONTRACT: "合同原文",
  POLICY: "制度依据",
  EXTERNAL: "外部核验",
} as const;

export type EvidenceSourceGroup = keyof typeof evidenceSourceGroupLabels;

export const evidenceSourceGroupOrder: EvidenceSourceGroup[] = ["CONTRACT", "POLICY", "EXTERNAL"];

const retryableStatuses = new Set<AuditCaseStatus>(["FAILED", "CANCELLED", "INTERRUPTED"]);

export function getAvailableCaseActions(auditCase: AuditCase): AuditCaseAction[] {
  if (auditCase.stage === "AWAITING_REVIEW" || auditCase.stage === "COMPLETED") return ["VIEW"];
  if (auditCase.status === "PENDING" || auditCase.status === "RUNNING") return ["VIEW", "CANCEL"];
  if (retryableStatuses.has(auditCase.status)) return ["VIEW", "RETRY"];
  return ["VIEW"];
}

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

export function deriveQueueStats(cases: AuditCase[], now = new Date()): AuditQueueStats {
  return cases.reduce<AuditQueueStats>(
    (stats, auditCase) => {
      const displayKey = getAuditDisplayState(auditCase).key;
      if (displayKey === "AWAITING_REVIEW") stats.awaitingReview += 1;
      if (displayKey === "PENDING" || displayKey === "RUNNING") stats.processing += 1;
      if (displayKey === "FAILED" || displayKey === "INTERRUPTED") stats.abnormal += 1;
      if (displayKey === "COMPLETED" && sameLocalDay(new Date(auditCase.updatedAt), now)) {
        stats.completedToday += 1;
      }
      return stats;
    },
    { awaitingReview: 0, processing: 0, abnormal: 0, completedToday: 0 },
  );
}

const matchesLifecycle = (auditCase: AuditCase, filter: AuditLifecycleFilter): boolean => {
  const displayKey = getAuditDisplayState(auditCase).key;
  switch (filter) {
    case "ALL":
      return true;
    case "AWAITING_REVIEW":
      return displayKey === "AWAITING_REVIEW";
    case "PROCESSING":
      return displayKey === "PENDING" || displayKey === "RUNNING";
    case "COMPLETED":
      return displayKey === "COMPLETED";
    case "CANCELLED":
      return displayKey === "CANCELLED";
    case "ABNORMAL":
      return displayKey === "FAILED" || displayKey === "INTERRUPTED";
  }
};

export function filterAndSortCases(
  cases: Array<AuditCase & { contractTitle?: string | null }>,
  filter: AuditLifecycleFilter,
  search: string,
): typeof cases {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return cases
    .filter((auditCase) => {
      if (!matchesLifecycle(auditCase, filter)) return false;
      if (!normalizedSearch) return true;
      const title = (auditCase.contractTitle ?? "").toLocaleLowerCase();
      return (
        auditCase.id.toLocaleLowerCase().includes(normalizedSearch) ||
        title.includes(normalizedSearch) ||
        auditCase.sourceRecordId.toLocaleLowerCase().includes(normalizedSearch)
      );
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

/** Compact, stable label for an audit ID: full slug when short, 8-char prefix for UUIDs. */
export const shortAuditId = (id: string): string => (id.length <= 12 ? id : `${id.slice(0, 8)}…`);
