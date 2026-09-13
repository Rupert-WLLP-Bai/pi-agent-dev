import type {
  AgentTraceTokens,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  EvidenceLocator,
  FindingProposal,
  HumanReview,
  SubjectMatchStatus,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import type { InferSelectModel } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auditStatuses = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;
const auditStages = [
  "QUEUED",
  "NORMALIZING",
  "RULE_ASSESSMENT",
  "SUBJECT_VERIFICATION",
  "AGENT_RUNNING",
  "AWAITING_REVIEW",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;

export const sourceRecords = pgTable("source_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceText: text("source_text").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const auditCases = pgTable("audit_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status", { enum: auditStatuses }).$type<AuditCaseStatus>().notNull(),
  stage: text("stage", { enum: auditStages }).$type<AuditStage>().notNull(),
  sourceRecordId: uuid("source_record_id")
    .references(() => sourceRecords.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  /** Operator the case is assigned to for review; null when unassigned. */
  assignee: text("assignee"),
  /** Review queue priority; null when the operator has not set one. */
  reviewPriority: text("review_priority").$type<ReviewPriority>(),
});

export const auditSnapshots = pgTable("audit_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id")
    .references(() => auditCases.id)
    .notNull(),
  sourceRecordId: uuid("source_record_id")
    .references(() => sourceRecords.id)
    .notNull(),
  document: jsonb("document").$type<AuditSnapshot["contractDocument"]>().notNull(),
  facts: jsonb("facts").$type<AuditSnapshot["facts"]>().notNull(),
  parties: jsonb("parties").$type<AuditSnapshot["parties"]>().notNull(),
  policy: jsonb("policy"),
  evidence: jsonb("evidence").$type<AuditSnapshot["evidence"]>().notNull(),
  /**
   * Holds an array of assessments. The physical column keeps its original
   * singular name so the migration diff stays purely additive; the property is
   * named for what it is.
   */
  ruleAssessments: jsonb("rule_assessment").$type<AuditSnapshot["ruleAssessments"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * One external-verification answer per Contract Party. Rows are append-only:
 * re-verifying a case appends rather than overwrites, so a reviewer can always
 * see which provider answers an earlier decision rested on.
 */
export const subjectVerifications = pgTable("subject_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id")
    .references(() => auditCases.id)
    .notNull(),
  partyId: text("party_id").notNull(),
  status: text("status").$type<SubjectMatchStatus>().notNull(),
  sourceRecordId: uuid("source_record_id"),
  payload: jsonb("payload").$type<SubjectVerification>().notNull(),
  evidence: jsonb("evidence").$type<EvidenceLocator[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id")
    .references(() => auditCases.id)
    .notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  version: text("version").notNull(),
  usage: jsonb("usage").$type<Record<string, number> | null>(),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * The ordered steps an Agent Run left behind. Append-only: a trace is evidence
 * about how a finding came to exist, so a step is never rewritten.
 *
 * `sequence` is assigned by the collector and unique per run, which is what
 * makes the trace order stable no matter when the rows land.
 */
export const agentTraceSteps = pgTable(
  "agent_trace_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .references(() => agentRuns.id)
      .notNull(),
    auditCaseId: uuid("audit_case_id")
      .references(() => auditCases.id)
      .notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull(),
    label: text("label").notNull(),
    ref: text("ref"),
    input: jsonb("input"),
    output: jsonb("output"),
    isError: boolean("is_error").notNull().default(false),
    durationMs: integer("duration_ms"),
    tokens: jsonb("tokens").$type<AgentTraceTokens | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("agent_trace_steps_run_sequence_idx").on(table.runId, table.sequence)],
);

export const findingRevisions = pgTable("finding_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id")
    .references(() => auditCases.id)
    .notNull(),
  proposal: jsonb("proposal").$type<FindingProposal>().notNull(),
  supersedesId: uuid("supersedes_id"),
  review: jsonb("review").$type<HumanReview | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const schema = {
  sourceRecords,
  auditCases,
  auditSnapshots,
  agentRuns,
  agentTraceSteps,
  findingRevisions,
  subjectVerifications,
};

export type SourceRecord = InferSelectModel<typeof sourceRecords>;
export type AuditCaseRow = InferSelectModel<typeof auditCases>;
export type AuditSnapshotRow = InferSelectModel<typeof auditSnapshots>;
export type AgentRunRow = InferSelectModel<typeof agentRuns>;
export type AgentTraceStepRow = InferSelectModel<typeof agentTraceSteps>;
export type FindingRevisionRow = InferSelectModel<typeof findingRevisions>;
export type SubjectVerificationRow = InferSelectModel<typeof subjectVerifications>;

export const sourceRecordsRelations = relations(sourceRecords, ({ many }) => ({
  cases: many(auditCases),
}));
export const auditCasesRelations = relations(auditCases, ({ one, many }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [auditCases.sourceRecordId],
    references: [sourceRecords.id],
  }),
  snapshots: many(auditSnapshots),
  runs: many(agentRuns),
  findings: many(findingRevisions),
}));
export const agentRunsRelations = relations(agentRuns, ({ many }) => ({
  steps: many(agentTraceSteps),
}));
