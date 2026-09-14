import type {
  AuditCase,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  SourceProvenance,
} from "@contract-audit/audit/model";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { auditCases, auditSnapshots, sourceRecords } from "../schema";
import { asDate, toCase, toSnapshot, toSourceProvenance } from "./mappers";
import type { DrizzleDB, SourceRecordOriginal } from "./types";

export class AuditQueueRepository {
  constructor(private readonly db: DrizzleDB) {}

  async claimNextPendingCase(): Promise<{ caseId: string; snapshotId: string | null } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ case_id: string; snapshot_id: string | null }>(sql`
        SELECT c.id AS case_id,
               (
                 SELECT s.id
                 FROM audit_snapshots s
                 WHERE s.audit_case_id = c.id
                 ORDER BY s.created_at DESC
                 LIMIT 1
               ) AS snapshot_id
        FROM audit_cases c
        WHERE c.status = 'PENDING'
        ORDER BY c.created_at ASC
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);
      const row = rows[0];
      if (!row) return null;

      await tx
        .update(auditCases)
        .set({ status: "RUNNING", stage: "NORMALIZING", updatedAt: new Date() })
        .where(eq(auditCases.id, row.case_id));
      return { caseId: row.case_id, snapshotId: row.snapshot_id };
    });
  }

  async claimCase(
    auditCaseId: string,
  ): Promise<{ caseId: string; snapshotId: string | null } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ case_id: string; snapshot_id: string | null }>(sql`
        SELECT c.id AS case_id,
               (
                 SELECT s.id
                 FROM audit_snapshots s
                 WHERE s.audit_case_id = c.id
                 ORDER BY s.created_at DESC
                 LIMIT 1
               ) AS snapshot_id
        FROM audit_cases c
        WHERE c.id = ${auditCaseId} AND c.status = 'PENDING'
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);
      const row = rows[0];
      if (!row) return null;

      await tx
        .update(auditCases)
        .set({ status: "RUNNING", stage: "NORMALIZING", updatedAt: new Date() })
        .where(eq(auditCases.id, row.case_id));
      return { caseId: row.case_id, snapshotId: row.snapshot_id };
    });
  }

  async createQueuedCase(
    sourceRecordId: string,
    sourceText: string,
    provenance: SourceProvenance | null = null,
    options: {
      createdAt?: Date;
      metadata?: Record<string, unknown>;
      assignee?: string | null;
    } = {},
  ): Promise<{ caseId: string }> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(sourceRecords)
        .values({
          id: sourceRecordId,
          sourceText,
          metadata: {
            ...(provenance === null
              ? {}
              : { sourceType: provenance.type, sourceDisplayName: provenance.displayName }),
            ...(options.metadata ?? {}),
          },
        })
        .onConflictDoNothing({ target: sourceRecords.id });

      const createdAt = options.createdAt;
      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          sourceRecordId,
          status: "PENDING",
          stage: "QUEUED",
          ...(createdAt === undefined ? {} : { createdAt, updatedAt: createdAt }),
          ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
        })
        .returning({ id: auditCases.id });

      return { caseId: auditCase.id };
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

  /**
   * Atomically promotes a case back to PENDING only if it is not RUNNING.
   * This prevents a race where two dispatchers interleave getCase + update
   * and one reverts an already-claimed RUNNING case.
   */
  async requeueIfNotRunning(caseId: string): Promise<boolean> {
    const result = await this.db
      .update(auditCases)
      .set({ status: "PENDING", stage: "QUEUED", updatedAt: new Date() })
      .where(and(eq(auditCases.id, caseId), ne(auditCases.status, "RUNNING")))
      .returning({ id: auditCases.id });
    return result.length > 0;
  }

  /**
   * Sets the review assignee and/or priority. An omitted key leaves the field
   * untouched; an explicit null clears it, which is how a transfer back to the
   * shared queue is expressed.
   */

  async markStaleRunsInterrupted(): Promise<number> {
    const rows = await this.db
      .update(auditCases)
      .set({ status: "INTERRUPTED", stage: "INTERRUPTED", updatedAt: new Date() })
      .where(eq(auditCases.status, "RUNNING"))
      .returning({ id: auditCases.id });
    return rows.length;
  }

  async createPendingCase(
    sourceRecordId: string,
    snapshot: AuditSnapshot,
    provenance: SourceProvenance | null = null,
    options: {
      createdAt?: Date;
      metadata?: Record<string, unknown>;
      assignee?: string | null;
    } = {},
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
            ...(options.metadata ?? {}),
          },
        })
        .onConflictDoNothing({ target: sourceRecords.id });

      const createdAt = options.createdAt;
      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          sourceRecordId,
          status: "PENDING",
          stage: "QUEUED",
          ...(createdAt === undefined ? {} : { createdAt, updatedAt: createdAt }),
          ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
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
          policy: snapshot.policy ?? null,
          evidence: snapshot.evidence,
          ruleAssessments: snapshot.ruleAssessments,
          createdAt: asDate(snapshot.createdAt),
        })
        .returning({ id: auditSnapshots.id });

      return { caseId: auditCase.id, snapshotId: auditSnapshot.id };
    });
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
   * Atomically promotes a case back to PENDING only if it is not RUNNING.
   * This prevents a race where two dispatchers interleave getCase + update
   * and one reverts an already-claimed RUNNING case.
   */

  async getCase(caseId: string): Promise<AuditCase | null> {
    const [row] = await this.db.select().from(auditCases).where(eq(auditCases.id, caseId)).limit(1);
    return row ? toCase(row) : null;
  }

  /**
   * Records where an uploaded original was stored. Called after the upload
   * route has written the file, so a Source Record can be downloaded later.
   * Pasted submissions never call this and keep a null path.
   */

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

  async getSnapshotByCase(caseId: string): Promise<AuditSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(auditSnapshots)
      .where(eq(auditSnapshots.auditCaseId, caseId))
      .orderBy(desc(auditSnapshots.createdAt))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  /**
   * Appends a snapshot generation for a case. Reassessment rebuilds the
   * snapshot under the rules in force now and appends rather than overwrites:
   * the earlier generation stays readable as the record of what a past
   * decision was judged under, while readers pick the newest one.
   */

  /**
   * Appends a snapshot generation for a case. Reassessment rebuilds the
   * snapshot under the rules in force now and appends rather than overwrites:
   * the earlier generation stays readable as the record of what a past
   * decision was judged under, while readers pick the newest one.
   */
  async appendSnapshot(caseId: string, snapshot: AuditSnapshot): Promise<void> {
    await this.db.insert(auditSnapshots).values({
      auditCaseId: caseId,
      sourceRecordId: snapshot.sourceRecordId,
      document: snapshot.contractDocument,
      facts: snapshot.facts,
      parties: snapshot.parties,
      policy: snapshot.policy ?? null,
      evidence: snapshot.evidence,
      ruleAssessments: snapshot.ruleAssessments,
      createdAt: asDate(snapshot.createdAt),
    });
  }

  /**
   * Records one verification pass. Rows are append-only: an earlier decision can
   * always be traced back to the provider answer it rested on, and re-verifying
   * a case adds a generation rather than rewriting history.
   */

  /**
   * Records where an uploaded original was stored. Called after the upload
   * route has written the file, so a Source Record can be downloaded later.
   * Pasted submissions never call this and keep a null path.
   */
  async updateSourceOriginalPath(sourceRecordId: string, originalPath: string): Promise<void> {
    await this.db
      .update(sourceRecords)
      .set({ originalPath })
      .where(eq(sourceRecords.id, sourceRecordId));
  }

  /** The stored original for a Source Record, or null when none exists. */

  /** The stored original for a Source Record, or null when none exists. */
  async getSourceRecordContent(sourceRecordId: string): Promise<{
    sourceText: string;
    originalPath: string | null;
    metadata: Record<string, unknown> | null;
  } | null> {
    const [row] = await this.db
      .select({
        sourceText: sourceRecords.sourceText,
        originalPath: sourceRecords.originalPath,
        metadata: sourceRecords.metadata,
      })
      .from(sourceRecords)
      .where(eq(sourceRecords.id, sourceRecordId))
      .limit(1);
    if (row === undefined) return null;
    const metadata =
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;
    return {
      sourceText: row.sourceText,
      originalPath: row.originalPath,
      metadata,
    };
  }

  async patchSourceRecordMetadata(
    sourceRecordId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.getSourceRecordContent(sourceRecordId);
    if (!existing) return;
    await this.db
      .update(sourceRecords)
      .set({
        metadata: { ...(existing.metadata ?? {}), ...patch },
      })
      .where(eq(sourceRecords.id, sourceRecordId));
  }

  async getSourceRecord(sourceRecordId: string): Promise<SourceRecordOriginal | null> {
    const [row] = await this.db
      .select({
        id: sourceRecords.id,
        originalPath: sourceRecords.originalPath,
        metadata: sourceRecords.metadata,
      })
      .from(sourceRecords)
      .where(eq(sourceRecords.id, sourceRecordId))
      .limit(1);
    if (row === undefined) return null;
    const metadata = row.metadata;
    let name: string | null = null;
    let sourceType: string | null = null;
    if (metadata !== null && typeof metadata === "object") {
      if ("sourceDisplayName" in metadata && typeof metadata.sourceDisplayName === "string") {
        name = metadata.sourceDisplayName;
      }
      if ("sourceType" in metadata && typeof metadata.sourceType === "string") {
        sourceType = metadata.sourceType;
      }
    }
    return {
      id: row.id,
      originalPath: row.originalPath,
      name,
      provenance: toSourceProvenance(sourceType, name),
    };
  }
}
