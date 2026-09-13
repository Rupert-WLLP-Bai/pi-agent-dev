import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type {
  AgentRun,
  AgentRunTrace,
  AgentTraceStep,
  AuditCase,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  ContractParty,
  EvidenceLocator,
  FindingProposal,
  FindingRevision,
  HumanReview,
  Severity,
  SourceProvenance,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { AgentRunIdentity, ReviewPriority } from "@contract-audit/audit/ports";
import type { SubjectVerificationRun } from "@contract-audit/audit/subject-verification";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  agentRuns,
  agentTraceSteps,
  auditCases,
  auditSnapshots,
  findingRevisions,
  schema,
  sourceRecords,
  subjectVerifications,
} from "./schema";

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

type DateLike = Date | string;
const asDate = (value: DateLike): Date => (value instanceof Date ? value : new Date(value));

/**
 * Derives a display title from a contract document's first block.
 *
 * Evaluation fixtures frequently start with a clause rather than a heading, so
 * the first block is only accepted when it reads like a title: short and not a
 * finished sentence. Callers fall back to an explicit "unnamed" label so a
 * clause is never presented as the contract's name.
 */
export function contractTitleFromFirstBlock(firstBlock: string | null | undefined): string | null {
  if (firstBlock === null || firstBlock === undefined) return null;
  const candidate = firstBlock.trim();
  if (candidate.length === 0 || candidate.length > 40) return null;
  if (/[。；;！!？?]$/.test(candidate)) return null;
  return candidate;
}

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

const severityByRank: Record<number, Severity> = { 3: "HIGH", 2: "MEDIUM", 1: "LOW" };

const severityOrder: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Queue order: evidence conflicts first (a human must intervene), then the
 * worst severity, then the soonest deadline. Shared with the web client's own
 * sort so the server's order and a re-sort converge on the same list.
 */
export function compareReviewQueueItems(left: ReviewQueueItem, right: ReviewQueueItem): number {
  if (left.evidenceConflict !== right.evidenceConflict) return left.evidenceConflict ? -1 : 1;
  const leftRank = left.severity === null ? 0 : severityOrder[left.severity];
  const rightRank = right.severity === null ? 0 : severityOrder[right.severity];
  if (leftRank !== rightRank) return rightRank - leftRank;
  return Date.parse(left.dueAt) - Date.parse(right.dueAt);
}

const toReviewPriority = (value: string | null): ReviewPriority | null =>
  value === "high" || value === "normal" || value === "low" ? value : null;

const toSeverity = (value: string | null): Severity | null => {
  const rank = value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : value === "LOW" ? 1 : 0;
  return severityByRank[rank] ?? null;
};

/**
 * Rebuilds provenance from Source Record metadata. Records written before
 * provenance was tracked carry no type, and an unrecognised value is treated
 * the same way: the honest answer is "unknown", never a guessed channel.
 */
const toSourceProvenance = (
  type: string | null,
  displayName: string | null,
): SourceProvenance | null => {
  if (type !== "TEXT_PASTE" && type !== "FILE_UPLOAD" && type !== "DEMO") return null;
  return { type, displayName: displayName && displayName.length > 0 ? displayName : null };
};

