import type {
  AuditCase,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  SourceProvenance,
} from "@contract-audit/audit/model";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { auditCases, auditSnapshots, sourceRecords } from "../schema";
import { ContractRepository, registerContractRevision } from "./contract.repository";
import { contractTitleFromFirstBlock } from "./helpers";
import { asDate, toCase, toSnapshot, toSourceProvenance } from "./mappers";
import type { DrizzleDB, SourceRecordOriginal } from "./types";

/**
 * Outcome of opening a rerun. `created` carries the new case id and the case
 * it was opened from; every other outcome is a refusal the route maps to a
 * status code, so the caller never has to guess why no case was created.
 */
export type CreateRerunCaseResult =
  | { status: "created"; caseId: string; sourceCaseId: string }
  | { status: "not_found" }
  /** The case is still queued or being audited, so there is no stopped run to repeat. */
  | { status: "case_active" }
  /** Another case on the same Contract Revision is already queued or running. */
  | { status: "rerun_active" };

/**
 * The demo world's activation-lock key. The exact integer Infra's reset takes
 * exclusively; both files must spell the number, never derive it, so the key
 * cannot drift.
 */
export const DEMO_WORLD_LOCK_KEY = 748291001;

/**
 * Canonical UUID text. `audit_cases.id` and the ids it references are typed
 * `uuid`, so a value that does not match can only ever match zero rows —
 * checking the shape first keeps a malformed id an honest 404 rather than a
 * driver cast error the caller would see as a 500.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuditQueueRepository {
  constructor(private readonly db: DrizzleDB) {}

  async claimNextPendingCase(): Promise<{ caseId: string; snapshotId: string | null } | null> {
    return this.db.transaction(async (tx) => {
      // Shared demo-world gate: concurrent claims never block each other, and
      // a demo reset's exclusive lock waits for this claim to commit before it
      // touches any case.
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${DEMO_WORLD_LOCK_KEY})`);
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
      // Shared demo-world gate; see claimNextPendingCase.
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${DEMO_WORLD_LOCK_KEY})`);
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
      contractId?: string | null;
      /**
       * Where the uploaded original already lives, registered together with
       * the Source Record in this same transaction. Lets a caller save the
       * bytes first and then register locator, source and case atomically, so
       * a failure can never leave a case pointing at bytes that were never
       * written. Null (the default) keeps the historical shape: a pasted
       * submission, or an upload that points the row at its file afterwards.
       */
      originalPath?: string | null;
    } = {},
  ): Promise<{ caseId: string }> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(sourceRecords)
        .values({
          id: sourceRecordId,
          sourceText,
          originalPath: options.originalPath ?? null,
          metadata: {
            ...(provenance === null
              ? {}
              : { sourceType: provenance.type, sourceDisplayName: provenance.displayName }),
            ...(options.metadata ?? {}),
          },
        })
        .onConflictDoNothing({ target: sourceRecords.id });

      const title = ContractRepository.titleFromSource(sourceText, provenance?.displayName ?? null);
      const contractRevisionId = await registerContractRevision(tx, {
        sourceRecordId,
        title,
        contractId: options.contractId,
      });

      const createdAt = options.createdAt;
      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          sourceRecordId,
          contractRevisionId,
          status: "PENDING",
          stage: "QUEUED",
          ...(createdAt === undefined ? {} : { createdAt, updatedAt: createdAt }),
          ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
        })
        .returning({ id: auditCases.id });

      return { caseId: auditCase.id };
    });
  }

  /**
   * Re-audits a stopped case by opening a *new* Audit Case over the same Source
   * Record and the same Contract Revision. The old case keeps its status,
   * snapshot, findings, reviews and remediations untouched — nothing about it is
   * rewritten — while the new case gets a fresh snapshot and a fresh Agent Run
   * under the rules, settings and OCR in force now.
   *
   * Reusing the existing `contractRevisionId` is what makes this a rerun rather
   * than a resubmission: a Contract Revision is one immutable version of a
   * Contract, and re-reading identical bytes is not a new version. Registering
   * another revision here would invent a document change that never happened.
   *
   * The Source Record is reused too, so the new case re-reads the *original*
   * bytes — the pasted text or the stored upload — rather than a re-serialised
   * copy. That is what lets a changed OCR configuration change what the new
   * case parses, while the source of truth stays one row.
   *
   * The row is locked for the duration of the transaction, and both guards are
   * checked while it is held:
   *   - the source case must have stopped (PENDING/RUNNING still has live work);
   *   - no other case on the same revision may already be queued or running,
   *     so two operators cannot start overlapping audits of one revision.
   *
   * A refusal is returned as a reason rather than thrown, because it is an
   * expected outcome the HTTP layer answers with a status code.
   *
   * An id that is not a UUID at all is answered as `not_found` before any
   * statement is sent: the columns are typed `uuid`, so passing a raw string
   * makes the driver abort the transaction with a cast error instead of
   * matching zero rows. That would surface as a 500, blaming the server for a
   * caller's malformed id.
   */
  async createRerunCase(sourceCaseId: string): Promise<CreateRerunCaseResult> {
    if (!UUID_PATTERN.test(sourceCaseId)) return { status: "not_found" };
    return this.db.transaction(async (tx) => {
      // Shared demo-world gate; see claimNextPendingCase.
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${DEMO_WORLD_LOCK_KEY})`);
      // Lock the source row first: a concurrent rerun of the same case then
      // waits here instead of interleaving its own checks with ours.
      const source = await tx.execute<{
        source_record_id: string;
        contract_revision_id: string | null;
        status: string;
      }>(sql`
        SELECT c.source_record_id, c.contract_revision_id, c.status
        FROM audit_cases c
        WHERE c.id = ${sourceCaseId}
        LIMIT 1
        FOR UPDATE
      `);
      const locked = source[0];
      if (!locked) return { status: "not_found" };
      if (locked.status === "PENDING" || locked.status === "RUNNING") {
        return { status: "case_active" };
      }
      if (locked.contract_revision_id === null) return { status: "not_found" };

      const active = await tx.execute<{ id: string }>(sql`
        SELECT c.id
        FROM audit_cases c
        WHERE c.contract_revision_id = ${locked.contract_revision_id}
          AND c.status IN ('PENDING', 'RUNNING')
          AND c.id <> ${sourceCaseId}
        LIMIT 1
      `);
      if (active.length > 0) return { status: "rerun_active" };

      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          // The original Source Record: the bytes to re-read stay one row.
          sourceRecordId: locked.source_record_id,
          // The exact revision the source case reviewed. No new revision is
          // registered: the bytes being re-read have not changed.
          contractRevisionId: locked.contract_revision_id,
          status: "PENDING",
          stage: "QUEUED",
        })
        .returning({ id: auditCases.id });

      return { status: "created", caseId: auditCase.id, sourceCaseId };
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
      contractId?: string | null;
    } = {},
  ): Promise<{ caseId: string; snapshotId: string }> {
    return this.db.transaction(async (tx) => {
      const sourceText = snapshot.contractDocument.blocks.map((block) => block.text).join("\n");
      await tx
        .insert(sourceRecords)
        .values({
          id: sourceRecordId,
          sourceText,
          metadata: {
            contractDocumentHash: snapshot.contractDocument.hash,
            ...(provenance === null
              ? {}
              : { sourceType: provenance.type, sourceDisplayName: provenance.displayName }),
            ...(options.metadata ?? {}),
          },
        })
        .onConflictDoNothing({ target: sourceRecords.id });

      const title =
        contractTitleFromFirstBlock(snapshot.contractDocument.blocks[0]?.text) ??
        ContractRepository.titleFromSource(sourceText, provenance?.displayName ?? null);
      const contractRevisionId = await registerContractRevision(tx, {
        sourceRecordId,
        title,
        contractId: options.contractId,
      });

      const createdAt = options.createdAt;
      const [auditCase] = await tx
        .insert(auditCases)
        .values({
          sourceRecordId,
          contractRevisionId,
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
   * The latest snapshot for a case together with its persisted row id.
   *
   * The domain `AuditSnapshot` deliberately carries no row id — it is a value
   * object, not a database row — so shadow derivation reads the identity
   * explicitly from this accessor instead of probing the returned object for a
   * field it does not have. A case with no snapshot yields null; a snapshot
   * always yields a non-empty id, because the column is the table's primary
   * key.
   */
  async getSnapshotRecordByCase(
    caseId: string,
  ): Promise<{ snapshotId: string; snapshot: AuditSnapshot } | null> {
    const [row] = await this.db
      .select()
      .from(auditSnapshots)
      .where(eq(auditSnapshots.auditCaseId, caseId))
      .orderBy(desc(auditSnapshots.createdAt))
      .limit(1);
    return row ? { snapshotId: row.id, snapshot: toSnapshot(row) } : null;
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
      metadata:
        metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : null,
    };
  }
}
