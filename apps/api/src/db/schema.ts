import { relations } from "drizzle-orm";
import { jsonb, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  AuditCaseStatus,
  AuditStage,
  AuditSnapshot,
  FindingProposal,
  HumanReview,
} from "@contract-audit/audit/model";
import type { InferSelectModel } from "drizzle-orm";

const auditStatuses = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;
const auditStages = ["QUEUED", "NORMALIZING", "RULE_ASSESSMENT", "AGENT_RUNNING", "AWAITING_REVIEW", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;

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
  sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const auditSnapshots = pgTable("audit_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id").references(() => auditCases.id).notNull(),
  sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id).notNull(),
  document: jsonb("document").$type<AuditSnapshot["contractDocument"]>().notNull(),
  facts: jsonb("facts").$type<AuditSnapshot["facts"]>().notNull(),
  policy: jsonb("policy"),
  evidence: jsonb("evidence").$type<AuditSnapshot["evidence"]>().notNull(),
  ruleAssessment: jsonb("rule_assessment").$type<AuditSnapshot["ruleAssessment"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id").references(() => auditCases.id).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  version: text("version").notNull(),
  usage: jsonb("usage").$type<Record<string, number> | null>(),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const findingRevisions = pgTable("finding_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id").references(() => auditCases.id).notNull(),
  proposal: jsonb("proposal").$type<FindingProposal>().notNull(),
  supersedesId: uuid("supersedes_id"),
  review: jsonb("review").$type<HumanReview | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const schema = { sourceRecords, auditCases, auditSnapshots, agentRuns, findingRevisions };

export type SourceRecord = InferSelectModel<typeof sourceRecords>;
export type AuditCaseRow = InferSelectModel<typeof auditCases>;
export type AuditSnapshotRow = InferSelectModel<typeof auditSnapshots>;
export type AgentRunRow = InferSelectModel<typeof agentRuns>;
export type FindingRevisionRow = InferSelectModel<typeof findingRevisions>;

export const sourceRecordsRelations = relations(sourceRecords, ({ many }) => ({ cases: many(auditCases) }));
export const auditCasesRelations = relations(auditCases, ({ one, many }) => ({
  sourceRecord: one(sourceRecords, { fields: [auditCases.sourceRecordId], references: [sourceRecords.id] }),
  snapshots: many(auditSnapshots),
  runs: many(agentRuns),
  findings: many(findingRevisions),
}));
