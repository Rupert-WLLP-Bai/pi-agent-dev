import type { AuditSnapshot } from "@contract-audit/audit/model";
import type {
  AgentRunResult,
  AgentRunTelemetry,
  AuditAgentPort,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import type { AuditCaseRepository } from "./db/repositories";
import type { AuditEventBroker } from "./sse";

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.includes("ABORTED"));

const PLACEHOLDER_TELEMETRY: AgentRunTelemetry = {
  provider: "pi",
  model: "unknown",
  version: "unknown",
  usage: null,
};

export class AuditDispatcher {
  private activeSessions = new Map<string, { abort: () => void }>();
  private cancelledCaseIds = new Set<string>();
  private queue: string[] = [];
  private running = 0;
  private started = false;

  constructor(
    private readonly repository: AuditCaseRepository,
    private readonly agentFactory: (snapshot: AuditSnapshot) => AuditAgentPort,
    private readonly broker: AuditEventBroker,
    private readonly maxConcurrent: number,
    private readonly subjectVerificationPort: SubjectVerificationPort,
    private readonly agentTimeoutMs: number = 0,
  ) {}

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    await this.repository.markStaleRunsInterrupted();
    this.started = true;
    const pendingCaseIds = await this.repository.getPendingCaseIds();
    this.queue.push(...pendingCaseIds);
    await this.processQueue();
  }

  async enqueue(auditCaseId: string): Promise<void> {
    this.queue.push(auditCaseId);
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const auditCaseId = this.queue.shift();
      if (auditCaseId === undefined) return;
      this.running += 1;
      void this.runAudit(auditCaseId);
    }
  }

  private async runAudit(auditCaseId: string): Promise<void> {
    try {
      // Claim the exact enqueued case; a stale or raced entry is a no-op.
      const claimed = await this.repository.claimCase(auditCaseId);
      if (!claimed) return;
      const snapshot = await this.repository.getSnapshot(claimed.snapshotId);
      if (!snapshot) throw new Error(`Audit snapshot not found for case ${auditCaseId}`);

      this.broker.publish({ type: "audit.started", auditCaseId });
      // Rules already ran while the snapshot was assembled, so the first stage
      // this dispatcher actually performs is the subject verification.
      this.broker.publish({ type: "rules.completed", auditCaseId });

      // Registered before the first network call, so a cancel arriving during
      // the subject stage is honoured rather than silently dropped.
      const controller = new AbortController();
      this.activeSessions.set(auditCaseId, { abort: () => controller.abort() });

      // The subject dimension runs as its own stage: it is a network call to an
      // external provider, and its answer becomes part of the bounded context
      // the agent reasons over rather than something it has to go and fetch.
      await this.repository.updateCaseStatus(auditCaseId, "RUNNING", "SUBJECT_VERIFICATION");
      const verification = await runSubjectVerification({
        parties: snapshot.parties,
        port: this.subjectVerificationPort,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      await this.repository.saveSubjectVerifications(auditCaseId, verification);

      const context: AuditSnapshot = {
        ...snapshot,
        evidence: [...snapshot.evidence, ...verification.evidence],
        ruleAssessments: [...snapshot.ruleAssessments, verification.ruleAssessment],
      };

      await this.repository.updateCaseStatus(auditCaseId, "RUNNING", "AGENT_RUNNING");
      this.broker.publish({ type: "agent.started", auditCaseId });

      const agent = this.agentFactory(context);
      const startedAt = Date.now();
      let result: AgentRunResult | undefined;
      let runError: unknown;
      try {
        result = await this.runAgentWithTimeout(agent, context, controller);
      } catch (error) {
        runError = error;
      }

      await this.repository.completeAgentRun({
        auditCaseId,
        ...(result?.telemetry ?? PLACEHOLDER_TELEMETRY),
        durationMs: Date.now() - startedAt,
        error:
          runError === undefined
            ? null
            : runError instanceof Error
              ? runError.message
              : String(runError),
      });
      if (runError !== undefined) throw runError;
      if (!result) throw new Error("AGENT_RUN_MISSING_RESULT");

      if (result.proposals.length === 0) {
        // No issues found — the case passes without review. Persist the
        // terminal state first: the SSE handler refetches on this event, and a
        // publish that overtakes the write leaves the detail view on
        // "审计进行中" with no later event to correct it.
        await this.repository.updateCaseStatus(auditCaseId, "COMPLETED", "COMPLETED");
        this.broker.publish({ type: "audit.completed", auditCaseId });
        return;
      }

      for (const proposal of result.proposals) {
        await this.repository.appendFindingRevision(auditCaseId, proposal, null);
        this.broker.publish({ type: "finding.proposed", auditCaseId, proposal });
      }
      await this.repository.updateCaseStatus(auditCaseId, "COMPLETED", "AWAITING_REVIEW");
      this.broker.publish({ type: "audit.awaiting_review", auditCaseId });
    } catch (error) {
      const cancelled = this.cancelledCaseIds.delete(auditCaseId) || isAbortError(error);
      if (cancelled) {
        this.broker.publish({ type: "audit.cancelled", auditCaseId });
        await this.repository.updateCaseStatus(auditCaseId, "CANCELLED", "CANCELLED");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.broker.publish({ type: "audit.failed", auditCaseId, error: message });
        await this.repository.updateCaseStatus(auditCaseId, "FAILED", "FAILED");
      }
    } finally {
      this.activeSessions.delete(auditCaseId);
      this.running -= 1;
      await this.processQueue();
    }
  }

  /**
   * Runs the agent with an optional wall-clock deadline. When `agentTimeoutMs`
   * is 0, no timer is set and the call is only bounded by the caller's
   * `AbortSignal` (cancel). Otherwise a timer fires at the deadline and the
   * resulting rejection is rethrown as `AGENT_TIMEOUT`.
   */
  private async runAgentWithTimeout(
    agent: AuditAgentPort,
    context: AuditSnapshot,
    parentController: AbortController,
  ): Promise<AgentRunResult> {
    if (this.agentTimeoutMs <= 0) {
      return agent.run(context, parentController.signal);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      parentController.abort();
    }, this.agentTimeoutMs);
    try {
      return await agent.run(context, parentController.signal);
    } catch (error) {
      if (timedOut) {
        throw new Error(`AGENT_TIMEOUT after ${this.agentTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async cancel(auditCaseId: string): Promise<void> {
    const session = this.activeSessions.get(auditCaseId);
    if (session) {
      this.cancelledCaseIds.add(auditCaseId);
      session.abort();
      return;
    }
    // Not running: drop it from the queue and cancel it if it is still pending.
    this.queue = this.queue.filter((id) => id !== auditCaseId);
    const auditCase = await this.repository.getCase(auditCaseId);
    if (auditCase?.status === "PENDING") {
      this.broker.publish({ type: "audit.cancelled", auditCaseId });
      await this.repository.updateCaseStatus(auditCaseId, "CANCELLED", "CANCELLED");
    }
  }

  async retry(auditCaseId: string): Promise<void> {
    await this.repository.updateCaseStatus(auditCaseId, "PENDING", "QUEUED");
    await this.enqueue(auditCaseId);
  }
}
