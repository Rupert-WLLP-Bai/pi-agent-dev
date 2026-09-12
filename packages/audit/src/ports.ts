import type { AuditSnapshot, FindingProposal, SubjectCandidate, SubjectMatchStatus } from "./model";

/** Telemetry recorded for one Agent Run. */
export interface AgentRunTelemetry {
  provider: string;
  model: string;
  version: string;
  usage: Record<string, number> | null;
}

export interface AgentRunResult {
  /**
   * Every risk the agent claims. Empty when it found none — that case passes
   * without review. One contract can violate several dimensions at once, so a
   * single result is allowed to carry more than one proposal.
   */
  proposals: FindingProposal[];
  telemetry: AgentRunTelemetry;
}

// The agent port: implementations receive a bounded audit snapshot and
// return finding proposals. They must not mutate the snapshot or
// override deterministic rule assessments.
export interface AuditAgentPort {
  run(input: AuditSnapshot, signal: AbortSignal): Promise<AgentRunResult>;
}

/** One provider answer for one party name. */
export interface SubjectVerificationOutcome {
  status: SubjectMatchStatus;
  /** Populated only when the match is AMBIGUOUS. */
  candidates: SubjectCandidate[];
  matched: SubjectCandidate | null;
  dimensions: Array<{ factor: string; count: number; detailTool: string }>;
  /** The provider's own sentence, kept verbatim in the Source Record. */
  summary: string;
  capturedAt: string;
  expiresAt: string | null;
  failureReason: string | null;
}

/**
 * The external-verification port. Implementations resolve a party name to a
 * legal person and report its risk dimensions. They never decide whether the
 * result is a Finding — that is the subject rule's job.
 *
 * Implementations must honour `signal`: verification is a network call and a
 * reviewer may cancel the case while it is in flight.
 */
export interface SubjectVerificationPort {
  readonly provider: string;
  readonly tool: string;
  verify(subject: string, signal?: AbortSignal): Promise<SubjectVerificationOutcome>;
}

// Product-level events published by the dispatcher. These are stable
// business notifications — never raw Pi runtime events.
export type AuditEvent =
  | { type: "audit.started"; auditCaseId: string }
  | { type: "rules.completed"; auditCaseId: string }
  | { type: "agent.started"; auditCaseId: string }
  | { type: "finding.proposed"; auditCaseId: string; proposal: FindingProposal }
  | { type: "audit.awaiting_review"; auditCaseId: string }
  | { type: "audit.failed"; auditCaseId: string; error: string }
  | { type: "audit.completed"; auditCaseId: string }
  | { type: "audit.cancelled"; auditCaseId: string };

export type AuditEventHandler = (event: AuditEvent) => void;
