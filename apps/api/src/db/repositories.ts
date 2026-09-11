import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  AgentRun,
  AuditCase,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  FindingProposal,
  FindingRevision,
  HumanReview,
} from "@contract-audit/audit/model";
import { agentRuns, auditCases, auditSnapshots, findingRevisions, schema, sourceRecords } from "./schema";

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

type DateLike = Date | string;
const asDate = (value: DateLike): Date => value instanceof Date ? value : new Date(value);

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
  evidence: row.evidence as AuditSnapshot["evidence"],
  ruleAssessment: row.ruleAssessment as AuditSnapshot["ruleAssessment"],
  createdAt: row.createdAt.toISOString(),
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

  async createPendingCase(sourceRecordId: string, snapshot: AuditSnapshot): Promise<{ caseId: string; snapshotId: string }> {
    return this.db.transaction(async (tx) => {
      await tx.insert(sourceRecords).values({
        id: sourceRecordId,
        sourceText: snapshot.contractDocument.blocks.map((block) => block.text).join("\n"),
        metadata: { contractDocumentHash: snapshot.contractDocument.hash },
      }).onConflictDoNothing({ target: sourceRecords.id });

      const [auditCase] = await tx.insert(auditCases).values({
        sourceRecordId,
        status: "PENDING",
        stage: "QUEUED",
      }).returning({ id: auditCases.id });

      const [auditSnapshot] = await tx.insert(auditSnapshots).values({
        auditCaseId: auditCase.id,
        sourceRecordId,
        document: snapshot.contractDocument,
        facts: snapshot.facts,
        policy: null,
        evidence: snapshot.evidence,
        ruleAssessment: snapshot.ruleAssessment,
        createdAt: asDate(snapshot.createdAt),
      }).returning({ id: auditSnapshots.id });

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

      await tx.update(auditCases).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(auditCases.id, row.case_id));
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

      await tx.update(auditCases).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(auditCases.id, row.case_id));
      return { caseId: row.case_id, snapshotId: row.snapshot_id };
    });
  }

  async getPendingCaseIds(): Promise<string[]> {
    const rows = await this.db.select({ id: auditCases.id }).from(auditCases)
      .where(eq(auditCases.status, "PENDING"))
      .orderBy(auditCases.createdAt);
    return rows.map((row) => row.id);
  }

  async getCase(caseId: string): Promise<AuditCase | null> {
    const [row] = await this.db.select().from(auditCases).where(eq(auditCases.id, caseId)).limit(1);
    return row ? toCase(row) : null;
  }

  async getSnapshot(snapshotId: string): Promise<AuditSnapshot | null> {
    const [row] = await this.db.select().from(auditSnapshots).where(eq(auditSnapshots.id, snapshotId)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async completeAgentRun(run: Omit<AgentRun, "id" | "createdAt">): Promise<string> {
    const [row] = await this.db.insert(agentRuns).values({
      auditCaseId: run.auditCaseId,
      provider: run.provider,
      model: run.model,
      version: run.version,
      usage: run.usage,
      durationMs: run.durationMs,
      error: run.error,
    }).returning({ id: agentRuns.id });
    return row.id;
  }

  async appendFindingRevision(auditCaseId: string, proposal: FindingProposal, supersedesId: string | null): Promise<string> {
    const [row] = await this.db.insert(findingRevisions).values({ auditCaseId, proposal, supersedesId }).returning({ id: findingRevisions.id });
    return row.id;
  }

  /**
   * Records a human review as a new append-only revision that supersedes the
   * reviewed proposal. The original row is never overwritten.
   */
  async appendReviewRevision(findingId: string, review: HumanReview): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(findingRevisions).where(eq(findingRevisions.id, findingId)).limit(1);
      if (!existing) throw new Error(`FINDING_NOT_FOUND: ${findingId}`);
      if (existing.review !== null) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);
      const [superseder] = await tx.select({ id: findingRevisions.id }).from(findingRevisions)
        .where(eq(findingRevisions.supersedesId, findingId)).limit(1);
      if (superseder) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);

      const [row] = await tx.insert(findingRevisions).values({
        auditCaseId: existing.auditCaseId,
        proposal: existing.proposal,
        supersedesId: findingId,
        review,
      }).returning({ id: findingRevisions.id });
      return row.id;
    });
  }

  async markStaleRunsInterrupted(): Promise<number> {
    const rows = await this.db.update(auditCases)
      .set({ status: "INTERRUPTED", stage: "INTERRUPTED", updatedAt: new Date() })
      .where(eq(auditCases.status, "RUNNING"))
      .returning({ id: auditCases.id });
    return rows.length;
  }

  async updateCaseStatus(caseId: string, status: AuditCaseStatus, stage: AuditStage): Promise<void> {
    await this.db.update(auditCases).set({ status, stage, updatedAt: new Date() }).where(eq(auditCases.id, caseId));
  }

  async getFindingsByCase(caseId: string): Promise<FindingRevision[]> {
    const rows = await this.db.select().from(findingRevisions)
      .where(eq(findingRevisions.auditCaseId, caseId))
      .orderBy(desc(findingRevisions.createdAt));
    // Append-only revisions: expose only chain heads (revisions that are not
    // superseded by a newer revision), each carrying its latest review state.
    const supersededIds = new Set(
      rows.filter((row) => row.supersedesId !== null).map((row) => row.supersedesId!),
    );
    return rows.filter((row) => !supersededIds.has(row.id)).map(toFinding);
  }

  async getCases(): Promise<AuditCase[]> {
    const rows = await this.db.select().from(auditCases).orderBy(desc(auditCases.createdAt));
    return rows.map(toCase);
  }

  async getSnapshotByCase(caseId: string): Promise<AuditSnapshot | null> {
    const [row] = await this.db.select().from(auditSnapshots).where(eq(auditSnapshots.auditCaseId, caseId)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async getFinding(findingId: string): Promise<FindingRevision | null> {
    const [row] = await this.db.select().from(findingRevisions).where(eq(findingRevisions.id, findingId)).limit(1);
    return row ? toFinding(row) : null;
  }

  async ping(): Promise<boolean> {
    const rows = await this.db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
    return rows.length > 0;
  }
}

export function createRepository(databaseUrl: string): AuditCaseRepository {
  const client = postgres(databaseUrl);
  return new AuditCaseRepository(drizzle({ client, schema }));
}
