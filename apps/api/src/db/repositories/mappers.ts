import type {
  AgentRun,
  AgentTraceStep,
  AuditCase,
  AuditSnapshot,
  AuditSnapshotPolicy,
  FindingRevision,
  RemediationStatus,
  Severity,
  SourceProvenance,
} from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import type {
  agentRuns,
  agentTraceSteps,
  auditCases,
  auditSnapshots,
  findingRevisions,
  remediations,
} from "../schema";

type DateLike = Date | string;
export const asDate = (value: DateLike): Date => (value instanceof Date ? value : new Date(value));

const severityByRank: Record<number, Severity> = { 3: "HIGH", 2: "MEDIUM", 1: "LOW" };

export const toReviewPriority = (value: string | null): ReviewPriority | null =>
  value === "high" || value === "normal" || value === "low" ? value : null;

export const toSeverity = (value: string | null): Severity | null => {
  const rank = value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : value === "LOW" ? 1 : 0;
  return severityByRank[rank] ?? null;
};

/** DB text back to the lifecycle union; an unrecognised value reads as pending. */
export const toRemediationStatus = (value: string): RemediationStatus =>
  value === "in_progress" || value === "awaiting_review" || value === "closed" ? value : "pending";

export const toRemediation = (row: typeof remediations.$inferSelect) => ({
  id: row.id,
  auditCaseId: row.auditCaseId,
  findingRevisionId: row.findingRevisionId,
  summary: row.summary,
  severity: toSeverity(row.severity) ?? "LOW",
  owner: row.owner,
  dueAt: row.dueAt === null ? null : row.dueAt.toISOString(),
  status: row.status,
  progressNote: row.progressNote,
  closedBy: row.closedBy,
  closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Rebuilds provenance from Source Record metadata. Records written before
 * provenance was tracked carry no type, and an unrecognised value is treated
 * the same way: the honest answer is "unknown", never a guessed channel.
 */
export const toSourceProvenance = (
  type: string | null,
  displayName: string | null,
): SourceProvenance | null => {
  if (type !== "TEXT_PASTE" && type !== "FILE_UPLOAD" && type !== "DEMO") return null;
  return { type, displayName: displayName && displayName.length > 0 ? displayName : null };
};

export const toCase = (row: typeof auditCases.$inferSelect): AuditCase => ({
  id: row.id,
  status: row.status,
  stage: row.stage,
  sourceRecordId: row.sourceRecordId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toSnapshot = (row: typeof auditSnapshots.$inferSelect): AuditSnapshot => ({
  sourceRecordId: row.sourceRecordId,
  contractDocument: row.document as AuditSnapshot["contractDocument"],
  facts: row.facts as AuditSnapshot["facts"],
  parties: row.parties as AuditSnapshot["parties"],
  policy: (row.policy as AuditSnapshotPolicy | null) ?? undefined,
  evidence: row.evidence as AuditSnapshot["evidence"],
  ruleAssessments: row.ruleAssessments as AuditSnapshot["ruleAssessments"],
  createdAt: row.createdAt.toISOString(),
});

export const toAgentRun = (row: typeof agentRuns.$inferSelect): AgentRun => ({
  id: row.id,
  auditCaseId: row.auditCaseId,
  provider: row.provider,
  model: row.model,
  version: row.version,
  usage: row.usage,
  durationMs: row.durationMs,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
});

export const toTraceStep = (row: typeof agentTraceSteps.$inferSelect): AgentTraceStep => ({
  runId: row.runId,
  sequence: row.sequence,
  kind: row.kind as AgentTraceStep["kind"],
  at: row.at.toISOString(),
  label: row.label,
  ref: row.ref,
  input: row.input,
  output: row.output,
  isError: row.isError,
  durationMs: row.durationMs,
  tokens: row.tokens ?? null,
});

export const toFinding = (row: typeof findingRevisions.$inferSelect): FindingRevision => ({
  id: row.id,
  auditCaseId: row.auditCaseId,
  proposal: row.proposal,
  supersedesId: row.supersedesId,
  review: row.review,
  createdAt: row.createdAt.toISOString(),
});
