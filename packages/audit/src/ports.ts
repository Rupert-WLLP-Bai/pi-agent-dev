import type { AuditSnapshot, FindingProposal } from "./model";

/** Telemetry recorded for one Agent Run. */
export interface AgentRunTelemetry {
  provider: string;
  model: string;
  version: string;
  usage: Record<string, number> | null;
}

export interface AgentRunResult {
  proposal: FindingProposal;
  telemetry: AgentRunTelemetry;
}

// The agent port: implementations receive a bounded audit snapshot and
// return a finding proposal. They must not mutate the snapshot or
// override deterministic rule assessments.
export interface AuditAgentPort {
  run(input: AuditSnapshot, signal: AbortSignal): Promise<AgentRunResult>;
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
