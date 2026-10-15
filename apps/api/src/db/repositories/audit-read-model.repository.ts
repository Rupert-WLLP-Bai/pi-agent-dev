import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type { AuditCase, AuditCaseStatus, AuditStage } from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { DemoWorldOperationResult } from "../../demo/demo-world-operation";
import { plantDemoCases } from "../../demo/seed-world";
import { originalStorageOf } from "../../document/original-store";
import { AuditCaseRepository } from "./audit-case.repository";
import {
  agentRuns,
  agentTraceSteps,
  auditCases,
  auditSnapshots,
  contractRevisions,
  contracts,
  findingRevisions,
  partyHistoryRecords,
  remediations,
  sourceRecords,
  subjectVerifications,
} from "../schema";
import { compareReviewQueueItems, contractTitleFromFirstBlock } from "./helpers";
import { asDate, toCase, toReviewPriority, toSeverity, toSourceProvenance } from "./mappers";
import type {
  AuditOverview,
  CaseSummary,
  DemoResetOrphans,
  DemoResetOutcome,
  DrizzleDB,
  ReviewQueueItem,
  SubjectVerificationListItem,
} from "./types";

/**
 * The advisory-lock key every demo-world operation serializes on.
 *
 * DecisionEngineer's queue slice defines the same literal in
 * `audit-queue.repository.ts` — the claims take it SHARED, the reset takes it
 * EXCLUSIVE. The value is duplicated here with a comment naming that file so a
 * change to one side fails loudly in review rather than silently stopping to
 * exclude the other. A fixed constant, not `hashtext(<string>)`: a literal
 * cannot drift when a string is edited, and the value must never change, or an
 * old lock holder and a new one would stop excluding each other.
 */
export const DEMO_WORLD_LOCK_KEY = 748291001;

