/**
 * Real-PostgreSQL behavioral smoke for the shadow decision persistence.
 *
 * Proves the SQL-specific behaviours the in-memory repository cannot: the
 * partial unique index behind feedback idempotency, the lease-expiry recovery
 * in the claim statement, and the retention boundary around a NULL lease —
 * the exact divergence class Main found (`= NULL` never matches in Postgres).
 *
 * Safety: the script runs only against an explicit TEST_DATABASE_URL — it
 * refuses DATABASE_URL, production-named databases and everything else — and
 * does all of its work inside one transaction that is always rolled back, so
 * a run leaves nothing behind in the target database. Migrations are NOT run
 * here: point TEST_DATABASE_URL at an already-migrated disposable database.
 *
 *   bun --env-file=<env> scripts/decision/pg-smoke.ts
 *
 * Exit code 0 with every check "ok" means the SQL store behaves; any FAIL
 * line or a non-zero exit names the divergence.
 */

import { randomUUID } from "node:crypto";
import type { DecisionProviderResult, DecisionRequest } from "@contract-audit/audit/decision";
import { sql } from "../../apps/api/node_modules/drizzle-orm";
import type { DrizzleDB } from "../../apps/api/src/db/repositories";
import { createDb } from "../../apps/api/src/db/repositories/create-db";
import {
  auditCases,
  auditSnapshots,
  contractRevisions,
  contracts,
  sourceRecords,
} from "../../apps/api/src/db/schema";
import { decisionQuestionCatalogue } from "../../apps/api/src/decision/questions";
import { decisionInputHash } from "../../apps/api/src/decision/redaction";
import { ShadowDecisionRepository } from "../../apps/api/src/decision/shadow-repository";

const question = decisionQuestionCatalogue[0];
if (question === undefined || question.question.type !== "choice") {
  throw new Error("controlled catalogue is missing its first question");
}

const PROTECTED_NAMES = ["production", "prod", "postgres"] as const;

/** Resolve an explicit disposable URL; DATABASE_URL is deliberately refused. */
const testDatabaseUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url === undefined || url === "") {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a disposable migrated database " +
        "(for example postgresql://contract_audit:contract_audit@localhost:5432/contract_audit_test). " +
        "DATABASE_URL is deliberately not accepted here.",
    );
  }
  return url;
};

const databaseNameOf = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "unknown";
  } catch {
    return "unknown";
  }
};

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
};

const frozenRequest: DecisionRequest = {
  schemaVersion: 1,
  auditCaseId: randomUUID(),
  snapshotId: randomUUID(),
  agentRunId: randomUUID(),
  contractDocumentHash: "pg-smoke-document-hash",
  taskType: question.taskType,
  questionKey: question.key,
  question: question.question,
  questionVersion: question.version,
  policyVersion: "pg-smoke-policy-v1",
  redactionVersion: "pg-smoke-redaction-v1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: "甲方应在合同签订后十个工作日内支付预付款。",
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: "pg-smoke-trace",
};

const succeededResult: DecisionProviderResult = {
  schemaVersion: 1,
  answer: { kind: "choice", value: "PAYMENT" },
  rawDistribution: { PAYMENT: 0.9, TERMINATION: 0.1 },
  confidenceType: "none",
  confidence: null,
  uncertainty: "unavailable",
  needsHumanReview: true,
};

// The identity the unique index covers; both ensureJob calls below share it.
const jobIdentity = {
  auditCaseId: frozenRequest.auditCaseId,
  snapshotId: frozenRequest.snapshotId,
  agentRunId: frozenRequest.agentRunId,
  inputHash: decisionInputHash(frozenRequest),
  questionKey: frozenRequest.questionKey,
  questionVersion: frozenRequest.questionVersion,
  policyVersion: frozenRequest.policyVersion,
  redactionVersion: frozenRequest.redactionVersion,
  provider: "fake",
  modelVersion: "fake-deterministic-v1",
  frozenInput: frozenRequest,
};

/**
 * Inserts the formal parent rows the shadow tables' foreign keys require:
 * contract → source record → revision → case → snapshot. All ids are freshly
 * generated and the enclosing transaction rolls back, so nothing persists.
 */
const seedFormalParents = async (db: DrizzleDB): Promise<void> => {
  const contractId = randomUUID();
  const sourceRecordId = randomUUID();
  const caseId = frozenRequest.auditCaseId;
  // Contract, source record, revision, case and snapshot in FK order; the
  // snapshot row is what getSnapshotRecordByCase reads the id back from. The
  // JSONB payloads are minimal structural stand-ins: this smoke exercises the
  // shadow tables' SQL, not the snapshot assembler's content rules.
  await db.insert(contracts).values({ id: contractId, title: "PG 冒烟合同" });
  await db.insert(sourceRecords).values({ id: sourceRecordId, sourceText: "甲方应付预付款。" });
  await db.insert(contractRevisions).values({
    contractId,
    version: 1,
    sourceRecordId,
  });
  await db.insert(auditCases).values({
    id: caseId,
    status: "COMPLETED",
    stage: "COMPLETED",
    sourceRecordId,
    contractRevisionId: null,
  });
  await db.insert(auditSnapshots).values({
    id: frozenRequest.snapshotId,
    auditCaseId: caseId,
    sourceRecordId,
    document: {
      hash: "pg-smoke-document-hash",
      blocks: [{ id: "b1", kind: "CLAUSE", text: "甲方应付预付款。" }],
    },
    facts: {},
    parties: [],
    policy: null,
    evidence: [],
    ruleAssessments: [],
  });
};

