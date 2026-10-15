import { randomUUID } from "node:crypto";
import type {
  DecisionAdvice,
  DecisionFeedback,
  DecisionFeedbackChoice,
  DecisionProviderResult,
  DecisionRequest,
  DecisionRuleConflict,
  DecisionStatus,
} from "@contract-audit/audit/decision";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { shadowFeedback, shadowJobs, type ShadowJobRow } from "../db/schema";
import type { DrizzleDB } from "../db/repositories";

/** One claimable job, with the frozen input a re-run needs. */
export interface ShadowJobClaim {
  decisionId: string;
  auditCaseId: string;
  snapshotId: string;
  agentRunId: string;
  inputHash: string;
  questionKey: string;
  questionVersion: string;
  policyVersion: string;
  redactionVersion: string;
  provider: string;
  modelVersion: string;
  attempts: number;
  frozenInput: DecisionRequest;
}

/**
 * What a caller supplies to derive one observation. Identity is required. */
export interface ShadowJobIdentity {
  auditCaseId: string;
  snapshotId: string;
  agentRunId: string;
  inputHash: string;
  questionKey: string;
  questionVersion: string;
  policyVersion: string;
  redactionVersion: string;
  provider: string;
  modelVersion: string;
  frozenInput: DecisionRequest;
}

/**
 * The persistence seam the worker depends on. Declared as an interface rather
 * than the concrete Drizzle repository so the worker's lease, retry and
 * recovery behaviour can be exercised in memory, and so a future persistent
 * job store can replace the SQL one without touching the worker.
 */
export interface ShadowJobStore {
  claimJobs(owner: string, leaseMs: number, limit: number): Promise<ShadowJobClaim[]>;
  completeJob(decisionId: string, result: DecisionProviderResult, latencyMs: number): Promise<void>;
  failJob(decisionId: string, fallbackReason: string, skipped?: boolean): Promise<void>;
  requeueJob(decisionId: string): Promise<void>;
  releaseLeases(owner: string): Promise<number>;
}

export interface ShadowFeedbackRecord {
  id: string;
  decisionId: string;
  decision: DecisionFeedbackChoice;
  actor: string;
  reason: string | null;
  createdAt: string;
  idempotencyKey: string | null;
}

/**
 * Persistence for the shadow layer, deliberately separate from
 * `AuditCaseRepository`: nothing here can reach a Finding, a Rule Assessment,
 * a review, a remediation or the audit case's status. The only formal rows it
 * reads are the identity columns it needs to prove a job belongs to a proven
 * successful run.
 */
export class ShadowDecisionRepository {
  constructor(private readonly db: DrizzleDB) {}

  /**
   * Registers one observation. The identity columns carry a unique index, so
   * a re-derivation of the same observation returns the existing row instead
   * of appending a second answer — this is what makes the worker's restart
   * recovery and its periodic scan idempotent.
   */
  async ensureJob(identity: ShadowJobIdentity): Promise<{ decisionId: string; created: boolean }> {
    const decisionId = randomUUID();
    await this.db
      .insert(shadowJobs)
      .values({
        decisionId,
        auditCaseId: identity.auditCaseId,
        snapshotId: identity.snapshotId,
        agentRunId: identity.agentRunId,
        inputHash: identity.inputHash,
        questionKey: identity.questionKey,
        questionVersion: identity.questionVersion,
        policyVersion: identity.policyVersion,
        redactionVersion: identity.redactionVersion,
        provider: identity.provider,
        modelVersion: identity.modelVersion,
        status: "PENDING",
        frozenInput: identity.frozenInput,
      })
      .onConflictDoNothing({
        target: [
          shadowJobs.agentRunId,
          shadowJobs.questionKey,
          shadowJobs.questionVersion,
          shadowJobs.policyVersion,
          shadowJobs.redactionVersion,
          shadowJobs.inputHash,
          shadowJobs.provider,
          shadowJobs.modelVersion,
        ],
      });
    const existing = await this.findJobByIdentity(identity);
    if (existing === null) {
      // The insert conflicted and the row vanished between the two statements:
      // treat it as absent rather than fabricating an identity.
      return { decisionId, created: false };
    }
    return { decisionId: existing.decisionId, created: existing.decisionId === decisionId };
  }

