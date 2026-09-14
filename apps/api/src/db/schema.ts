import type { ValidationCaseResult, ValidationSummary } from "@contract-audit/audit/golden-eval";
import type {
  AgentTraceTokens,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  EvidenceLocator,
  FindingProposal,
  HumanReview,
  RemediationStatus,
  Severity,
  SubjectMatchStatus,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { PartyHistoryRun } from "@contract-audit/audit/party-history-rule";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import type { InferSelectModel } from "drizzle-orm";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
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
const remediationStatuses = ["pending", "in_progress", "awaiting_review", "closed"] as const;

export const sourceRecords = pgTable("source_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceText: text("source_text").notNull(),
  metadata: jsonb("metadata"),
  /**
   * Path on disk to the uploaded original, when the contract arrived as a
   * file. Null for pasted text, which has no original to download.
   */
  originalPath: text("original_path"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const auditCases = pgTable(
  "audit_cases",
  {
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
  },
  (table) => [
    index("audit_cases_status_created_at_idx").on(table.status, table.createdAt),
    index("audit_cases_stage_idx").on(table.stage),
    index("audit_cases_created_at_idx").on(table.createdAt),
  ],
);

export const auditSnapshots = pgTable(
  "audit_snapshots",
  {
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
  },
  (table) => [index("audit_snapshots_case_created_at_idx").on(table.auditCaseId, table.createdAt)],
);

/**
 * One external-verification answer per Contract Party. Rows are append-only:
 * re-verifying a case appends rather than overwrites, so a reviewer can always
 * see which provider answers an earlier decision rested on.
 */
export const subjectVerifications = pgTable(
  "subject_verifications",
  {
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
  },
  (table) => [index("subject_verifications_audit_case_id_idx").on(table.auditCaseId)],
);

/**
 * One party-history lookup per Audit Case. Append-only like subject
 * verifications: the Bounded Audit Context records what earlier cases were
 * visible at audit time, so later seeding cannot rewrite a past decision.
 */
export const partyHistoryRecords = pgTable("party_history_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditCaseId: uuid("audit_case_id")
    .references(() => auditCases.id, { onDelete: "cascade" })
    .notNull(),
  payload: jsonb("payload").$type<PartyHistoryRun>().notNull(),
  evidence: jsonb("evidence").$type<EvidenceLocator[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
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
  },
  (table) => [index("agent_runs_audit_case_id_idx").on(table.auditCaseId)],
);

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
  (table) => [
    uniqueIndex("agent_trace_steps_run_sequence_idx").on(table.runId, table.sequence),
    index("agent_trace_steps_audit_case_id_idx").on(table.auditCaseId),
  ],
);

export const findingRevisions = pgTable(
  "finding_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditCaseId: uuid("audit_case_id")
      .references(() => auditCases.id)
      .notNull(),
    proposal: jsonb("proposal").$type<FindingProposal>().notNull(),
    supersedesId: uuid("supersedes_id"),
    review: jsonb("review").$type<HumanReview | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("finding_revisions_audit_case_id_idx").on(table.auditCaseId),
    index("finding_revisions_supersedes_id_idx").on(table.supersedesId),
  ],
);

// ── Rule governance ─────────────────────────────────────────────

export const ruleVersionStatuses = ["draft", "published", "retired"] as const;
export const validationRunStatuses = ["passed", "failed"] as const;

/**
 * The five shapes a Validation Case takes. `positive`/`negative` guard the two
 * directions of a rule's judgement (should fire / should not fire), `boundary`
 * pins exact thresholds and wording variants, `false_positive` is a confirmed
 * historical over-report, and `missing_evidence` is a case that defers to a
 * human by design (counted as neither pass nor fail).
 */
export const validationCaseTypes = [
  "positive",
  "negative",
  "boundary",
  "false_positive",
  "missing_evidence",
] as const;

export type RuleVersionStatus = (typeof ruleVersionStatuses)[number];
export type ValidationRunStatus = (typeof validationRunStatuses)[number];
export type ValidationCaseType = (typeof validationCaseTypes)[number];

/**
 * A rule version's parameter set: flat, primitive key-values only. The rule
 * logic itself stays in TypeScript — a version declares the numbers and
 * strings that logic reads, never the logic itself.
 */
export type RuleParams = Record<string, string | number | boolean>;

/**
 * The four negotiating stances a rule declares, each a human-readable Chinese
 * sentence. They document the commercial position behind a parameter set; any
 * of them may be empty when the rule has no stance on that rung.
 */
export interface RuleStances {
  preferred: string;
  acceptableRetreat: string;
  unacceptable: string;
  exceptionApproval: string;
}

/**
 * A deterministic审查规则. Identity lives on the rule; every deployment of its
 * parameters is a Rule Version, so a past assessment can cite exactly what it
 * ran under.
 */
export const rules = pgTable("rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  contractType: text("contract_type").notNull().default("全部"),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  disabledReason: text("disabled_reason"),
  disabledBy: text("disabled_by"),
  disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * One parameter set + stance set for a rule. A rule has at most one draft at a
 * time; publishing retires the current published version and promotes the
 * draft. Published versions are immutable — audit snapshots cite them.
 */
export const ruleVersions = pgTable(
  "rule_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .references(() => rules.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    params: jsonb("params").$type<RuleParams>().notNull().default({}),
    stances: jsonb("stances")
      .$type<RuleStances>()
      .notNull()
      .default({} as RuleStances),
    status: text("status", { enum: ruleVersionStatuses })
      .$type<RuleVersionStatus>()
      .notNull()
      .default("draft"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    /** The run that gated this version's publish. A plain id, not an FK: the run references the version back. */
    lastValidationRunId: uuid("last_validation_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("rule_versions_rule_version_idx").on(table.ruleId, table.version)],
);

/**
 * The record of one golden-set run against a rule version. Append-only: the
 * publish gate reads the newest run, and older runs remain as the quality
 * baseline that version was judged against.
 */
export const validationRuns = pgTable("validation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ruleVersionId: uuid("rule_version_id")
    .references(() => ruleVersions.id, { onDelete: "cascade" })
    .notNull(),
  ruleCode: text("rule_code").notNull(),
  triggeredBy: text("triggered_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }).notNull(),
  status: text("status", { enum: validationRunStatuses }).$type<ValidationRunStatus>().notNull(),
  /** Counts by case type plus totals. */
  summary: jsonb("summary").$type<ValidationSummary>().notNull(),
  /** One row per golden case, pass or fail. */
  details: jsonb("details").$type<ValidationCaseResult[]>().notNull(),
});

/**
 * The governance trail behind a rule: one append-only row per disable, enable
 * or publish. It is what the rule editor's 操作记录 tab reads, so a reviewer can
 * see who changed a rule's availability or promoted a version, when, and why.
 */
export const auditActionLogs = pgTable("audit_action_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ruleId: uuid("rule_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  actor: varchar("actor", { length: 64 }).notNull(),
  reason: text("reason"),
  /** The version a publish promoted; null for disable/enable. */
  versionId: uuid("version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A materialised golden case: the contract text plus the ground truth a rule
 * version is judged against. The canonical source is `golden-set.ts`; the seed
 * copies it here so a case can carry an operator-facing type (正例/反例/边界例/
 * 历史误报/证据缺失) and be filtered without recompiling.
 *
 * `name` mirrors the run detail's `caseName` exactly, which is what links a
 * run's per-case result back to its catalog row.
 */
export const validationCases = pgTable(
  "validation_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The rule this case labels. Code, not an FK: the golden set is canonical. */
    ruleCode: text("rule_code").notNull(),
    caseType: text("case_type", { enum: validationCaseTypes })
      .$type<ValidationCaseType>()
      .notNull(),
    name: text("name").notNull(),
    /** The contract body the rule runs over. */
    input: text("input").notNull(),
    expectedDisposition: text("expected_disposition").notNull(),
    expectedNote: text("expected_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("validation_cases_rule_name_idx").on(table.ruleCode, table.name)],
);

/**
 * One Remediation Item per accepted Finding Revision. An item is opened by the
 * review that accepts a finding and is the unit the 整改跟踪 board moves: it
 * remembers who owns the fix, when it is due, and — once a different reviewer
 * confirms it — who closed it.
 *
 * `findingRevisionId` is unique: accepting the same revision can never open a
 * second item, which makes the auto-create idempotent under retries.
 */
export const remediations = pgTable(
  "remediations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditCaseId: uuid("audit_case_id")
      .references(() => auditCases.id, { onDelete: "cascade" })
      .notNull(),
    findingRevisionId: uuid("finding_revision_id")
      .references(() => findingRevisions.id, { onDelete: "cascade" })
      .notNull(),
    summary: text("summary").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    owner: text("owner"),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    status: text("status", { enum: remediationStatuses })
      .$type<RemediationStatus>()
      .notNull()
      .default("pending"),
    progressNote: text("progress_note"),
    closedBy: text("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("remediations_finding_revision_idx").on(table.findingRevisionId)],
);

/**
 * One OpenAI-compatible模型服务 the audit agent can run on. The active row is
 * the config the next audit run uses; a partial unique index keeps at most one
 * row active so activation is a single flip rather than an ordering question.
 * Credentials live here so an operator can rotate them from the console — the
 * DTO reports only whether a key is set and its last four characters, never
 * the key itself.
 */
export const llmProviders = pgTable(
  "llm_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    endpoint: text("endpoint").notNull(),
    model: text("model").notNull(),
    apiKey: text("api_key").notNull(),
    maxInput: integer("max_input").notNull().default(128000),
    maxOutput: integer("max_output").notNull().default(4096),
    enabled: boolean("enabled").notNull().default(true),
    /** The row the runtime reads; at most one — see the partial index below. */
    isActive: boolean("is_active").notNull().default(false),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "date" }),
    lastCheckOk: boolean("last_check_ok"),
    lastCheckError: text("last_check_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("llm_providers_active_idx").on(table.isActive).where(sql`${table.isActive}`),
  ],
);

export const schema = {
  sourceRecords,
  auditCases,
  auditSnapshots,
  agentRuns,
  agentTraceSteps,
  findingRevisions,
  remediations,
  subjectVerifications,
  partyHistoryRecords,
  rules,
  ruleVersions,
  validationRuns,
  validationCases,
  auditActionLogs,
  llmProviders,
};

export type SourceRecord = InferSelectModel<typeof sourceRecords>;
export type AuditCaseRow = InferSelectModel<typeof auditCases>;
export type AuditSnapshotRow = InferSelectModel<typeof auditSnapshots>;
export type AgentRunRow = InferSelectModel<typeof agentRuns>;
export type AgentTraceStepRow = InferSelectModel<typeof agentTraceSteps>;
export type FindingRevisionRow = InferSelectModel<typeof findingRevisions>;
export type RemediationRow = InferSelectModel<typeof remediations>;
export type SubjectVerificationRow = InferSelectModel<typeof subjectVerifications>;
export type PartyHistoryRecordRow = InferSelectModel<typeof partyHistoryRecords>;
export type RuleRow = InferSelectModel<typeof rules>;
export type RuleVersionRow = InferSelectModel<typeof ruleVersions>;
export type ValidationRunRow = InferSelectModel<typeof validationRuns>;
export type ValidationCaseRow = InferSelectModel<typeof validationCases>;
export type AuditActionLogRow = InferSelectModel<typeof auditActionLogs>;
export type LlmProviderRow = InferSelectModel<typeof llmProviders>;

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
  remediations: many(remediations),
}));
export const remediationsRelations = relations(remediations, ({ one }) => ({
  auditCase: one(auditCases, {
    fields: [remediations.auditCaseId],
    references: [auditCases.id],
  }),
  findingRevision: one(findingRevisions, {
    fields: [remediations.findingRevisionId],
    references: [findingRevisions.id],
  }),
}));
export const agentRunsRelations = relations(agentRuns, ({ many }) => ({
  steps: many(agentTraceSteps),
}));
export const rulesRelations = relations(rules, ({ many }) => ({
  versions: many(ruleVersions),
}));
export const ruleVersionsRelations = relations(ruleVersions, ({ one, many }) => ({
  rule: one(rules, { fields: [ruleVersions.ruleId], references: [rules.id] }),
  validationRuns: many(validationRuns),
}));
export const validationRunsRelations = relations(validationRuns, ({ one }) => ({
  ruleVersion: one(ruleVersions, {
    fields: [validationRuns.ruleVersionId],
    references: [ruleVersions.id],
  }),
}));
