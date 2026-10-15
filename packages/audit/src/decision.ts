import type { RuleCode, RuleDisposition } from "./model";

export const DECISION_SCHEMA_VERSION = 1;

export type DecisionMode = "off" | "shadow";
export type DecisionProviderName = "disabled" | "fake" | "laya-cpu";
export type DecisionDataClassification = "SYNTHETIC" | "MASKED" | "INTERNAL";
export type DecisionTaskType = "clause_category" | "review_routing" | "clause_score";
export type DecisionStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type DecisionConfidenceType = "laya_entropy_concentration" | "answer_confidence" | "none";

export type DecisionQuestion =
  | { type: "choice"; criteria: string; options: string[] }
  | { type: "score"; criteria: string; options: number[] }
  | { type: "noul"; criteria: string };

export type DecisionAnswer =
  | { type: "choice"; choice: string }
  | { type: "score"; score: number }
  | { type: "noul"; noul: number };

/** Coordinates refer to the original document, never to the redacted string. */
export interface DecisionEvidenceReference {
  evidenceId: string;
  sourceRecordId: string;
  blockId: string | null;
  startOffset: number | null;
  endOffset: number | null;
}

/** Frozen observation input. This entire object must never be sent to a provider. */
export interface DecisionRequest {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  auditCaseId: string;
  snapshotId: string;
  agentRunId: string;
  contractDocumentHash: string;
  taskType: DecisionTaskType;
  questionKey: string;
  question: DecisionQuestion;
  questionVersion: string;
  policyVersion: string;
  redactionVersion: string;
  contractStance: "revenue" | "procurement" | null;
  structuredSignals: Record<string, string | number | boolean | null>;
  maskedClauseExcerpt: string | null;
  evidenceRefs: DecisionEvidenceReference[];
  ruleAssessments: Array<{
    assessmentId: string;
    ruleCode: RuleCode;
    disposition: RuleDisposition;
  }>;
  /** Local comparison metadata; excluded from model state to prevent label leakage. */
  comparison: {
    assessmentId: string;
    ruleCode: RuleCode;
    baselineAnswer: DecisionAnswer;
  } | null;
  dataClassification: DecisionDataClassification;
  traceId: string;
}

/** Parsed provider output, without authoritative audit or review state. */
export interface DecisionProviderResult {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  modelVersion: string;
  answer: DecisionAnswer;
  rawProbabilities: Record<string, number> | null;
  rawScore: number | null;
  confidence: number | null;
  confidenceType: DecisionConfidenceType;
  usage: Record<string, number> | null;
}

export type DecisionErrorCode =
  | "disabled"
  | "provider_timeout"
  | "provider_unavailable"
  | "invalid_request"
  | "invalid_response"
  | "unsupported_schema"
  | "forbidden_outbound"
  | "aborted";

export interface DecisionFailure {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  error: DecisionErrorCode;
  retryable: boolean;
}

export type DecisionProviderOutcome =
  | { ok: true; result: DecisionProviderResult }
  | { ok: false; failure: DecisionFailure };

export interface DecisionApiError {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  error: string;
  requestId: string;
}

export interface DecisionProvider {
  readonly identity: { provider: DecisionProviderName; modelVersion: string };
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionProviderOutcome>;
}

/** A disagreement is comparable only when the question asserts the same proposition. */
export interface DecisionRuleConflict {
  assessmentId: string;
  ruleCode: RuleCode;
  conflictType: "OPPOSED_ASSESSMENT";
  baselineAnswer: DecisionAnswer;
  shadowAnswer: DecisionAnswer;
}

/** Auxiliary observation. It cannot authorize a Finding or a Human Review. */
export interface DecisionAdvice {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  decisionId: string;
  auditCaseId: string;
  snapshotId: string;
  agentRunId: string;
  contractDocumentHash: string;
  mode: "shadow";
  status: DecisionStatus;
  provider: DecisionProviderName;
  modelVersion: string;
  taskType: DecisionTaskType;
  questionKey: string;
  questionVersion: string;
  policyVersion: string;
  redactionVersion: string;
  answer: DecisionAnswer | null;
  rawProbabilities: Record<string, number> | null;
  rawScore: number | null;
  confidence: number | null;
  confidenceType: DecisionConfidenceType;
  calibrated: boolean;
  calibrationVersion: string | null;
  thresholdPolicyVersion: string | null;
  threshold: number | null;
  uncertainty: "unavailable" | "uncalibrated" | "calibrated";
  ruleConflicts: DecisionRuleConflict[];
  needsHumanReview: boolean;
  evidenceRefs: DecisionEvidenceReference[];
  latencyMs: number | null;
  inputHash: string;
  dataClassification: DecisionDataClassification;
  traceId: string;
  fallbackReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type DecisionFeedbackChoice = "accepted" | "rejected" | "needs_review";

/** Append-only evaluation feedback, independent of a finding's review history. */
export interface DecisionFeedback {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  id: string;
  decisionId: string;
  decision: DecisionFeedbackChoice;
  actor: string;
  reason: string | null;
  createdAt: string;
}

export interface DecisionAdviceList {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  mode: DecisionMode;
  provider: DecisionProviderName;
  items: DecisionAdvice[];
}

export interface DecisionDetail {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  advice: DecisionAdvice;
  feedback: DecisionFeedback[];
}
