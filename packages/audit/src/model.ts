// ── Rule Assessment ──────────────────────────────────────────────

export type RuleDisposition = "POLICY_CONFLICT" | "COMPLIANT";

export interface PaymentFacts {
  advancePaymentRatio: number;
  policyLimitRatio: number;
}

export interface RuleAssessment {
  disposition: RuleDisposition;
  ruleCode: "ADVANCE_PAYMENT_LIMIT";
  evidenceIds: string[];
}

// ── Evidence ─────────────────────────────────────────────────────

export interface EvidenceLocator {
  /** Stable ID citable by rule assessments and finding proposals. */
  id: string;
  sourceRecordId: string;
  contractDocumentHash: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
}

// ── Contract Document ────────────────────────────────────────────

export interface ContractBlock {
  blockId: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface ContractDocument {
  hash: string;
  blocks: ContractBlock[];
}

// ── Audit Snapshot ───────────────────────────────────────────────

export interface AuditSnapshot {
  sourceRecordId: string;
  contractDocument: ContractDocument;
  facts: PaymentFacts;
  evidence: EvidenceLocator[];
  ruleAssessment: RuleAssessment;
  createdAt: string;
}

// ── Finding ──────────────────────────────────────────────────────

export type FindingType = "ADVANCE_PAYMENT_POLICY_CONFLICT" | "NEEDS_HUMAN_REVIEW";
export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface FindingProposal {
  findingType: FindingType;
  severity: Severity;
  rationale: string;
  evidenceIds: string[];
  remediation: string;
}

export type ReviewDecision = "ACCEPTED" | "REJECTED";

export interface HumanReview {
  decision: ReviewDecision;
  reason?: string;
  reviewerId: string;
  reviewedAt: string;
}

export interface FindingRevision {
  id: string;
  auditCaseId: string;
  proposal: FindingProposal;
  supersedesId: string | null;
  review: HumanReview | null;
  createdAt: string;
}

// ── Audit Case lifecycle ─────────────────────────────────────────

export type AuditCaseStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
export type AuditStage = "QUEUED" | "NORMALIZING" | "RULE_ASSESSMENT" | "AGENT_RUNNING" | "AWAITING_REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export interface AuditCase {
  id: string;
  status: AuditCaseStatus;
  stage: AuditStage;
  sourceRecordId: string;
  createdAt: string;
  updatedAt: string;
}

// ── Agent Run ────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  auditCaseId: string;
  provider: string;
  model: string;
  version: string;
  usage: Record<string, number> | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

// ── Errors ───────────────────────────────────────────────────────

export class ContractNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractNormalizationError";
  }
}

export class UnknownEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownEvidenceError";
  }
}

export class LLMNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMNotConfiguredError";
  }
}
