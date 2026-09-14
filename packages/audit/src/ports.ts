import type {
  AgentTraceObservation,
  AgentTraceStep,
  AuditSnapshot,
  FindingProposal,
  RemediationStatus,
  SubjectCandidate,
  SubjectMatchStatus,
} from "./model";

/** Static identity of an agent implementation, known before any run starts. */
export interface AgentRunIdentity {
  provider: string;
  model: string;
  version: string;
}

export interface AgentRunResult {
  /**
   * Every risk the agent claims. Empty when it found none — that case passes
   * without review. One contract can violate several dimensions at once, so a
   * single result is allowed to carry more than one proposal.
   */
  proposals: FindingProposal[];
  /** Provider-reported token usage; null when the provider reported none. */
  usage: Record<string, number> | null;
}

/**
 * Receives each step an agent reports about itself.
 *
 * A sink is called synchronously from wherever the agent observes a step, so
 * it must not block. It also must not throw: tracing is observability, and a
 * trace that fails to record must never fail the audit it describes.
 */
export type AgentTraceSink = (observation: AgentTraceObservation) => void;

// The agent port: implementations receive a bounded audit snapshot and
// return finding proposals. They must not mutate the snapshot or
// override deterministic rule assessments.
export interface AuditAgentPort {
  /** Written onto the Agent Run row before the run starts. */
  readonly identity: AgentRunIdentity;
  run(input: AuditSnapshot, signal: AbortSignal, trace: AgentTraceSink): Promise<AgentRunResult>;
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
  | {
      type: "rules.completed";
      auditCaseId: string;
      summary?: { total: number; conflict: number; needsReview: number; compliant: number };
    }
  | { type: "agent.started"; auditCaseId: string }
  | { type: "agent.trace"; auditCaseId: string; step: AgentTraceStep }
  | { type: "finding.proposed"; auditCaseId: string; proposal: FindingProposal }
  | { type: "audit.awaiting_review"; auditCaseId: string }
  | { type: "audit.failed"; auditCaseId: string; errorCode: string }
  | { type: "audit.completed"; auditCaseId: string }
  | { type: "audit.cancelled"; auditCaseId: string }
  | {
      type: "review.assigned";
      auditCaseId: string;
      assignee: string | null;
      priority: ReviewPriority | null;
    }
  | { type: "remediation.created"; auditCaseId: string; id: string }
  | {
      type: "remediation.transitioned";
      auditCaseId: string;
      id: string;
      from: RemediationStatus;
      to: RemediationStatus;
    }
  | { type: "remediation.closed"; auditCaseId: string; id: string };

/**
 * Review queue priority. An operator-facing ordering aid, not a severity: a
 * high-priority case is one someone must look at sooner, whatever its findings
 * turned out to be.
 */
export type ReviewPriority = "high" | "normal" | "low";

export type AuditEventHandler = (event: AuditEvent) => void;