export class AuditReadModelRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getCases(): Promise<AuditCase[]> {
    const rows = await this.db.select().from(auditCases).orderBy(desc(auditCases.createdAt));
    return rows.map(toCase);
  }

  async getCasesWithContractTitle(): Promise<CaseSummary[]> {
    const rows = await this.db.execute<{
      id: string;
      status: string;
      stage: string;
      source_record_id: string;
      contract_revision_id: string | null;
      source_type: string | null;
      source_display_name: string | null;
      original_path: string | null;
      created_at: string | Date;
      updated_at: string | Date;
      contract_title: string | null;
      finding_count: number;
      highest_severity: string | null;
      subject_red_line_count: number;
    }>(sql`
      SELECT c.id, c.status, c.stage, c.source_record_id, c.contract_revision_id, c.created_at, c.updated_at,
             s.document->'blocks'->0->>'text' AS contract_title,
             src.metadata->>'sourceType' AS source_type,
             src.metadata->>'sourceDisplayName' AS source_display_name,
             src.original_path AS original_path,
             COALESCE(h.finding_count, 0)::int AS finding_count,
             h.highest_severity,
             COALESCE(sr.subject_red_line_count, 0)::int AS subject_red_line_count
      FROM audit_cases c
      LEFT JOIN source_records src ON src.id = c.source_record_id
      LEFT JOIN LATERAL (
        SELECT * FROM audit_snapshots s2
        WHERE s2.audit_case_id = c.id
        ORDER BY s2.created_at DESC
        LIMIT 1
      ) s ON true
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
      contractRevisionId: row.contract_revision_id ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      contractTitle: contractTitleFromFirstBlock(row.contract_title),
      findingCount: row.finding_count,
      highestSeverity: toSeverity(row.highest_severity),
      subjectRedLineCount: row.subject_red_line_count,
      sourceProvenance: toSourceProvenance(row.source_type, row.source_display_name),
      originalStorage: originalStorageOf(row.original_path),
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
      LEFT JOIN LATERAL (
        SELECT * FROM audit_snapshots s2
        WHERE s2.audit_case_id = c.id
        ORDER BY s2.created_at DESC
        LIMIT 1
      ) s ON true
      WHERE c.status = 'AWAITING_REVIEW' OR c.stage = 'AWAITING_REVIEW'
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
             COUNT(*) FILTER (WHERE c.status = 'AWAITING_REVIEW' OR c.stage = 'AWAITING_REVIEW')::int AS awaiting_review,
             COUNT(*) FILTER (WHERE c.status = 'AWAITING_REVIEW' OR c.stage IN ('AWAITING_REVIEW', 'COMPLETED'))::int AS reached_review
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
      LEFT JOIN LATERAL (
        SELECT * FROM audit_snapshots s2
        WHERE s2.audit_case_id = c.id
        ORDER BY s2.created_at DESC
        LIMIT 1
      ) s ON true
      WHERE c.status = 'AWAITING_REVIEW' OR c.stage = 'AWAITING_REVIEW'
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

  /**
   * The external-verification timeline: every stored answer, newest capture
   * first. The contract title is read through a scalar subquery so a case with
   * several snapshot generations cannot multiply its verification rows.
   */
  async listSubjectVerifications(limit = 50): Promise<SubjectVerificationListItem[]> {
    const rows = await this.db
      .select({
        id: subjectVerifications.id,
        auditCaseId: subjectVerifications.auditCaseId,
        partyId: subjectVerifications.partyId,
        status: subjectVerifications.status,
        payload: subjectVerifications.payload,
        provider: sql<string | null>`${sourceRecords.metadata}->>'provider'`,
        subject: sql<string | null>`${sourceRecords.metadata}->>'subject'`,
        contractTitle: sql<string | null>`(
          SELECT s.document->'blocks'->0->>'text'
          FROM audit_snapshots s
          WHERE s.audit_case_id = ${subjectVerifications.auditCaseId}
          ORDER BY s.created_at DESC
          LIMIT 1
        )`,
      })
      .from(subjectVerifications)
      .leftJoin(sourceRecords, eq(sourceRecords.id, subjectVerifications.sourceRecordId))
      .orderBy(desc(subjectVerifications.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      auditCaseId: row.auditCaseId,
      contractTitle: contractTitleFromFirstBlock(row.contractTitle),
      partyId: row.partyId,
      subjectName: row.payload.matched?.name ?? row.subject ?? row.partyId,
      status: row.status,
      provider: row.provider,
      capturedAt: row.payload.capturedAt,
      expiresAt: row.payload.expiresAt,
    }));
  }

  async listDemoSeededCases(): Promise<
    Array<{
      caseId: string;
      scenarioId: string;
      caseKey: string;
      status: AuditCaseStatus;
      stage: AuditStage;
    }>
  > {
    const rows = await this.db.execute<{
      case_id: string;
      scenario_id: string | null;
      case_key: string | null;
      status: string;
      stage: string;
    }>(sql`
      SELECT c.id AS case_id,
             src.metadata->>'scenarioId' AS scenario_id,
             src.metadata->>'caseKey' AS case_key,
             c.status,
             c.stage
      FROM audit_cases c
      INNER JOIN source_records src ON src.id = c.source_record_id
      WHERE src.metadata->>'demoSeed' = 'true'
      ORDER BY c.created_at ASC
    `);
    return rows.map((row) => ({
      caseId: row.case_id,
      scenarioId: row.scenario_id ?? "",
      caseKey: row.case_key ?? "",
      status: row.status as AuditCaseStatus,
      stage: row.stage as AuditStage,
    }));
  }

  /**
   * The external-verification timeline: every stored answer, newest capture
   * first. The contract title is read through a scalar subquery so a case with
   * several snapshot generations cannot multiply its verification rows.
   */

  /**
   * The server's own answer for this connection. Used by tests and the CLI to
   * ask for the name the guard expects, so a test never hard-codes a database
   * name the shared suite database may not carry.
   */
  async currentDatabaseName(): Promise<string> {
    const rows = await this.db.execute<{ current_database: string }>(
      sql`SELECT current_database() AS current_database`,
    );
    return rows[0]?.current_database ?? "";
  }

  /**
   * Whether `demo_environments` exists on this database. A test uses it to
   * skip (not fake) a reset on a database the registration migration has not
   * reached yet; production code never calls it — there, the absence of the
   * table makes the reset refuse, which is the correct outcome.
   */
  async hasDemoEnvironmentTable(): Promise<boolean> {
    const rows = await this.db.execute<{ present: number }>(
      sql`SELECT COUNT(*)::int AS present FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'demo_environments'`,
    );
    return (rows[0]?.present ?? 0) > 0;
  }

  /**
   * Registers a demo environment, or repairs its stored database name. Only
   * the reset's caller supplies this: the migration never inserts a row, and a
   * deployment that never calls it keeps every database unregistered.
   */
  async registerDemoEnvironment(input: { environmentId: string; databaseName: string }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO demo_environments (id, database_name)
      VALUES (${input.environmentId}, ${input.databaseName})
      ON CONFLICT (id) DO UPDATE SET database_name = EXCLUDED.database_name
    `);
  }

  /**
   * Runs one atomic demo-world operation: the guarded reset and, when seed is
   * requested, the rebuild — inside a single transaction on a single
   * connection.
   *
   * The transaction holds the demo-world advisory lock exclusively for the
   * whole operation, so a claim/retry/rerun (shared lock) cannot start a demo
   * case between the delete and the seed, and a second operation cannot
   * interleave with this one. Seeding runs through a repository bound to this
   * transaction, so every insert joins the same commit: either the world ends
   * up rebuilt, or nothing changed.
   */
  async rebuildDemoWorld(input: {
    environmentId: string;
    databaseName: string;
    seed: { fillerCount?: number; rngSeed?: number } | null;
  }): Promise<DemoWorldOperationResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEMO_WORLD_LOCK_KEY})`);

      // Identity is read inside this transaction, on this connection.
      const identityRows = await tx.execute<{
        current_database: string;
        registered_database: string | null;
      }>(sql`
        SELECT current_database() AS current_database,
               (SELECT database_name FROM demo_environments WHERE id = ${input.environmentId}) AS registered_database
      `);
      const currentDatabase = identityRows[0]?.current_database ?? "";
      const registeredDatabase = identityRows[0]?.registered_database ?? null;
      if (currentDatabase !== input.databaseName) {
        return {
          outcome: {
            ok: false,
            code: "database_identity_mismatch",
            reason: `目标库不匹配：当前连接的是 ${currentDatabase}，而 DEMO_DATABASE_NAME 指向 ${input.databaseName}。拒绝重置。`,
          },
          view: null,
          planted: 0,
        };
      }
      if (registeredDatabase !== input.databaseName) {
        return {
          outcome: {
            ok: false,
            code: "registration_mismatch",
            reason:
              registeredDatabase === null
                ? `环境 ${input.environmentId} 未注册（demo_environments 无该行）；生产库不会自动获得演示身份。`
                : `环境 ${input.environmentId} 注册的库是 ${registeredDatabase}，与 DEMO_DATABASE_NAME（${input.databaseName}）不符。拒绝重置。`,
          },
          view: null,
          planted: 0,
        };
      }

      const active = await tx.execute<{ case_key: string | null; case_id: string }>(sql`
        SELECT c.id AS case_id, src.metadata->>'caseKey' AS case_key
        FROM audit_cases c
        INNER JOIN source_records src ON src.id = c.source_record_id
        WHERE src.metadata->>'demoSeed' = 'true'
          AND c.status IN ('PENDING', 'RUNNING')
      `);
      if (active.length > 0) {
        const keys = active.map((row) => row.case_key ?? row.case_id);
        return {
          outcome: {
            ok: false,
            code: "demo_run_active",
            reason:
              `有 ${active.length} 个演示案件仍在排队或运行中（${keys.slice(0, 3).join("、")}${keys.length > 3 ? " 等" : ""}）；` +
              "等活动结束或取消后再重置。",
          },
          view: null,
          planted: 0,
        };
      }

      const removed = await this.deleteDemoWorldIn(tx);
      if (input.seed === null) return { outcome: { ok: true, removed }, view: null, planted: 0 };

      // Seeding joins this transaction through a repository bound to it, so
      // every insert commits — or rolls back — with the delete above.
      const seedRepository = new AuditCaseRepository(tx as unknown as DrizzleDB);
      const seeded = await plantDemoCases(seedRepository, input.seed);
      return {
        outcome: { ok: true, removed },
        view: { ...seeded, removed },
        planted: seeded.planted,
      };
    });
  }

  /**
   * Removes the demo world, or refuses, in ONE transaction.
   *
   * Everything that decides whether the delete may happen — the database
   * identity, the registration row, the active-run check — is read on the SAME
   * connection and inside the SAME transaction that performs the delete. That
   * is the point: checking `current_database()` over one connection and then
   * deleting over another would let a pooled connection land on a different
   * database between the two statements, which is exactly how a reset deletes
   * the wrong data while reporting success.
   *
   * Ordering inside the transaction:
   *   1. take the demo-world advisory lock exclusively, so no claim/retry/rerun
   *      can start while the delete is in flight and no second reset can
   *      interleave with this one;
   *   2. read `current_database()` and the registration row, and refuse unless
   *      both equal the expected name;
   *   3. refuse while any demo case is queued or running — checked under the
   *      lock, so the answer cannot go stale before the delete;
   *   4. collect the source records exclusively owned by the demo seeder, then
   *      delete the chain, removing verification rows only for those source
   *      records that nothing else references;
   *   5. delete the source records last, and only those with no remaining
   *      reference from a surviving row.
   *
   * A refusal returns a reason; the caller maps it to an HTTP status or an exit
   * code. Nothing is deleted when a refusal is returned.
   */
  async resetDemoWorld(input: {
    environmentId: string;
    databaseName: string;
  }): Promise<DemoResetOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEMO_WORLD_LOCK_KEY})`);

      // Identity is read inside this transaction, on this connection.
      const identityRows = await tx.execute<{
        current_database: string;
        registered_database: string | null;
      }>(sql`
        SELECT current_database() AS current_database,
               (SELECT database_name FROM demo_environments WHERE id = ${input.environmentId}) AS registered_database
      `);
      const currentDatabase = identityRows[0]?.current_database ?? "";
      const registeredDatabase = identityRows[0]?.registered_database ?? null;
      if (currentDatabase !== input.databaseName) {
        return {
          ok: false,
          code: "database_identity_mismatch",
          reason: `目标库不匹配：当前连接的是 ${currentDatabase}，而 DEMO_DATABASE_NAME 指向 ${input.databaseName}。拒绝重置。`,
        };
      }
      if (registeredDatabase !== input.databaseName) {
        return {
          ok: false,
          code: "registration_mismatch",
          reason:
            registeredDatabase === null
              ? `环境 ${input.environmentId} 未注册（demo_environments 无该行）；生产库不会自动获得演示身份。`
              : `环境 ${input.environmentId} 注册的库是 ${registeredDatabase}，与 DEMO_DATABASE_NAME（${input.databaseName}）不符。拒绝重置。`,
        };
      }

      // Active runs, under the lock: a claim would have needed the shared lock
      // we now hold exclusively, so this reading cannot be invalidated before
      // the delete below.
      const active = await tx.execute<{ case_key: string | null; case_id: string }>(sql`
        SELECT c.id AS case_id, src.metadata->>'caseKey' AS case_key
        FROM audit_cases c
        INNER JOIN source_records src ON src.id = c.source_record_id
        WHERE src.metadata->>'demoSeed' = 'true'
          AND c.status IN ('PENDING', 'RUNNING')
      `);
      if (active.length > 0) {
        const keys = active.map((row) => row.case_key ?? row.case_id);
        return {
          ok: false,
          code: "demo_run_active",
          reason:
            `有 ${active.length} 个演示案件仍在排队或运行中（${keys.slice(0, 3).join("、")}${keys.length > 3 ? " 等" : ""}）；` +
            "等活动结束或取消后再重置。",
        };
      }

      const removed = await this.deleteDemoWorldIn(tx);
      return { ok: true, removed };
    });
  }

  /**
   * The delete itself, on a caller-supplied transaction that already holds the
   * demo-world lock. Split out so `resetDemoWorld` can run it after the guards
   * and so a seeding path can call it inside its own transaction.
   */
  async deleteDemoWorldIn(tx: DrizzleDB): Promise<number> {
    const seeded = await tx.execute<{ id: string }>(sql`
      SELECT id FROM source_records WHERE metadata->>'demoSeed' = 'true'
    `);
    if (seeded.length === 0) return 0;
    const sourceIds = seeded.map((row) => row.id);
    const caseRows = await tx
      .select({ id: auditCases.id })
      .from(auditCases)
      .where(inArray(auditCases.sourceRecordId, sourceIds));
    const caseIds = caseRows.map((row) => row.id);

    // Verification rows name their own source record. A row is demo-owned only
    // when it belongs to a demo case AND points at a demo source record;
    // deleting every verification of a demo case would take a shared record's
    // row with it.
    const verificationSources = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT v.id
      FROM subject_verifications v
      WHERE v.audit_case_id = ANY(${caseIds})
        AND v.source_record_id = ANY(${sourceIds})
    `);
    const verificationIds = verificationSources.map((row) => row.id);

    if (caseIds.length > 0) {
      // Shadow rows are removed explicitly (feedback before jobs) even though
      // the FK cascades: the order documents the reset's reach.
      const jobs = await tx.execute<{ decision_id: string }>(sql`
        SELECT decision_id FROM shadow_jobs WHERE audit_case_id = ANY(${caseIds})
      `);
      const decisionIds = jobs.map((row) => row.decision_id);
      if (decisionIds.length > 0) {
        await tx.execute(sql`DELETE FROM shadow_feedback WHERE decision_id = ANY(${decisionIds})`);
        await tx.execute(sql`DELETE FROM shadow_jobs WHERE decision_id = ANY(${decisionIds})`);
      }
      await tx.delete(agentTraceSteps).where(inArray(agentTraceSteps.auditCaseId, caseIds));
      await tx.delete(agentRuns).where(inArray(agentRuns.auditCaseId, caseIds));
      await tx.delete(remediations).where(inArray(remediations.auditCaseId, caseIds));
      await tx.delete(findingRevisions).where(inArray(findingRevisions.auditCaseId, caseIds));
      await tx.delete(partyHistoryRecords).where(inArray(partyHistoryRecords.auditCaseId, caseIds));
      // Only the exclusively demo-owned verification rows, identified above.
      if (verificationIds.length > 0) {
        await tx.delete(subjectVerifications).where(inArray(subjectVerifications.id, verificationIds));
      }
      await tx.delete(auditSnapshots).where(inArray(auditSnapshots.auditCaseId, caseIds));
      await tx.delete(auditCases).where(inArray(auditCases.id, caseIds));
    }

    const revisionRows = await tx
      .select({ contractId: contractRevisions.contractId })
      .from(contractRevisions)
      .where(inArray(contractRevisions.sourceRecordId, sourceIds));
    const contractIds = [...new Set(revisionRows.map((row) => row.contractId))];
    await tx.delete(contractRevisions).where(inArray(contractRevisions.sourceRecordId, sourceIds));
    for (const contractId of contractIds) {
      const remaining = await tx
        .select({ id: contractRevisions.id })
        .from(contractRevisions)
        .where(eq(contractRevisions.contractId, contractId))
        .limit(1);
      if (remaining.length === 0) {
        await tx.delete(contracts).where(eq(contracts.id, contractId));
      }
    }
    // A demo source record is removed only when nothing still references it:
    // a surviving case, revision or verification row that points at it means
    // the record is shared, and deleting it would break that reference.
    const deletableSources: string[] = [];
    for (const sourceId of sourceIds) {
      const references = await tx.execute<{ remaining: number }>(sql`
        SELECT (
          (SELECT COUNT(*)::int FROM audit_cases WHERE source_record_id = ${sourceId}) +
          (SELECT COUNT(*)::int FROM contract_revisions WHERE source_record_id = ${sourceId}) +
          (SELECT COUNT(*)::int FROM subject_verifications WHERE source_record_id = ${sourceId})
        ) AS remaining
      `);
      if ((references[0]?.remaining ?? 0) === 0) deletableSources.push(sourceId);
    }
    if (deletableSources.length > 0) {
      await tx.delete(sourceRecords).where(inArray(sourceRecords.id, deletableSources));
    }
    return caseIds.length;
  }

  /**
   * Counts rows a completed reset must have left at zero: shadow jobs and
   * feedback pointing at cases that no longer exist, and verification rows
   * pointing at source records that no longer exist.
   *
   * The query is not wrapped in a catch. An earlier version swallowed any SQL
   * error and returned zeros, which turns a broken check into a passing one —
   * exactly the failure mode a verification query exists to prevent. If the
   * shadow tables are absent the reset's own contract is broken, and that must
   * surface as an error rather than as "no orphans".
   */
  async countDemoResetOrphans(): Promise<DemoResetOrphans> {
    const rows = await this.db.execute<{
      shadow_jobs: number;
      shadow_feedback: number;
      verification_sources: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM shadow_jobs j
          LEFT JOIN audit_cases c ON c.id = j.audit_case_id
          WHERE c.id IS NULL) AS shadow_jobs,
        (SELECT COUNT(*)::int FROM shadow_feedback f
          LEFT JOIN shadow_jobs j ON j.decision_id = f.decision_id
          WHERE j.decision_id IS NULL) AS shadow_feedback,
        (SELECT COUNT(*)::int FROM subject_verifications v
          LEFT JOIN source_records s ON s.id = v.source_record_id
          WHERE v.source_record_id IS NOT NULL AND s.id IS NULL) AS verification_sources
    `);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("demo reset orphan check returned no row");
    }
    return {
      shadowJobs: row.shadow_jobs,
      shadowFeedback: row.shadow_feedback,
      verificationSources: row.verification_sources,
    };
  }

  async ping(): Promise<boolean> {
    const rows = await this.db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
    return rows.length > 0;
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
}