  /** The row for an exact identity, or null when none exists. */
  async findJobByIdentity(identity: ShadowJobIdentity): Promise<ShadowJobRow | null> {
    const [row] = await this.db
      .select()
      .from(shadowJobs)
      .where(
        and(
          eq(shadowJobs.agentRunId, identity.agentRunId),
          eq(shadowJobs.questionKey, identity.questionKey),
          eq(shadowJobs.questionVersion, identity.questionVersion),
          eq(shadowJobs.policyVersion, identity.policyVersion),
          eq(shadowJobs.redactionVersion, identity.redactionVersion),
          eq(shadowJobs.inputHash, identity.inputHash),
          eq(shadowJobs.provider, identity.provider),
          eq(shadowJobs.modelVersion, identity.modelVersion),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Claims up to `limit` claimable jobs for `owner` until `leaseMs` from now.
   *
   * A job is claimable when it is PENDING, or RUNNING under a lease that has
   * already expired — which is what lets a restarted process recover work its
   * predecessor left mid-flight, without ever running one job twice while the
   * original lease is still valid. `SKIP LOCKED` keeps two workers from
   * claiming the same row concurrently.
   */
  async claimJobs(
    owner: string,
    leaseMs: number,
    limit: number,
  ): Promise<ShadowJobClaim[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1, leaseMs));
    const rows = await this.db.execute<{
      decision_id: string;
      audit_case_id: string;
      snapshot_id: string;
      agent_run_id: string;
      input_hash: string;
      question_key: string;
      question_version: string;
      policy_version: string;
      redaction_version: string;
      provider: string;
      model_version: string;
      attempts: number;
      frozen_input: DecisionRequest;
    }>(sql`
      UPDATE shadow_jobs j
      SET status = 'RUNNING',
          lease_owner = ${owner},
          lease_expires_at = ${leaseExpiresAt},
          attempts = j.attempts + 1,
          updated_at = now()
      WHERE j.decision_id IN (
        SELECT j2.decision_id
        FROM shadow_jobs j2
        WHERE j2.status = 'PENDING'
           OR (j2.status = 'RUNNING' AND (j2.lease_expires_at IS NULL OR j2.lease_expires_at < ${now}))
        ORDER BY j2.created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j.decision_id, j.audit_case_id, j.snapshot_id, j.agent_run_id, j.input_hash,
                j.question_key, j.question_version, j.policy_version, j.redaction_version,
                j.provider, j.model_version, j.attempts, j.frozen_input
    `);
    return (rows as unknown as {
      decision_id: string;
      audit_case_id: string;
      snapshot_id: string;
      agent_run_id: string;
      input_hash: string;
      question_key: string;
      question_version: string;
      policy_version: string;
      redaction_version: string;
      provider: string;
      model_version: string;
      attempts: number;
      frozen_input: DecisionRequest;
    }[]).map((row) => ({
      decisionId: row.decision_id,
      auditCaseId: row.audit_case_id,
      snapshotId: row.snapshot_id,
      agentRunId: row.agent_run_id,
      inputHash: row.input_hash,
      questionKey: row.question_key,
      questionVersion: row.question_version,
      policyVersion: row.policy_version,
      redactionVersion: row.redaction_version,
      provider: row.provider,
      modelVersion: row.model_version,
      attempts: Number(row.attempts),
      frozenInput: row.frozen_input,
    }));
  }

  /** Records a successful inference. */
  async completeJob(
    decisionId: string,
    result: DecisionProviderResult,
    latencyMs: number,
  ): Promise<void> {
    await this.db
      .update(shadowJobs)
      .set({
        status: "SUCCEEDED",
        result,
        fallbackReason: null,
        latencyMs,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shadowJobs.decisionId, decisionId));
  }

  /** Records a terminal failure. `skipped` marks a job the system declined. */
  async failJob(decisionId: string, fallbackReason: string, skipped = false): Promise<void> {
    await this.db
      .update(shadowJobs)
      .set({
        status: skipped ? "SKIPPED" : "FAILED",
        fallbackReason,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shadowJobs.decisionId, decisionId));
  }

  /** Returns a terminal job to the claimable pool, keeping its attempt count. */
  async requeueJob(decisionId: string): Promise<void> {
    await this.db
      .update(shadowJobs)
      .set({
        status: "PENDING",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shadowJobs.decisionId, decisionId));
  }

  async getJob(decisionId: string): Promise<ShadowJobRow | null> {
    const [row] = await this.db
      .select()
      .from(shadowJobs)
      .where(eq(shadowJobs.decisionId, decisionId))
      .limit(1);
    return row ?? null;
  }

  /** Every job for a case, newest first, with its feedback attached. */
  async listByCase(auditCaseId: string): Promise<ShadowJobRow[]> {
    return this.db
      .select()
      .from(shadowJobs)
      .where(eq(shadowJobs.auditCaseId, auditCaseId))
      .orderBy(desc(shadowJobs.createdAt));
  }

  /**
   * Appends feedback. The unique index on (decision, actor, key) makes a
   * network retry of the same key a no-op write, so the caller can treat
   * "already exists" as success and answer 201 with the stored event.
   */
  async appendFeedback(input: {
    decisionId: string;
    decision: DecisionFeedbackChoice;
    actor: string;
    reason: string | null;
    idempotencyKey: string | null;
  }): Promise<{ event: ShadowFeedbackRecord; created: boolean }> {
    const id = randomUUID();
    await this.db
      .insert(shadowFeedback)
      .values({
        id,
        decisionId: input.decisionId,
        decision: input.decision,
        actor: input.actor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing();
    const existing = await this.findFeedback(
      input.decisionId,
      input.actor,
      input.idempotencyKey,
    );
    if (existing === null) {
      // The insert conflicted with a row that is no longer readable: report
      // the write as not created rather than inventing an event.
      return {
        event: {
          id,
          decisionId: input.decisionId,
          decision: input.decision,
          actor: input.actor,
          reason: input.reason,
          createdAt: new Date().toISOString(),
          idempotencyKey: input.idempotencyKey,
        },
        created: false,
      };
    }
    return { event: existing, created: existing.id === id };
  }

  /** The stored event for one (decision, actor, key), or null. */
  async findFeedback(
    decisionId: string,
    actor: string,
    idempotencyKey: string | null,
  ): Promise<ShadowFeedbackRecord | null> {
    if (idempotencyKey === null) return null;
    const [row] = await this.db
      .select()
      .from(shadowFeedback)
      .where(
        and(
          eq(shadowFeedback.decisionId, decisionId),
          eq(shadowFeedback.actor, actor),
          eq(shadowFeedback.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ? toFeedbackRecord(row) : null;
  }

  async listFeedback(decisionId: string): Promise<ShadowFeedbackRecord[]> {
    const rows = await this.db
      .select()
      .from(shadowFeedback)
      .where(eq(shadowFeedback.decisionId, decisionId))
      .orderBy(shadowFeedback.createdAt);
    return rows.map(toFeedbackRecord);
  }

  /**
   * Terminal jobs older than `retentionDays`, excluding anything still
   * holding a live lease. Returns the decision ids; deleting them is a
   * separate call so the retention entry point can report exactly what it is
   * about to remove in a dry run.
   */
  async terminalJobsOlderThan(retentionDays: number, now: Date): Promise<string[]> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ decisionId: shadowJobs.decisionId })
      .from(shadowJobs)
      .where(
        and(
          inArray(shadowJobs.status, ["SUCCEEDED", "FAILED", "SKIPPED"]),
          lt(shadowJobs.completedAt, cutoff),
          or(eq(shadowJobs.leaseExpiresAt, sql`NULL`), lt(shadowJobs.leaseExpiresAt, now)),
        ),
      );
    return rows.map((row) => row.decisionId);
  }

  /**
   * Deletes terminal jobs and their feedback. Formal rows are never touched:
   * the statement addresses shadow tables only, and the cascade takes the
   * feedback with the job.
   */
  async deleteTerminalJobs(decisionIds: readonly string[]): Promise<number> {
    if (decisionIds.length === 0) return 0;
    const deleted = await this.db
      .delete(shadowJobs)
      .where(inArray(shadowJobs.decisionId, [...decisionIds]))
      .returning({ decisionId: shadowJobs.decisionId });
    return deleted.length;
  }

  /** Releases every lease this owner holds, so a shutting-down worker leaves nothing stuck. */
  async releaseLeases(owner: string): Promise<number> {
    const rows = await this.db
      .update(shadowJobs)
      .set({ status: "PENDING", leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(shadowJobs.leaseOwner, owner), eq(shadowJobs.status, "RUNNING")))
      .returning({ decisionId: shadowJobs.decisionId });
    return rows.length;
  }
}

const toFeedbackRecord = (row: {
  id: string;
  decisionId: string;
  decision: DecisionFeedbackChoice;
  actor: string;
  reason: string | null;
  createdAt: Date;
  idempotencyKey: string | null;
}): ShadowFeedbackRecord => ({
  id: row.id,
  decisionId: row.decisionId,
  decision: row.decision,
  actor: row.actor,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
  idempotencyKey: row.idempotencyKey,
});

// ── Advice projection ────────────────────────────────────────────────

/**
 * Builds the public advice from a stored row. The frozen input and the raw
 * provider result are consulted for the fields the DTO carries; the DTO never
 * carries the frozen input itself.
 */
export const toDecisionAdvice = (row: ShadowJobRow): DecisionAdvice => {
  const result = row.result;
  const status: DecisionStatus = row.status;
  const answer = result?.answer ?? null;
  return {
    schemaVersion: 1,
    decisionId: row.decisionId,
    auditCaseId: row.auditCaseId,
    snapshotId: row.snapshotId,
    agentRunId: row.agentRunId,
    contractDocumentHash: row.frozenInput.contractDocumentHash,
    mode: "shadow",
    status,
    provider: row.provider as DecisionAdvice["provider"],
    modelVersion: row.modelVersion,
    taskType: row.frozenInput.taskType,
    questionKey: row.questionKey,
    questionVersion: row.questionVersion,
    policyVersion: row.policyVersion,
    redactionVersion: row.redactionVersion,
    answer,
    rawProbabilities: result?.rawProbabilities ?? null,
    rawScore: result?.rawScore ?? null,
    confidence: result?.confidence ?? null,
    confidenceType: result?.confidenceType ?? "none",
    // Nothing in this system calibrates a provider's scores, so every advice
    // says so rather than borrowing a number from somewhere else.
    calibrated: false,
    calibrationVersion: null,
    thresholdPolicyVersion: null,
    threshold: null,
    uncertainty: result === null ? "unavailable" : "uncalibrated",
    ruleConflicts: ruleConflictsFor(row),
    // An unverified model answer never routes itself: a human looks at it.
    needsHumanReview: true,
    evidenceRefs: row.frozenInput.evidenceRefs,
    latencyMs: row.latencyMs,
    inputHash: row.inputHash,
    dataClassification: row.frozenInput.dataClassification,
    traceId: row.frozenInput.traceId,
    fallbackReason: row.fallbackReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
  };
};

/**
 * Computes conflicts against the frozen baseline, for the same proposition
 * only. A different question type, a different rule, or merely a different
 * probability is not a conflict: the comparison asserts one assessment's
 * answer against the same assessment's baseline, and anything else is left
 * alone rather than dressed up as disagreement.
 */
export const ruleConflictsFor = (row: ShadowJobRow): DecisionRuleConflict[] => {
  const comparison = row.frozenInput.comparison;
  const answer = row.result?.answer;
  if (comparison === null || answer === undefined) return [];
  if (comparison.baselineAnswer.type !== answer.type) return [];
  if (comparison.baselineAnswer.type === "choice" && answer.type === "choice") {
    if (comparison.baselineAnswer.choice !== answer.choice) {
      return [
        {
          assessmentId: comparison.assessmentId,
          ruleCode: comparison.ruleCode,
          conflictType: "OPPOSED_ASSESSMENT",
          baselineAnswer: comparison.baselineAnswer,
          shadowAnswer: answer,
        },
      ];
    }
    return [];
  }
  if (comparison.baselineAnswer.type === "score" && answer.type === "score") {
    if (comparison.baselineAnswer.score !== answer.score) {
      return [
        {
          assessmentId: comparison.assessmentId,
          ruleCode: comparison.ruleCode,
          conflictType: "OPPOSED_ASSESSMENT",
          baselineAnswer: comparison.baselineAnswer,
          shadowAnswer: answer,
        },
      ];
    }
    return [];
  }
  if (comparison.baselineAnswer.type === "noul" && answer.type === "noul") {
    // Both sides are yes/no over the same proposition; the baseline's boolean
    // and the model's probability are compared at the proposition level.
    const baseline = comparison.baselineAnswer.noul >= 0.5;
    const shadow = answer.noul >= 0.5;
    if (baseline !== shadow) {
      return [
        {
          assessmentId: comparison.assessmentId,
          ruleCode: comparison.ruleCode,
          conflictType: "OPPOSED_ASSESSMENT",
          baselineAnswer: comparison.baselineAnswer,
          shadowAnswer: answer,
        },
      ];
    }
  }
  return [];
};

export const toDecisionFeedback = (event: ShadowFeedbackRecord): DecisionFeedback => ({
  schemaVersion: 1,
  id: event.id,
  decisionId: event.decisionId,
  decision: event.decision,
  actor: event.actor,
  reason: event.reason,
  createdAt: event.createdAt,
});