const toCase = (row: typeof auditCases.$inferSelect): AuditCase => ({
  id: row.id,
  status: row.status,
  stage: row.stage,
  sourceRecordId: row.sourceRecordId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toSnapshot = (row: typeof auditSnapshots.$inferSelect): AuditSnapshot => ({
  sourceRecordId: row.sourceRecordId,
  contractDocument: row.document as AuditSnapshot["contractDocument"],
  facts: row.facts as AuditSnapshot["facts"],
  parties: row.parties as AuditSnapshot["parties"],
  evidence: row.evidence as AuditSnapshot["evidence"],
  ruleAssessments: row.ruleAssessments as AuditSnapshot["ruleAssessments"],
  createdAt: row.createdAt.toISOString(),
});

const toAgentRun = (row: typeof agentRuns.$inferSelect): AgentRun => ({
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

const toTraceStep = (row: typeof agentTraceSteps.$inferSelect): AgentTraceStep => ({
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

const toFinding = (row: typeof findingRevisions.$inferSelect): FindingRevision => ({
  id: row.id,
  auditCaseId: row.auditCaseId,
  proposal: row.proposal,
  supersedesId: row.supersedesId,
  review: row.review,
  createdAt: row.createdAt.toISOString(),
});

export class AuditCaseRepository {
  constructor(private readonly db: DrizzleDB) {}

  async createPendingCase(
    sourceRecordId: string,
    snapshot: AuditSnapshot,
    provenance: SourceProvenance | null = null,
  ): Promise<{ caseId: string; snapshotId: string }> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(sourceRecords)
        .values({
          id: sourceRecordId,
          sourceText: snapshot.contractDocument.blocks.map((block) => block.text).join("\n"),
          metadata: {
            contractDocumentHash: snapshot.contractDocument.hash,
            ...(provenance === null
              ? {}
              : { sourceType: provenance.type, sourceDisplayName: provenance.displayName }),
          },
        })
        .onConflictDoNothing({ target: sourceRecords.id });

      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          sourceRecordId,
          status: "PENDING",
          stage: "QUEUED",
        })
        .returning({ id: auditCases.id });

      const [auditSnapshot] = await tx
        .insert(auditSnapshots)
        .values({
          auditCaseId: auditCase.id,
          sourceRecordId,
          document: snapshot.contractDocument,
          facts: snapshot.facts,
          parties: snapshot.parties,
          policy: null,
          evidence: snapshot.evidence,
          ruleAssessments: snapshot.ruleAssessments,
          createdAt: asDate(snapshot.createdAt),
        })
        .returning({ id: auditSnapshots.id });

      return { caseId: auditCase.id, snapshotId: auditSnapshot.id };
    });
  }

  async claimNextPendingCase(): Promise<{ caseId: string; snapshotId: string } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ case_id: string; snapshot_id: string }>(sql`
        SELECT c.id AS case_id, s.id AS snapshot_id
        FROM audit_cases c
        INNER JOIN audit_snapshots s ON s.audit_case_id = c.id
        WHERE c.status = 'PENDING'
        ORDER BY c.created_at ASC
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);
      const row = rows[0];
      if (!row) return null;

      await tx
        .update(auditCases)
        .set({ status: "RUNNING", updatedAt: new Date() })
        .where(eq(auditCases.id, row.case_id));
      return { caseId: row.case_id, snapshotId: row.snapshot_id };
    });
  }

  async claimCase(auditCaseId: string): Promise<{ caseId: string; snapshotId: string } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ case_id: string; snapshot_id: string }>(sql`
        SELECT c.id AS case_id, s.id AS snapshot_id
        FROM audit_cases c
        INNER JOIN audit_snapshots s ON s.audit_case_id = c.id
        WHERE c.id = ${auditCaseId} AND c.status = 'PENDING'
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);
      const row = rows[0];
      if (!row) return null;

      await tx
        .update(auditCases)
        .set({ status: "RUNNING", updatedAt: new Date() })
        .where(eq(auditCases.id, row.case_id));
      return { caseId: row.case_id, snapshotId: row.snapshot_id };
    });
  }

  async getPendingCaseIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: auditCases.id })
      .from(auditCases)
      .where(eq(auditCases.status, "PENDING"))
      .orderBy(auditCases.createdAt);
    return rows.map((row) => row.id);
  }

  async getCase(caseId: string): Promise<AuditCase | null> {
    const [row] = await this.db.select().from(auditCases).where(eq(auditCases.id, caseId)).limit(1);
    return row ? toCase(row) : null;
  }

  async getSnapshot(snapshotId: string): Promise<AuditSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(auditSnapshots)
      .where(eq(auditSnapshots.id, snapshotId))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  /**
   * Opens an Agent Run before the agent starts.
   *
   * The run row has to exist up front because trace steps reference it — and a
   * trace is most useful while the run is still in flight, not only after it
   * ends. `finishAgentRun` closes it with the outcome.
   */
  async beginAgentRun(input: { auditCaseId: string } & AgentRunIdentity): Promise<string> {
    const [row] = await this.db
      .insert(agentRuns)
      .values({
        auditCaseId: input.auditCaseId,
        provider: input.provider,
        model: input.model,
        version: input.version,
      })
      .returning({ id: agentRuns.id });
    return row.id;
  }

  /** Closes a run. Usage, duration and error are only known once it is over. */
  async finishAgentRun(
    runId: string,
    input: {
      usage: Record<string, number> | null;
      durationMs: number | null;
      error: string | null;
    },
  ): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({ usage: input.usage, durationMs: input.durationMs, error: input.error })
      .where(eq(agentRuns.id, runId));
  }

  /**
   * Records one trace step. A step is identified by (run, sequence), so a
   * repeated write is ignored rather than duplicating the trace.
   */
  async appendAgentTraceStep(auditCaseId: string, step: AgentTraceStep): Promise<void> {
    await this.db
      .insert(agentTraceSteps)
      .values({
        runId: step.runId,
        auditCaseId,
        sequence: step.sequence,
        kind: step.kind,
        at: new Date(step.at),
        label: step.label,
        ref: step.ref,
        input: step.input,
        output: step.output,
        isError: step.isError,
        durationMs: step.durationMs,
        tokens: step.tokens,
      })
      .onConflictDoNothing();
  }

  /** Every run for a case, newest first, each with its steps in execution order. */
  async getTracesByCase(caseId: string): Promise<AgentRunTrace[]> {
    const runs = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.auditCaseId, caseId))
      .orderBy(desc(agentRuns.createdAt));
    if (runs.length === 0) return [];

    const stepRows = await this.db
      .select()
      .from(agentTraceSteps)
      .where(eq(agentTraceSteps.auditCaseId, caseId))
      .orderBy(agentTraceSteps.runId, agentTraceSteps.sequence);

    const stepsByRun = new Map<string, AgentTraceStep[]>();
    for (const row of stepRows) {
      const steps = stepsByRun.get(row.runId) ?? [];
      steps.push(toTraceStep(row));
      stepsByRun.set(row.runId, steps);
    }

    return runs.map((row) => ({
      run: toAgentRun(row),
      steps: stepsByRun.get(row.id) ?? [],
    }));
  }

  /** Recent runs across every case, newest first. Powers the trace index page. */
  async getRecentRuns(limit: number): Promise<AgentRunSummary[]> {
    const runs = await this.db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);
    if (runs.length === 0) return [];

    const caseIds = [...new Set(runs.map((run) => run.auditCaseId))];
    const caseRows = await this.db
      .select({
        id: auditCases.id,
        status: auditCases.status,
        firstBlock: sql<string | null>`${auditSnapshots.document}->'blocks'->0->>'text'`,
        parties: auditSnapshots.parties,
      })
      .from(auditCases)
      .leftJoin(auditSnapshots, eq(auditSnapshots.auditCaseId, auditCases.id))
      .where(inArray(auditCases.id, caseIds));
    const caseById = new Map(caseRows.map((row) => [row.id, row]));

    const countRows = await this.db
      .select({ runId: agentTraceSteps.runId, stepCount: count() })
      .from(agentTraceSteps)
      .where(
        inArray(
          agentTraceSteps.runId,
          runs.map((run) => run.id),
        ),
      )
      .groupBy(agentTraceSteps.runId);
    const countByRun = new Map(countRows.map((row) => [row.runId, Number(row.stepCount)]));

    return runs.map((row) => {
      const auditCase = caseById.get(row.auditCaseId);
      return {
        ...toAgentRun(row),
        contractTitle: contractTitleFromFirstBlock(auditCase?.firstBlock),
        parties: (auditCase?.parties ?? []) as ContractParty[],
        caseStatus: (auditCase?.status ?? "PENDING") as AuditCaseStatus,
        stepCount: countByRun.get(row.id) ?? 0,
      };
    });
  }

  async appendFindingRevision(
    auditCaseId: string,
    proposal: FindingProposal,
    supersedesId: string | null,
  ): Promise<string> {
    const [row] = await this.db
      .insert(findingRevisions)
      .values({ auditCaseId, proposal, supersedesId })
      .returning({ id: findingRevisions.id });
    return row.id;
  }

  /**
   * Records a human review as a new append-only revision that supersedes the
   * reviewed proposal. The original row is never overwritten.
   */
  async appendReviewRevision(findingId: string, review: HumanReview): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(findingRevisions)
        .where(eq(findingRevisions.id, findingId))
        .limit(1);
      if (!existing) throw new Error(`FINDING_NOT_FOUND: ${findingId}`);
      if (existing.review !== null) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);
      const [superseder] = await tx
        .select({ id: findingRevisions.id })
        .from(findingRevisions)
        .where(eq(findingRevisions.supersedesId, findingId))
        .limit(1);
      if (superseder) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);

      const [row] = await tx
        .insert(findingRevisions)
        .values({
          auditCaseId: existing.auditCaseId,
          proposal: existing.proposal,
          supersedesId: findingId,
          review,
        })
        .returning({ id: findingRevisions.id });
      return row.id;
    });
  }

  async markStaleRunsInterrupted(): Promise<number> {
    const rows = await this.db
      .update(auditCases)
      .set({ status: "INTERRUPTED", stage: "INTERRUPTED", updatedAt: new Date() })
      .where(eq(auditCases.status, "RUNNING"))
      .returning({ id: auditCases.id });
    return rows.length;
  }

  async updateCaseStatus(
    caseId: string,
    status: AuditCaseStatus,
    stage: AuditStage,
  ): Promise<void> {
    await this.db
      .update(auditCases)
      .set({ status, stage, updatedAt: new Date() })
      .where(eq(auditCases.id, caseId));
  }

  /**
   * Sets the review assignee and/or priority. An omitted key leaves the field
   * untouched; an explicit null clears it, which is how a transfer back to the
   * shared queue is expressed.
   */
  async setCaseAssignment(
    caseId: string,
    input: { assignee?: string | null; priority?: ReviewPriority | null },
  ): Promise<{ assignee: string | null; priority: ReviewPriority | null }> {
    const patch: Partial<typeof auditCases.$inferInsert> = { updatedAt: new Date() };
    if (input.assignee !== undefined) patch.assignee = input.assignee;
    if (input.priority !== undefined) patch.reviewPriority = input.priority;
    const [row] = await this.db
      .update(auditCases)
      .set(patch)
      .where(eq(auditCases.id, caseId))
      .returning({ assignee: auditCases.assignee, reviewPriority: auditCases.reviewPriority });
    return {
      assignee: row?.assignee ?? null,
      priority: toReviewPriority(row?.reviewPriority ?? null),
    };
  }

  /**
   * Completes the case once every chain-head finding carries a Human Review.
   * Returns true only on the call that performed the transition, so the caller
   * publishes `audit.completed` exactly once.
   *
   * A case with no chain-head finding at all is left alone: it either never
   * entered review or completed through the no-finding path, and neither is a
   * transition this method should make.
   */
  async completeCaseIfAllFindingsReviewed(caseId: string): Promise<boolean> {
    const rows = await this.db.execute<{ total: number; unreviewed: number }>(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE f.review IS NULL)::int AS unreviewed
      FROM finding_revisions f
      WHERE f.audit_case_id = ${caseId}
        -- Chain heads only: a revision superseded by a newer one is history.
        AND NOT EXISTS (SELECT 1 FROM finding_revisions s WHERE s.supersedes_id = f.id)
    `);
    const total = rows[0]?.total ?? 0;
    const unreviewed = rows[0]?.unreviewed ?? 0;
    if (total === 0 || unreviewed > 0) return false;

    await this.updateCaseStatus(caseId, "COMPLETED", "COMPLETED");
    return true;
  }

  async getFindingsByCase(caseId: string): Promise<FindingRevision[]> {
    const rows = await this.db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.auditCaseId, caseId))
      // Worst first: a case can carry several findings from one run, and the
      // workbench opens on the first one. Recency alone would surface whichever
      // dimension happened to be written last instead of the one that matters.
      .orderBy(
        sql`CASE ${findingRevisions.proposal}->>'severity' WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC`,
        desc(findingRevisions.createdAt),
      );
    // Append-only revisions: expose only chain heads (revisions that are not
    // superseded by a newer revision), each carrying its latest review state.
    const supersededIds = new Set(
      rows.flatMap((row) => (row.supersedesId === null ? [] : [row.supersedesId])),
    );
    return rows.filter((row) => !supersededIds.has(row.id)).map(toFinding);
  }

  async getCases(): Promise<AuditCase[]> {
    const rows = await this.db.select().from(auditCases).orderBy(desc(auditCases.createdAt));
    return rows.map(toCase);
  }

  async getSnapshotByCase(caseId: string): Promise<AuditSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(auditSnapshots)
      .where(eq(auditSnapshots.auditCaseId, caseId))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  /**
   * Records one verification pass. Rows are append-only: an earlier decision can
   * always be traced back to the provider answer it rested on, and re-verifying
   * a case adds a generation rather than rewriting history.
   */
  async saveSubjectVerifications(caseId: string, run: SubjectVerificationRun): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const record of run.sourceRecords) {
        await tx.insert(sourceRecords).values({
          id: record.id,
          // A failed provider call still gets a Source Record so the attempt is
          // auditable; the failure reason then stands in for the payload text.
          sourceText: record.outcome.summary || record.outcome.failureReason || "",
          metadata: {
            provider: record.provider,
            tool: record.tool,
            subject: record.subject,
            status: record.outcome.status,
            matched: record.outcome.matched,
            candidates: record.outcome.candidates,
            dimensions: record.outcome.dimensions,
            capturedAt: record.outcome.capturedAt,
            expiresAt: record.outcome.expiresAt,
            failureReason: record.outcome.failureReason,
          },
        });
      }

      for (const verification of run.verifications) {
        await tx.insert(subjectVerifications).values({
          auditCaseId: caseId,
          partyId: verification.partyId,
          status: verification.status,
          sourceRecordId: verification.sourceRecordId,
          payload: verification,
          evidence: run.evidence.filter((item) => verification.evidenceIds.includes(item.id)),
        });
      }
    });
  }

  /** Latest verification generation per party, plus the evidence it cites. */
  async getSubjectDimension(caseId: string): Promise<{
    verifications: SubjectVerification[];
    evidence: EvidenceLocator[];
  }> {
    const rows = await this.db
      .select()
      .from(subjectVerifications)
      .where(eq(subjectVerifications.auditCaseId, caseId))
      .orderBy(subjectVerifications.createdAt);

    // Evidence ids are stable across generations, so reading every row would
    // return the same id twice with different capture times. Only the newest
    // generation per party may surface.
    const latestByParty = new Map<string, (typeof rows)[number]>();
    for (const row of rows) latestByParty.set(row.partyId, row);
    const latestRows = [...latestByParty.values()];

    const verifications = latestRows.map((row) => row.payload);
    const cited = new Set(verifications.flatMap((item) => item.evidenceIds));
    const evidenceById = new Map<string, EvidenceLocator>();
    for (const row of latestRows) {
      for (const item of row.evidence) {
        if (cited.has(item.id)) evidenceById.set(item.id, item);
      }
    }

    return { verifications, evidence: [...evidenceById.values()] };
  }

  async getFinding(findingId: string): Promise<FindingRevision | null> {
    const [row] = await this.db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.id, findingId))
      .limit(1);
    return row ? toFinding(row) : null;
  }

  async ping(): Promise<boolean> {
    const rows = await this.db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
    return rows.length > 0;
  }

  async getCasesWithContractTitle(): Promise<CaseSummary[]> {
    const rows = await this.db.execute<{
      id: string;
      status: string;
      stage: string;
      source_record_id: string;
      source_type: string | null;
      source_display_name: string | null;
      created_at: string | Date;
      updated_at: string | Date;
      contract_title: string | null;
      finding_count: number;
      highest_severity: string | null;
      subject_red_line_count: number;
    }>(sql`
      SELECT c.id, c.status, c.stage, c.source_record_id, c.created_at, c.updated_at,
             s.document->'blocks'->0->>'text' AS contract_title,
             src.metadata->>'sourceType' AS source_type,
             src.metadata->>'sourceDisplayName' AS source_display_name,
             COALESCE(h.finding_count, 0)::int AS finding_count,
             h.highest_severity,
             COALESCE(sr.subject_red_line_count, 0)::int AS subject_red_line_count
      FROM audit_cases c
      LEFT JOIN source_records src ON src.id = c.source_record_id
      LEFT JOIN audit_snapshots s ON s.audit_case_id = c.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS finding_count,
               (ARRAY_AGG(f.proposal->>'severity' ORDER BY
                  CASE f.proposal->>'severity'
                    WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC))[1]
                 AS highest_severity
        FROM finding_revisions f
        WHERE f.audit_case_id = c.id
          -- Chain heads only: a revision superseded by a newer one is history.
          AND NOT EXISTS (SELECT 1 FROM finding_revisions s2 WHERE s2.supersedes_id = f.id)
      ) h ON true
      LEFT JOIN LATERAL (
        -- Latest verification generation per party, then count its red-line
        -- dimensions; superseded generations never contribute.
        SELECT COUNT(*)::int AS subject_red_line_count
        FROM (
          SELECT DISTINCT ON (v.party_id) v.payload
          FROM subject_verifications v
          WHERE v.audit_case_id = c.id
          ORDER BY v.party_id, v.created_at DESC
        ) latest
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(latest.payload->'dimensions', '[]'::jsonb)
        ) AS d(dimension)
        WHERE latest.payload->>'status' = 'RESOLVED'
          AND d.dimension->>'severity' = 'RED_LINE'
          AND (d.dimension->>'count')::int > 0
      ) sr ON true
      ORDER BY c.created_at DESC
    `);
    const toDate = (v: string | Date): string =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();
    return rows.map((row) => ({
      id: row.id,
      status: row.status as AuditCase["status"],
      stage: row.stage as AuditCase["stage"],
      sourceRecordId: row.source_record_id,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      contractTitle: contractTitleFromFirstBlock(row.contract_title),
      findingCount: row.finding_count,
      highestSeverity: toSeverity(row.highest_severity),
      subjectRedLineCount: row.subject_red_line_count,
      sourceProvenance: toSourceProvenance(row.source_type, row.source_display_name),
    }));
  }

  /**
   * Review queue: one row per chain-head finding on a case awaiting review.
   *
   * Evidence conflicts are findings whose underlying rule asked for human
   * input (NEEDS_HUMAN_REVIEW) or that cite no evidence; they sort first
   * because a reviewer, not the machine, has to settle them. The SLA deadline
   * is `created_at + slaHours`, derived here so it tracks the configured
   * window instead of a value frozen into the row.
   */
  async getReviewQueue(options: { slaHours: number; now?: Date }): Promise<ReviewQueueItem[]> {
    const rows = await this.db.execute<{
      case_id: string;
      assignee: string | null;
      review_priority: string | null;
      created_at: string | Date;
      updated_at: string | Date;
      contract_title: string | null;
      finding_id: string;
      finding_type: string;
      severity: string | null;
      evidence_count: number;
      needs_review_conflict: boolean;
    }>(sql`
      SELECT c.id AS case_id,
             c.assignee,
             c.review_priority,
             c.created_at,
             c.updated_at,
             s.document->'blocks'->0->>'text' AS contract_title,
             f.id AS finding_id,
             f.proposal->>'findingType' AS finding_type,
             f.proposal->>'severity' AS severity,
             COALESCE(jsonb_array_length(COALESCE(f.proposal->'evidenceIds', '[]'::jsonb)), 0)::int
               AS evidence_count,
             EXISTS (
               SELECT 1
               -- Snapshots written before rule assessments became an array
               -- store a single object under the same column; both shapes are
               -- read so the queue never crashes on an older row.
               FROM jsonb_array_elements(
                 CASE jsonb_typeof(s.rule_assessment)
                   WHEN 'array' THEN s.rule_assessment
                   WHEN 'object' THEN jsonb_build_array(s.rule_assessment)
                   ELSE '[]'::jsonb
                 END
               ) AS a
               WHERE a->>'disposition' = 'NEEDS_HUMAN_REVIEW'
                 AND a->'evidenceIds' ?| ARRAY(
                   SELECT jsonb_array_elements_text(
                     COALESCE(f.proposal->'evidenceIds', '[]'::jsonb)
                   )
                 )
             ) AS needs_review_conflict
      FROM audit_cases c
      INNER JOIN finding_revisions f
        ON f.audit_case_id = c.id
       AND NOT EXISTS (SELECT 1 FROM finding_revisions newer WHERE newer.supersedes_id = f.id)
      LEFT JOIN audit_snapshots s ON s.audit_case_id = c.id
      WHERE c.stage = 'AWAITING_REVIEW'
    `);
    const now = options.now ?? new Date();
    const items = rows.map((row): ReviewQueueItem => {
      const dueMs = asDate(row.created_at).getTime() + options.slaHours * 3_600_000;
      return {
        caseId: row.case_id,
        contractTitle: contractTitleFromFirstBlock(row.contract_title) ?? "未命名合同",
        findingId: row.finding_id,
        findingType: row.finding_type,
        title: getFindingTypeLabel(row.finding_type),
        severity: toSeverity(row.severity),
        evidenceConflict:
          row.evidence_count === 0 ||
          row.finding_type === "NEEDS_HUMAN_REVIEW" ||
          row.needs_review_conflict,
        assignee: row.assignee,
        priority: toReviewPriority(row.review_priority),
        dueAt: new Date(dueMs).toISOString(),
        remainingMs: dueMs - now.getTime(),
        updatedAt: asDate(row.updated_at).toISOString(),
      };
    });
    return items.sort(compareReviewQueueItems);
  }

  /**
   * Dashboard aggregates. Every number is derived from stored rows; nothing is
   * projected from constants. Findings are counted at chain head only, and the
   * daily series covers the last 30 days regardless of activity.
   */
  async getOverview(): Promise<AuditOverview> {
    const caseRow = await this.db.execute<{
      total_cases: number;
      awaiting_review: number;
      reached_review: number;
    }>(sql`
      SELECT COUNT(*)::int AS total_cases,
             COUNT(*) FILTER (WHERE c.stage = 'AWAITING_REVIEW')::int AS awaiting_review,
             COUNT(*) FILTER (WHERE c.stage IN ('AWAITING_REVIEW', 'COMPLETED'))::int AS reached_review
      FROM audit_cases c
    `);

    const dailyRows = await this.db.execute<{ date: string; count: number }>(sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COUNT(c.id)::int AS count
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS d(day)
      LEFT JOIN audit_cases c
        ON c.created_at >= d.day AND c.created_at < d.day + INTERVAL '1 day'
      GROUP BY d.day
      ORDER BY d.day
    `);

    const findingRows = await this.db.execute<{
      finding_type: string;
      count: number;
      accepted: number;
      rejected: number;
      cited: number;
    }>(sql`
      SELECT f.proposal->>'findingType' AS finding_type,
             COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE f.review->>'decision' = 'ACCEPTED')::int AS accepted,
             COUNT(*) FILTER (WHERE f.review->>'decision' = 'REJECTED')::int AS rejected,
             COUNT(*) FILTER (
               WHERE jsonb_array_length(COALESCE(f.proposal->'evidenceIds', '[]'::jsonb)) > 0
             )::int AS cited
      FROM finding_revisions f
      WHERE NOT EXISTS (SELECT 1 FROM finding_revisions s2 WHERE s2.supersedes_id = f.id)
      GROUP BY 1
    `);

    const runRow = await this.db.execute<{
      median_ms: number | null;
      successful_runs: number;
    }>(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY r.duration_ms) AS median_ms,
             COUNT(*)::int AS successful_runs
      FROM agent_runs r
      -- A run that reported no token usage never reached a provider, so its
      -- wall time measures a scheduling attempt, not an audit. Counting those
      -- drags the median down to whatever the harness overhead happens to be.
      WHERE r.error IS NULL AND r.duration_ms IS NOT NULL AND r.usage IS NOT NULL
    `);

    const pendingRows = await this.db.execute<{
      id: string;
      title: string | null;
      updated_at: string | Date;
      highest_severity: string | null;
    }>(sql`
      SELECT c.id, s.document->'blocks'->0->>'text' AS title, c.updated_at,
             (SELECT f.proposal->>'severity'
              FROM finding_revisions f
              WHERE f.audit_case_id = c.id
                AND NOT EXISTS (SELECT 1 FROM finding_revisions s2 WHERE s2.supersedes_id = f.id)
              ORDER BY CASE f.proposal->>'severity'
                WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC
              LIMIT 1) AS highest_severity
      FROM audit_cases c
      LEFT JOIN audit_snapshots s ON s.audit_case_id = c.id
      WHERE c.stage = 'AWAITING_REVIEW'
      ORDER BY c.updated_at DESC
      LIMIT 8
    `);

    const toDate = (v: string | Date): string =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();

    return {
      totalCases: caseRow[0]?.total_cases ?? 0,
      awaitingReview: caseRow[0]?.awaiting_review ?? 0,
      reachedReview: caseRow[0]?.reached_review ?? 0,
      dailyCounts: dailyRows.map((row) => ({ date: row.date, count: row.count })),
      findingsByType: findingRows.map((row) => ({
        findingType: row.finding_type,
        count: row.count,
      })),
      acceptedFindings: findingRows.reduce((sum, row) => sum + row.accepted, 0),
      rejectedFindings: findingRows.reduce((sum, row) => sum + row.rejected, 0),
      citedFindings: findingRows.reduce((sum, row) => sum + row.cited, 0),
      chainHeadFindings: findingRows.reduce((sum, row) => sum + row.count, 0),
      medianAgentDurationMs: runRow[0]?.median_ms ?? null,
      successfulAgentRuns: runRow[0]?.successful_runs ?? 0,
      pendingReview: pendingRows.map((row) => ({
        id: row.id,
        title: contractTitleFromFirstBlock(row.title),
        updatedAt: toDate(row.updated_at),
        highestSeverity: toSeverity(row.highest_severity),
      })),
    };
  }
}
export function createRepository(databaseUrl: string): AuditCaseRepository {
  const client = postgres(databaseUrl);
  return new AuditCaseRepository(drizzle({ client, schema }));
}
