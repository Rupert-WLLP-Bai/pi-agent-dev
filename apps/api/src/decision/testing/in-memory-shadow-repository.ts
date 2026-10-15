import type {
  DecisionAdvice,
  DecisionFeedback,
  DecisionProviderResult,
  DecisionRequest,
} from "@contract-audit/audit/decision";
import type {
  ShadowFeedbackRecord,
  ShadowJobClaim,
  ShadowJobIdentity,
} from "../shadow-repository";

/** One stored job row, shaped like the persisted row the repository returns. */
export interface FakeShadowJob {
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
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  frozenInput: DecisionRequest;
  result: DecisionProviderResult | null;
  fallbackReason: string | null;
  latencyMs: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface FakeShadowFeedback {
  id: string;
  decisionId: string;
  decision: DecisionFeedback["decision"];
  actor: string;
  reason: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/** The stored row as the repository contract reports it: an ISO timestamp. */
const toFeedbackRecord = (row: FakeShadowFeedback): ShadowFeedbackRecord => ({
  id: row.id,
  decisionId: row.decisionId,
  decision: row.decision,
  actor: row.actor,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
  idempotencyKey: row.idempotencyKey,
});

/**
 * In-memory stand-in for `ShadowDecisionRepository`, implementing the same
 * identity, lease, retry and idempotency rules so a test can exercise the
 * worker and the routes without a database. Claims are handed out oldest
 * first and are exclusive while their lease is live — the two properties the
 * worker's restart-recovery behaviour depends on.
 */
export class InMemoryShadowDecisionRepository {
  jobs = new Map<string, FakeShadowJob>();
  feedback: FakeShadowFeedback[] = [];
  /** Clock the lease arithmetic uses; a test can move it forward. */
  now: () => Date = () => new Date();
  private sequence = 0;

  // Canonical UUID text: routes answer a non-UUID id as 404 before any lookup,
  // so the fake's ids must satisfy the same shape the SQL repository does.
  private nextId(_prefix: string): string {
    this.sequence += 1;
    const hex = this.sequence.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }

  async ensureJob(identity: ShadowJobIdentity): Promise<{ decisionId: string; created: boolean }> {
    const existing = this.jobs.get(this.identityKey(identity));
    if (existing !== undefined) return { decisionId: existing.decisionId, created: false };
    const decisionId = this.nextId("decision");
    this.jobs.set(this.identityKey(identity), {
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
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      frozenInput: identity.frozenInput,
      result: null,
      fallbackReason: null,
      latencyMs: null,
      createdAt: this.now(),
      updatedAt: this.now(),
      completedAt: null,
    });
    return { decisionId, created: true };
  }

  async findJobByIdentity(identity: ShadowJobIdentity): Promise<FakeShadowJob | null> {
    return this.jobs.get(this.identityKey(identity)) ?? null;
  }

  async claimJobs(owner: string, leaseMs: number, limit: number): Promise<ShadowJobClaim[]> {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimable = [...this.jobs.values()]
      .filter(
        (job) =>
          job.status === "PENDING" ||
          (job.status === "RUNNING" &&
            (job.leaseExpiresAt === null || job.leaseExpiresAt.getTime() < now.getTime())),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit);
    return claimable.map((job) => {
      job.status = "RUNNING";
      job.leaseOwner = owner;
      job.leaseExpiresAt = leaseExpiresAt;
      job.attempts += 1;
      job.updatedAt = now;
      return {
        decisionId: job.decisionId,
        auditCaseId: job.auditCaseId,
        snapshotId: job.snapshotId,
        agentRunId: job.agentRunId,
        inputHash: job.inputHash,
        questionKey: job.questionKey,
        questionVersion: job.questionVersion,
        policyVersion: job.policyVersion,
        redactionVersion: job.redactionVersion,
        provider: job.provider,
        modelVersion: job.modelVersion,
        attempts: job.attempts,
        frozenInput: job.frozenInput,
      };
    });
  }

  async completeJob(
    decisionId: string,
    result: DecisionProviderResult,
    latencyMs: number,
  ): Promise<void> {
    const job = this.jobById(decisionId);
    if (job === undefined) return;
    job.status = "SUCCEEDED";
    job.result = result;
    job.fallbackReason = null;
    job.latencyMs = latencyMs;
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.completedAt = this.now();
    job.updatedAt = this.now();
  }

  async failJob(decisionId: string, fallbackReason: string, skipped = false): Promise<void> {
    const job = this.jobById(decisionId);
    if (job === undefined) return;
    job.status = skipped ? "SKIPPED" : "FAILED";
    job.fallbackReason = fallbackReason;
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.completedAt = this.now();
    job.updatedAt = this.now();
  }

  async requeueJob(decisionId: string): Promise<void> {
    const job = this.jobById(decisionId);
    if (job === undefined) return;
    job.status = "PENDING";
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.completedAt = null;
    job.updatedAt = this.now();
  }

  async getJob(decisionId: string): Promise<FakeShadowJob | null> {
    for (const job of this.jobs.values()) {
      if (job.decisionId === decisionId) return job;
    }
    return null;
  }

  async listByCase(auditCaseId: string): Promise<FakeShadowJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.auditCaseId === auditCaseId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async appendFeedback(input: {
    decisionId: string;
    decision: DecisionFeedback["decision"];
    actor: string;
    reason: string | null;
    idempotencyKey: string | null;
  }): Promise<{ event: ShadowFeedbackRecord; created: boolean }> {
    const existing = await this.findFeedback(
      input.decisionId,
      input.actor,
      input.idempotencyKey,
    );
    if (existing !== null) return { event: existing, created: false };
    const event: FakeShadowFeedback = {
      id: this.nextId("feedback"),
      decisionId: input.decisionId,
      decision: input.decision,
      actor: input.actor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
    };
    this.feedback.push(event);
    return { event: toFeedbackRecord(event), created: true };
  }

  async findFeedback(
    decisionId: string,
    actor: string,
    idempotencyKey: string | null,
  ): Promise<ShadowFeedbackRecord | null> {
    if (idempotencyKey === null) return null;
    const found = this.feedback.find(
      (event) =>
        event.decisionId === decisionId &&
        event.actor === actor &&
        event.idempotencyKey === idempotencyKey,
    );
    return found ? toFeedbackRecord(found) : null;
  }

  async listFeedback(decisionId: string): Promise<ShadowFeedbackRecord[]> {
    return this.feedback
      .filter((event) => event.decisionId === decisionId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(toFeedbackRecord);
  }

  async terminalJobsOlderThan(retentionDays: number, now: Date): Promise<string[]> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    return [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "SKIPPED") &&
          job.completedAt !== null &&
          job.completedAt.getTime() < cutoff.getTime() &&
          (job.leaseExpiresAt === null || job.leaseExpiresAt.getTime() < now.getTime()),
      )
      .map((job) => job.decisionId);
  }

  async deleteTerminalJobs(decisionIds: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const [key, job] of this.jobs) {
      if (!decisionIds.includes(job.decisionId)) continue;
      this.jobs.delete(key);
      this.feedback = this.feedback.filter((event) => event.decisionId !== job.decisionId);
      deleted += 1;
    }
    return deleted;
  }

  async releaseLeases(owner: string): Promise<number> {
    let released = 0;
    for (const job of this.jobs.values()) {
      if (job.leaseOwner !== owner || job.status !== "RUNNING") continue;
      job.status = "PENDING";
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.updatedAt = this.now();
      released += 1;
    }
    return released;
  }

  private jobById(decisionId: string): FakeShadowJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.decisionId === decisionId) return job;
    }
    return undefined;
  }

  private identityKey(identity: ShadowJobIdentity): string {
    return [
      identity.agentRunId,
      identity.questionKey,
      identity.questionVersion,
      identity.policyVersion,
      identity.redactionVersion,
      identity.inputHash,
      identity.provider,
      identity.modelVersion,
    ].join("\u0000");
  }
}
