import type { DecisionProviderLike } from "./providers/base";
import type { ShadowJobClaim, ShadowJobStore } from "./shadow-repository";

/** Everything the worker needs, injected so tests never touch a database. */
export interface ShadowWorkerDeps {
  repository: ShadowJobStore;
  provider: DecisionProviderLike;
  /** Stable per-process owner id, so a restart does not inherit live leases. */
  owner: string;
  concurrency: number;
  leaseMs: number;
  pollIntervalMs: number;
  maxRetries: number;
  /** Injectable clock, so a test can drive time without waiting on it. */
  now?: () => Date;
  /** Injectable sleep, so a test can advance the poll loop deterministically. */
  sleep?: (ms: number) => Promise<void>;
}

/** How one claimed job turned out, for the worker's own accounting. */
export interface ShadowJobOutcome {
  decisionId: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "RETRIED";
  latencyMs: number | null;
  fallbackReason: string | null;
}
/**
 * The shadow worker: the only component in this system that calls a decision
 * provider.
 *
 * It is deliberately independent of the formal dispatcher. It does not share
 * its queue, its concurrency budget, its transactions or its lifecycle: a
 * case reaches AWAITING_REVIEW whether this worker is running, broken,
 * restarting or switched off, and nothing this worker writes can reach a
 * Finding, a Rule Assessment, a review, a remediation or the audit case's
 * status. Its own failures are recorded on its own rows.
 *
 * Recovery is database-driven. A job is a row with a lease, so a process that
 * dies mid-flight leaves its jobs claimable once the lease expires, and the
 * next scan picks them up. Idempotency is likewise a row property: deriving
 * the same observation twice writes one row, because the identity columns are
 * unique.
 */
export class ShadowDecisionWorker {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: ShadowWorkerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts the scan loop. Idempotent: a second call does nothing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    // The loop runs for the process's lifetime; it is deliberately not
    // awaited. Every iteration is guarded, and the defensive catch keeps a
    // surprise from becoming an unhandled rejection.
    void this.run().catch(() => {});
  }

  /** Stops the loop and releases this process's leases. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.deps.repository.releaseLeases(this.deps.owner);
  }

  /** Wakes a sleeping loop, so a newly derived job is picked up promptly. */
  notify(): void {
    this.wake?.();
  }

  /**
   * One scan: claims up to the concurrency budget, runs each claim, and
   * records the outcome. Exposed so a test can drive exactly one pass.
   */
  async runOnce(): Promise<ShadowJobOutcome[]> {
    const claims = await this.deps.repository.claimJobs(
      this.deps.owner,
      this.deps.leaseMs,
      this.deps.concurrency,
    );
    // Sequential within the budget: a single local CPU service is the scarce
    // resource, and bounded concurrency is the point of the budget.
    const outcomes: ShadowJobOutcome[] = [];
    for (const claim of claims) {
      outcomes.push(await this.runClaim(claim));
    }
    return outcomes;
  }

  private async runClaim(claim: ShadowJobClaim) {
    const controller = new AbortController();
    const startedAt = this.now().getTime();
    try {
      const outcome = await this.deps.provider.decide(claim.frozenInput, controller.signal);
      const latencyMs = this.now().getTime() - startedAt;
      if (outcome.ok) {
        await this.deps.repository.completeJob(claim.decisionId, outcome.result, latencyMs);
        return {
          decisionId: claim.decisionId,
          status: "SUCCEEDED" as const,
          latencyMs,
          fallbackReason: null,
        };
      }
      return await this.handleFailure(claim, outcome.failure.error, outcome.failure.retryable);
    } catch (error) {
      // A provider that throws instead of answering is a provider fault, not
      // a reason to crash the loop.
      const message = error instanceof Error ? error.message : String(error);
      return await this.handleFailure(claim, `provider_error:${message}`, false);
    }
  }

  /**
   * Decides between retrying and giving up. Only a timeout or an unavailable
   * service is retried, and only within the bounded attempt count; every
   * other failure — a bad request, a forbidden endpoint, an invalid response
   * — is terminal, because retrying it would produce the same refusal.
   */
  private async handleFailure(
    claim: { decisionId: string; attempts: number },
    reason: string,
    retryable: boolean,
  ): Promise<ShadowJobOutcome> {
    const attempts = claim.attempts;
    if (retryable && attempts <= this.deps.maxRetries) {
      await this.deps.repository.requeueJob(claim.decisionId);
      return {
        decisionId: claim.decisionId,
        status: "RETRIED" as const,
        latencyMs: null,
        fallbackReason: reason,
      };
    }
    await this.deps.repository.failJob(claim.decisionId, reason);
    return {
      decisionId: claim.decisionId,
      status: "FAILED" as const,
      latencyMs: null,
      fallbackReason: reason,
    };
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch {
        // A database blip must not end the loop: the next scan is the recovery.
      }
      await this.waitForNextPoll();
    }
  }

  /** Sleeps for the poll interval, or until `notify` wakes us. */
  private async waitForNextPoll(): Promise<void> {
    if (!this.running) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.wake = resolve;
    const timer = setTimeout(resolve, Math.max(1, this.deps.pollIntervalMs));
    try {
      await Promise.race([promise, this.sleep(this.deps.pollIntervalMs)]);
    } finally {
      clearTimeout(timer);
      if (this.wake === resolve) this.wake = null;
    }
  }
}
