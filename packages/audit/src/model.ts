// ── Rule Assessment ──────────────────────────────────────────────

export type RuleDisposition = "POLICY_CONFLICT" | "COMPLIANT" | "NEEDS_HUMAN_REVIEW";

export type RuleCode =
  | "ADVANCE_PAYMENT_LIMIT"
  | "SUBJECT_RED_LINE_RISK"
  | "TERMINATION_CLAUSE_PRESENT"
  | "PENALTY_RATIO_LIMIT"
  | "DISPUTE_JURISDICTION";

export interface PaymentFacts {
  advancePaymentRatio: number;
  policyLimitRatio: number;
}

export interface RuleAssessment {
  /** Stable ID citable by a Finding Proposal. */
  id: string;
  disposition: RuleDisposition;
  ruleCode: RuleCode;
  evidenceIds: string[];
  /** The deterministic explanation the assessment stands on, before any model narration. */
  basis: string;
}

// ── Contract Party ───────────────────────────────────────────────

export interface ContractParty {
  /** Stable ID citable by Subject Verifications. */
  id: string;
  /** The label as the contract writes it, e.g. 甲方. */
  label: string;
  name: string;
  /** Locator covering the extracted name. */
  evidenceId: string;
}

// ── Subject Verification ─────────────────────────────────────────

export type SubjectMatchStatus = "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED" | "UNAVAILABLE";

export interface SubjectCandidate {
  name: string;
  unifiedSocialCreditCode: string;
  registrationStatus: string;
}

/** One risk factor the provider reports, classified by our own declared policy. */
export interface SubjectRiskDimension {
  factor: string;
  count: number;
  /** RED_LINE factors justify a Finding; BACKGROUND ones only inform the profile. */
  severity: "RED_LINE" | "BACKGROUND";
  /** Provider tool that drills into this factor. */
  detailTool: string;
}

export interface SubjectVerification {
  id: string;
  partyId: string;
  status: SubjectMatchStatus;
  /** Populated only when the match is AMBIGUOUS. */
  candidates: SubjectCandidate[];
  matched: SubjectCandidate | null;
  dimensions: SubjectRiskDimension[];
  /** The provider's own sentence, kept verbatim for the evidence card. */
  providerSummary: string;
  /** External Evidence Locators citing the verification Source Record. */
  evidenceIds: string[];
  /** The Source Record holding the provider answer, failure included. */
  sourceRecordId: string | null;
  capturedAt: string;
  expiresAt: string | null;
  failureReason: string | null;
}

// ── Evidence ─────────────────────────────────────────────────────

/** A bounded span of the Contract Document. */
export interface DocumentSpanLocator {
  kind: "DOCUMENT_SPAN";
  contractDocumentHash: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
}

/**
 * A named record reported by a Source Record obtained elsewhere. Its identity is
 * the provider call plus the dimension, so re-verification never rewrites it.
 */
export interface ExternalRecordLocator {
  kind: "EXTERNAL_RECORD";
  provider: string;
  tool: string;
  subject: string;
  recordType: string;
  capturedAt: string;
  expiresAt: string | null;
}

export interface EvidenceLocator {
  /** Stable ID citable by rule assessments and finding proposals. */
  id: string;
  sourceRecordId: string;
  location: DocumentSpanLocator | ExternalRecordLocator;
}

// ── Contract Document ────────────────────────────────────────────

/** Structural role of a block in the source document. */
export type BlockKind = "heading" | "paragraph" | "table" | "furniture";

export interface ContractBlock {
  blockId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  /**
   * Structural role. Optional because snapshots persisted before the IR
   * extension carry no kind; absent reads as a plain paragraph.
   */
  kind?: BlockKind;
  /** 1-based page in the source; null when the source has no pages. */
  page?: number | null;
  /** Enclosing section labels, outermost first, e.g. ["第三章", "3.2"]. */
  sectionPath?: string[];
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
  parties: ContractParty[];
  evidence: EvidenceLocator[];
  ruleAssessments: RuleAssessment[];
  createdAt: string;
}

// ── Finding ──────────────────────────────────────────────────────

export type FindingType =
  | "ADVANCE_PAYMENT_POLICY_CONFLICT"
  | "SUBJECT_RED_LINE_RISK"
  | "TERMINATION_CLAUSE_MISSING"
  | "PENALTY_RATIO_POLICY_CONFLICT"
  | "PENALTY_CLAUSE_MISSING"
  | "DISPUTE_JURISDICTION_CONFLICT"
  | "DISPUTE_CLAUSE_MISSING"
  | "NEEDS_HUMAN_REVIEW";
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
export type AuditStage =
  | "QUEUED"
  | "NORMALIZING"
  | "RULE_ASSESSMENT"
  | "SUBJECT_VERIFICATION"
  | "AGENT_RUNNING"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

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
