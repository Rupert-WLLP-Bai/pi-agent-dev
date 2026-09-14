import type {
  AgentRun,
  AuditCase,
  AuditCaseStatus,
  ContractParty,
  RemediationStatus,
  Severity,
  SourceProvenance,
  SubjectMatchStatus,
} from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { schema } from "../schema";

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

/** List-row projection: case identity plus the summary the queue needs. */
export interface CaseSummary extends AuditCase {
  contractTitle: string | null;
  /** Current (chain-head) finding count; superseded revisions are excluded. */
  findingCount: number;
  /** Highest severity across current findings, or null when there are none. */
  highestSeverity: Severity | null;
  /**
   * Red-line risk dimensions across the case's latest RESOLVED subject
   * verification per party. 0 when the counterparty carries no red-line risk.
   */
  subjectRedLineCount: number;
  /** How the contract entered the system; null when never recorded. */
  sourceProvenance: SourceProvenance | null;
  /** Where an uploaded original lives; null when there is no file. */
  originalStorage: "s3" | "local" | null;
}

/**
 * One row of the external-verification timeline: a stored provider answer for
 * one Contract Party, projected with the case it belongs to. Rows are
 * append-only, so a re-verified case yields more than one row here.
 */
export interface SubjectVerificationListItem {
  id: string;
  auditCaseId: string;
  contractTitle: string | null;
  partyId: string;
  /**
   * The matched legal name when the subject settled, otherwise the name the
   * provider was asked about. Never empty, so a row always names a subject.
   */
  subjectName: string;
  status: SubjectMatchStatus;
  /** The provider that answered; null when its Source Record carries none. */
  provider: string | null;
  capturedAt: string;
  expiresAt: string | null;
}

/** Run-list projection: the run, the case it belongs to, and how much it traced. */
export interface AgentRunSummary extends AgentRun {
  contractTitle: string | null;
  /** Parties named in the contract, so a row says who it is between. */
  parties: ContractParty[];
  /** Status of the case the run belongs to. */
  caseStatus: AuditCaseStatus;
  stepCount: number;
}

/**
 * Dashboard projection. Aggregates are computed in SQL over stored rows so the
 * cockpit cannot disagree with the queue about the same data.
 */
export interface AuditOverview {
  totalCases: number;
  /** Cases whose stage is AWAITING_REVIEW. */
  awaitingReview: number;
  /** Cases that reached review or beyond (stage AWAITING_REVIEW or COMPLETED). */
  reachedReview: number;
  /** Case creations per day, oldest first, always the last 30 days. */
  dailyCounts: Array<{ date: string; count: number }>;
  /** Chain-head findings grouped by type. */
  findingsByType: Array<{ findingType: string; count: number }>;
  acceptedFindings: number;
  rejectedFindings: number;
  /** Chain-head findings whose proposal cites at least one evidence id. */
  citedFindings: number;
  chainHeadFindings: number;
  /** Median duration over successful agent runs; null before any run exists. */
  medianAgentDurationMs: number | null;
  successfulAgentRuns: number;
  /** Cases waiting for a reviewer, newest update first. */
  pendingReview: Array<{
    id: string;
    title: string | null;
    updatedAt: string;
    highestSeverity: Severity | null;
  }>;
}

/**
 * One row of the review queue: a chain-head finding on a case awaiting review,
 * projected with the SLA clock the operator works against. `remainingMs` is
 * derived at read time rather than stored, so the queue can never disagree
 * with the configured SLA.
 */
export interface ReviewQueueItem {
  caseId: string;
  /** Contract display name; "未命名合同" when the first block is not a title. */
  contractTitle: string;
  findingId: string;
  findingType: string;
  /** Chinese display title for the finding type. */
  title: string;
  severity: Severity | null;
  /** True when the finding needs human input rather than a settled decision. */
  evidenceConflict: boolean;
  assignee: string | null;
  priority: ReviewPriority | null;
  dueAt: string;
  remainingMs: number;
  updatedAt: string;
}

/** One Remediation Item as the detail view reads it. */
export interface Remediation {
  id: string;
  auditCaseId: string;
  findingRevisionId: string;
  summary: string;
  severity: Severity;
  owner: string | null;
  dueAt: string | null;
  status: RemediationStatus;
  progressNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closureEvidence: import("@contract-audit/audit/model").EvidenceLocator[] | null;
  closureHint: "implemented" | "open" | "unknown" | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Board card: the four fields the sketch asks a card to carry, plus the overdue
 * flag its column renders. `overdue` is derived at read time — a closed card is
 * never overdue, whatever its deadline says.
 */
export interface RemediationCard {
  id: string;
  caseId: string;
  contractTitle: string;
  summary: string;
  severity: Severity;
  owner: string | null;
  dueAt: string | null;
  overdue: boolean;
  /** Deterministic hint from a later Contract Revision re-run; not a close decision. */
  closureHint: "implemented" | "open" | "unknown" | null;
}

export interface RemediationColumn {
  status: RemediationStatus;
  count: number;
  items: RemediationCard[];
}

/** The 整改跟踪 board: every column in lifecycle order, even when empty. */
export interface RemediationBoard {
  columns: RemediationColumn[];
  total: number;
}

/**
 * A Source Record's stored original file, as the download endpoint needs it:
 * where the bytes live, and the uploaded name to hand back to the client.
 */
export interface SourceRecordOriginal {
  id: string;
  originalPath: string | null;
  name: string | null;
  provenance: SourceProvenance | null;
}
