import { ENGINE_RULE_CODES } from "@contract-audit/audit";
import type {
  AgentRun,
  AgentTraceStepKind,
  AuditCase,
  AuditCaseStatus,
  AuditStage,
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
    PERFORMANCE_BOND_RATIO_LIMIT: "履约保证金比例规则",
    PAYMENT_TERM_LIMIT: "付款期限规则",
    BACK_TO_BACK_PAYMENT_CLAUSE: "背靠背付款条款规则",
    DEPOSIT_RATIO_LIMIT: "定金比例规则",
    WARRANTY_RETENTION_RATIO_LIMIT: "质量保证金比例规则",
    DISPUTE_RESOLUTION_CONFLICT: "或裁或诉规则",
    BID_BOND_RATIO_LIMIT: "投标保证金比例规则",
    IP_OWNERSHIP_MISSING: "知识产权归属规则",
    GUARANTEE_MODE_AMBIGUOUS: "保证方式规则",
    CONFIDENTIALITY_PERIOD_MISSING: "保密期限规则",
    FORCE_MAJEURE_OVERBROAD: "不可抗力范围规则",
    LIABILITY_CAP_MISSING: "赔偿责任上限规则",
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
 * Findings visible under a workbench tab. 待处理 hides anything a reviewer has
 * already decided; 全部 is the full list. The tab never reorders, so a finding's
 * position in either list maps back to the full array by id.
 */
export function visibleFindings<T extends { review: { decision: string } | null }>(
  findings: T[],
  tab: "pending" | "all",
): T[] {
  if (tab === "all") return findings;
  return findings.filter((finding) => finding.review === null);
}

/** One labelled cell of the inspector's finding-type fact grid. */
export interface FactCell {
  label: string;
  value: string;
  tone: "bad" | "ref" | "neutral";
}

/**
 * The fact grid a finding shows, or null when the finding is not about a
 * payment ratio. Only the payment rules compare a contract ratio with a policy
 * limit, so any other finding has no ratio pair to display.
 */
export function factCellsForFinding(
  findingType: string,
  facts: { advancePaymentRatio: number; policyLimitRatio: number },
): FactCell[] | null {
  if (!findingType.includes("ADVANCE_PAYMENT") && !findingType.includes("PAYMENT")) return null;
  const ratio = Math.round(facts.advancePaymentRatio * 100);
  const limit = Math.round(facts.policyLimitRatio * 100);
  const diff = ratio - limit;
  return [
    { label: "合同实际值", value: `${ratio}%`, tone: "bad" },
    { label: "制度上限", value: `${limit}%`, tone: "ref" },
    { label: "超出", value: `${diff > 0 ? `+${diff}` : diff}pp`, tone: "neutral" },
  ];
}

export interface RuleDispositionGroups {
  conflict: RuleAssessment[];
  compliant: RuleAssessment[];
  needsReview: RuleAssessment[];
  /** Engine rule codes the case never assessed. */
  notApplicable: string[];
}

/**
 * Groups a case's assessments by the disposition a reviewer reads, and reports
 * the engine rules the case never assessed as 不适用. The engine catalog is the
 * denominator: a rule outside it cannot yield an assessment.
 */
export function groupAssessmentsByDisposition(
  assessments: RuleAssessment[],
): RuleDispositionGroups {
  const assessed = new Set(assessments.map((assessment) => assessment.ruleCode));
  return {
    conflict: assessments.filter((a) => a.disposition === "POLICY_CONFLICT"),
    compliant: assessments.filter((a) => a.disposition === "COMPLIANT"),
    needsReview: assessments.filter((a) => a.disposition === "NEEDS_HUMAN_REVIEW"),
    notApplicable: ENGINE_RULE_CODES.filter((code) => !assessed.has(code)),
  };
}

/**
 * Queue-row label for counterparty (subject) red-line risk. Distinct from the
 * clause-risk column: it flags the party, not the contract text.
 */
export const subjectRedLineLabel = "主体风险";

// The finding-type vocabulary is shared with the API, which projects the review
// queue; it lives in the domain package and is re-exported here so components
// that already import it from this module keep one source.
export {
  findingTypeLabels,
  getFindingTypeLabel,
} from "@contract-audit/audit/finding-labels";

/** Chinese labels for finding severities. */
export const severityLabels: Record<Severity, string> = {
  LOW: "低风险",

  MEDIUM: "中风险",
  HIGH: "高风险",
};

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

// ── Agent Run traces ─────────────────────────────────────────────

export const traceStepKindLabels: Record<AgentTraceStepKind, string> = {
  STAGE: "阶段",
  TOOL_CALL: "调用",
  TOOL_RESULT: "返回",
  MESSAGE: "输出",
};

/**
 * Chinese label for a trace stage code. Tool labels are API identifiers and are
 * deliberately not translated — a reviewer comparing the trace with the tool
 * definitions needs the name as the agent saw it.
 */
export function getTraceStageLabel(label: string): string {
  return (
    {
      RUN_STARTED: "开始运行",
      RUN_COMPLETED: "运行完成",
      RUN_FAILED: "运行失败",
    }[label] ?? label
  );
}

export type AgentRunState = "RUNNING" | "SUCCEEDED" | "FAILED" | "INTERRUPTED";

export const agentRunStateLabels: Record<AgentRunState, string> = {
  RUNNING: "运行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  INTERRUPTED: "已中断",
};

export const agentRunStateTones: Record<AgentRunState, AuditTone> = {
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "danger",
  INTERRUPTED: "warning",
};

/** Ant Design v6 Tag status presets: processing, success, error, default, warning. */
export const agentRunStateTagColors: Record<AgentRunState, string> = {
  RUNNING: "processing",
  SUCCEEDED: "success",
  FAILED: "error",
  INTERRUPTED: "default",
};
/**
 * A run with neither an error nor a duration never reached `finishAgentRun`.
 * That is only "still running" while its case is; once the case has settled the
 * run was orphaned, and calling it running would promise a trace that will never
 * grow.
 */
export function getAgentRunState(
  run: AgentRun,
  caseStatus: AuditCaseStatus,
  isLatest = true,
): AgentRunState {
  if (run.error !== null) return "FAILED";
  if (run.durationMs !== null) return "SUCCEEDED";
  // Only the newest unfinished run can be truly running. An older unfinished
  // run was superseded by a retry — labeling it running would promise a trace
  // that will never grow.
  if (caseStatus !== "RUNNING") return "INTERRUPTED";
  return isLatest ? "RUNNING" : "INTERRUPTED";
}

/** Sub-second durations read better in milliseconds; the rest in seconds. */
/** Provider display: capitalize the raw wire value (e.g. "pi" → "Pi"). */
export function formatProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Model identity as a viewer reads it: "Pi 0.85.1 · deepseek-v4-flash". */
export function formatModelIdentity(provider: string, model: string, version: string): string {
  return `${formatProvider(provider)} ${version} · ${model}`;
}

/**
 * The agent harness that ran — a runtime, not a model. The two version on
 * separate cadences, so views that need both show them side by side rather
 * than concatenated into one name.
 */
export function formatAgentRuntime(provider: string, version: string): string {
  return `${formatProvider(provider)} ${version}`;
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Token usage as a run header states it; null when the provider reported none. */
/** Token counts for one run, normalized the way the harness accounts for them. */
export interface TokenUsageBreakdown {
  /** Prompt tokens sent to the model, cached and uncached alike. */
  input: number;
  /** Tokens the model generated back. */
  output: number;
  /** Prompt plus output; the provider's own figure when it reported one. */
  total: number;
  cacheRead: number;
  cacheWrite: number;
  /** Share of the prompt served from cache, in percent; null with no prompt to divide by. */
  cacheRate: number | null;
}

/**
 * Normalizes provider usage for display. The prompt is counted as `input +
 * cacheRead + cacheWrite` — the same accounting the harness uses for its own
 * total — so the input and output figures always add up to the total shown.
 */
export function tokenUsageBreakdown(
  usage: Record<string, number> | null,
): TokenUsageBreakdown | null {
  if (usage === null) return null;
  const count = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const input = count(usage.input) + cacheRead + cacheWrite;
  const output = count(usage.output);
  return {
    input,
    output,
    total: typeof usage.total === "number" ? usage.total : input + output,
    cacheRead,
    cacheWrite,
    cacheRate: input === 0 ? null : (cacheRead / input) * 100,
  };
}

/**
 * A step payload as displayed. Long payloads are cut on a line boundary with an
 * ellipsis rather than silently truncated, because a reviewer has to be able to
 * tell that they are reading part of something larger.
 */
export function formatTracePayload(value: unknown, limit = 4000): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text === undefined) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… 已截断（共 ${text.length.toLocaleString("en-US")} 字符）`;
}

/**
 * A step's offset from the start of its run. A harness view is read as a
 * sequence of durations, not as a wall-clock log, so the offset is what the
 * timeline shows.
 */
export function formatTraceOffset(runStartedAt: string, at: string): string {
  const elapsedMs = new Date(at).getTime() - new Date(runStartedAt).getTime();
  if (!Number.isFinite(elapsedMs)) return "—";
  return `+${(Math.max(0, elapsedMs) / 1000).toFixed(2)}s`;
}

/** Compact, stable label for an audit ID: full slug when short, 8-char prefix for UUIDs. */
export const shortAuditId = (id: string): string => (id.length <= 12 ? id : `${id.slice(0, 8)}…`);