const main = async (): Promise<void> => {
  const url = testDatabaseUrl();
  const name = databaseNameOf(url);
  if ((PROTECTED_NAMES as readonly string[]).includes(name.toLowerCase())) {
    throw new Error(`refusing to smoke against database "${name}"`);
  }
  const handle = createDb(url);
  try {
    const identityRows = await handle.client`SELECT current_database() AS name`;
    const reported = String(identityRows[0]?.name ?? "");
    if (reported && reported !== name) {
      throw new Error(
        `database identity mismatch: expected "${name}", server reports "${reported}"`,
      );
    }
    console.log(`[pg-smoke] database: ${reported || name}`);

    // One transaction for everything; it always rolls back, including on a
    // failed check, so a failing assertion cannot leave state behind.
    class Rollback extends Error {}
    try {
      await handle.db.transaction(async (tx) => {
        const db = tx as unknown as DrizzleDB;
        await seedFormalParents(db);
        const repository = new ShadowDecisionRepository(db);

        // 1. ensureJob idempotency across the real unique index.
        const first = await repository.ensureJob(jobIdentity);
        const second = await repository.ensureJob(jobIdentity);
        check(
          "ensureJob is idempotent against the SQL unique index",
          first.created && !second.created && first.decisionId === second.decisionId,
          `${first.decisionId} / created=${first.created},${second.created}`,
        );

        // 2. Claim → live-lease exclusivity → expiry recovery, in SQL.
        const claimA = await repository.claimJobs("pg-smoke-a", 60_000, 5);
        const claimB = await repository.claimJobs("pg-smoke-b", 60_000, 5);
        check(
          "a live SQL lease is exclusive",
          claimA.length === 1 && claimB.length === 0,
          `a=${claimA.length}, b=${claimB.length}`,
        );
        // The expiry backdate must run on the transaction handle: the pool
        // connection cannot see this transaction's uncommitted rows.
        await tx.execute(
          sql`UPDATE shadow_jobs SET lease_expires_at = now() - interval '1 second'
              WHERE decision_id = ${claimA[0]?.decisionId ?? ""}`,
        );
        const recovered = await repository.claimJobs("pg-smoke-b", 60_000, 5);
        check(
          "an expired SQL lease is recoverable by another worker",
          recovered.length === 1 && recovered[0]?.attempts === 2,
          `recovered=${recovered.length}, attempts=${recovered[0]?.attempts}`,
        );

        // 3. Terminal writes: complete clears the lease; feedback rides the
        //    partial unique index.
        const decisionId = recovered[0]?.decisionId ?? "";
        await repository.completeJob(decisionId, succeededResult, 42);
        const completed = await repository.getJob(decisionId);
        check(
          "completeJob persists the validated result and clears the lease",
          completed?.status === "SUCCEEDED" &&
            completed.leaseOwner === null &&
            completed.completedAt !== null,
          `status=${completed?.status}, lease=${completed?.leaseOwner}`,
        );

        const append = (decision: "accepted" | "rejected" | "needs_review", key: string) =>
          repository.appendFeedback({
            decisionId,
            decision,
            actor: "pg-smoke-operator",
            reason: "SQL 冒烟反馈",
            idempotencyKey: key,
          });
        const firstEvent = await append("rejected", "retry-key-1");
        const replayEvent = await append("rejected", "retry-key-1");
        check(
          "feedback idempotency holds against the partial unique index",
          firstEvent.created &&
            !replayEvent.created &&
            firstEvent.event.id === replayEvent.event.id,
          `${replayEvent.event.id}`,
        );
        const keylessA = await append("accepted", "keyless-a");
        // A distinct key is an independent event even for the same actor: the
        // partial index scopes on (decision, actor, key).
        const keylessRows = await repository.listFeedback(decisionId);
        check(
          "keyless and keyed feedback coexist append-only",
          keylessA.created && keylessRows.length === 2,
          `events=${keylessRows.length}`,
        );

        // 4. Retention boundary: a NULL lease must not spare an expired
        //    terminal row (the `= NULL` divergence Main found).
        const decisionIds = [decisionId];
        const dryRun = await repository.terminalJobsOlderThan(30, new Date());
        check(
          "retention spares fresh terminal rows",
          !dryRun.some((id) => decisionIds.includes(id)),
          `candidates=${dryRun.length}`,
        );
        await tx.execute(
          sql`UPDATE shadow_jobs SET completed_at = now() - interval '40 days'
              WHERE decision_id = ${decisionId}`,
        );
        const withExpired = await repository.terminalJobsOlderThan(30, new Date());
        check(
          "retention finds an expired terminal row whose lease is NULL",
          withExpired.includes(decisionId),
          `candidates=${JSON.stringify(withExpired)}`,
        );

        // 5. Delete removes the job and cascades the feedback.
        const deleted = await repository.deleteTerminalJobs([decisionId]);
        const feedbackAfter = await repository.listFeedback(decisionId);
        check(
          "apply deletes the terminal row and cascades its feedback",
          deleted === 1 && feedbackAfter.length === 0,
          `deleted=${deleted}, feedback=${feedbackAfter.length}`,
        );

        // 6. releaseLeases returns only this owner's RUNNING rows.
        const pending = await repository.ensureJob({ ...jobIdentity, questionVersion: "v-next" });
        const claimC = await repository.claimJobs("pg-smoke-c", 60_000, 5);
        const released = await repository.releaseLeases("pg-smoke-c");
        check(
          "releaseLeases frees exactly the owner's running rows",
          pending.created && claimC.length === 1 && released === 1,
          `released=${released}`,
        );

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    console.log(
      `[pg-smoke] ${checks.length - checks.filter((c) => !c.ok).length}/${checks.length} checks passed`,
    );
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  } finally {
    await handle.client.end({ timeout: 5 }).catch(() => {});
  }
};

await main();
