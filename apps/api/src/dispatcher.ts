import { createAgentTraceCollector } from "@contract-audit/audit/agent-trace";
import type { AuditSnapshot } from "@contract-audit/audit/model";
import {
  counterpartyCreditCodes,
  counterpartyNames,
  evaluatePartyHistoryRule,
} from "@contract-audit/audit/party-history-rule";
import type {
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { ensureRunSnapshot } from "./audit/assemble-run-snapshot";
import type { AuditCaseRepository } from "./db/repositories";
import type { RuleRepository } from "./db/rule-repository";
import type { AuditEventBroker } from "./sse";

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.includes("ABORTED"));

export class AuditDispatcher {
  private activeSessions = new Map<string, { abort: () => void }>();
  private cancelledCaseIds = new Set<string>();
  private running = 0;
  private started = false;

  constructor(
    private readonly repository: AuditCaseRepository,
    private readonly agentFactory: (snapshot: AuditSnapshot) => AuditAgentPort,
    private readonly broker: AuditEventBroker,
    private readonly maxConcurrent: number,
    private readonly subjectVerificationPort: SubjectVerificationPort,
    private readonly agentTimeoutMs: number = 0,
    /**
     * Reads the operator's enabled/disabled rule overlay. Read fresh on every
     * run (including retries), so a rule disabled after enqueue is honoured.
     * Absent means "no overlay": every rule is treated as enabled.
     */
    private readonly rules?: RuleRepository,
  ) {}

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    await this.repository.markStaleRunsInterrupted();
    this.started = true;
    await this.processQueue();
  }

  /**
   * Makes a case claimable and wakes the claim loop. The case row is the
   * queue, not this process: promoting it to PENDING is what lets any replica
   * pick it up, so the work survives a restart and is visible cluster-wide.
   * A case another replica already claimed is left alone — re-promoting
   * RUNNING work would run the same case twice.
   */
  async enqueue(auditCaseId: string): Promise<void> {
    // Atomically promote to PENDING only if the case is not already RUNNING.
    // This prevents a race where two dispatchers interleave getCase + update
    // and one reverts an already-claimed RUNNING case back to PENDING.
    await this.repository.requeueIfNotRunning(auditCaseId);
    await this.processQueue();
  }

  /**
   * Drains claimable work until the concurrency budget is spent or no case is
   * left. Every replica runs this loop, so it deliberately holds no local
   * state: the atomic claim (`FOR UPDATE SKIP LOCKED`) is what divides the
   * pending cases among them without a shared lock.
   */
  private async processQueue(): Promise<void> {
    while (this.running < this.maxConcurrent) {
      const claimed = await this.repository.claimNextPendingCase();
      if (claimed === null) return;
      this.running += 1;
      void this.runAudit(claimed);
    }
  }

  private async runAudit(claimed: { caseId: string; snapshotId: string | null }): Promise<void> {
    const auditCaseId = claimed.caseId;
    try {
      if (!this.rules) throw new Error("RULE_REPOSITORY_REQUIRED");
      const snapshot = await ensureRunSnapshot(this.repository, auditCaseId, this.rules);

      this.broker.publish({ type: "audit.started", auditCaseId });
      // Rules already ran while the snapshot was assembled, so the first stage
      // this dispatcher actually performs is the subject verification.
      // The disposition counts ride along so a viewer can show coverage while
      // the agent is still running.
      this.broker.publish({
        type: "rules.completed",
        auditCaseId,
        summary: snapshot.ruleAssessments.reduce(
          (summary, assessment) => {
            summary.total += 1;
            if (assessment.disposition === "COMPLIANT") summary.compliant += 1;
            if (assessment.disposition === "NEEDS_HUMAN_REVIEW") summary.needsReview += 1;
            if (assessment.disposition === "POLICY_CONFLICT") summary.conflict += 1;
            return summary;
          },
          { total: 0, conflict: 0, needsReview: 0, compliant: 0 },
        ),
      });

      const listed = this.rules ? await this.rules.listEnabledCodes() : null;
      // An empty overlay means "no rule rows yet" (tests / unseeded DB), not
      // "every rule disabled". Only a non-empty list is treated as selective.
      const enabledCodes = listed === null || listed.length === 0 ? null : new Set(listed);
      const subjectEnabled = enabledCodes === null || enabledCodes.has("SUBJECT_RED_LINE_RISK");

      // Registered before the first network call, so a cancel arriving during
      // the subject stage is honoured rather than silently dropped.
      const controller = new AbortController();
      this.activeSessions.set(auditCaseId, { abort: () => controller.abort() });

      // The subject dimension runs as its own stage: it is a network call to an
      // external provider, and its answer becomes part of the bounded context
      // the agent reasons over rather than something it has to go and fetch.
      // A disabled SUBJECT_RED_LINE_RISK skips the stage wholesale: no provider
      // call, no stored verifications, and no assessment merged into context.
      let context: AuditSnapshot = snapshot;
      if (subjectEnabled) {
        await this.repository.updateCaseStatus(auditCaseId, "RUNNING", "SUBJECT_VERIFICATION");
        const verification = await runSubjectVerification({
          parties: snapshot.parties,
          port: this.subjectVerificationPort,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        await this.repository.saveSubjectVerifications(auditCaseId, verification);

        context = {
          ...snapshot,
          evidence: [...snapshot.evidence, ...verification.evidence],
          ruleAssessments: [...snapshot.ruleAssessments, verification.ruleAssessment],
        };
      }

      const historyEnabled = enabledCodes === null || enabledCodes.has("PARTY_HISTORY_ASSOCIATION");
      if (historyEnabled) {
        const auditCase = await this.repository.getCase(auditCaseId);
        const { verifications } = await this.repository.getSubjectDimension(auditCaseId);
        const creditCodes = counterpartyCreditCodes(context.parties, verifications);
        const prior = await this.repository.findPriorPartyCases({
          excludeCaseId: auditCaseId,
          createdBefore: new Date(auditCase?.createdAt ?? Date.now()),
          partyNames: counterpartyNames(context.parties),
          creditCodes,
        });
        const history = evaluatePartyHistoryRule({
          parties: context.parties,
          priorFindings: prior,
        });
        await this.repository.savePartyHistory(auditCaseId, history);
        context = {
          ...context,
          evidence: [...context.evidence, ...history.evidence],
          ruleAssessments: [...context.ruleAssessments, history.assessment],
        };
      }

      await this.repository.updateCaseStatus(auditCaseId, "RUNNING", "AGENT_RUNNING");
      this.broker.publish({ type: "agent.started", auditCaseId });

      const agent = this.agentFactory(context);
      const runId = await this.repository.beginAgentRun({ auditCaseId, ...agent.identity });
      const trace = createAgentTraceCollector(runId, async (step) => {
        await this.repository.appendAgentTraceStep(auditCaseId, step);
        this.broker.publish({ type: "agent.trace", auditCaseId, step });
      });

      const startedAt = Date.now();
      let result: AgentRunResult | undefined;
      let runError: unknown;
      try {
        result = await this.runAgentWithTimeout(agent, context, controller, trace.sink);
      } catch (error) {
        runError = error;
      }

      // Flush before closing the run: a viewer that opens the trace the moment
      // the case settles must not find the tail of the trace still queued.
      await trace.flush();

      await this.repository.finishAgentRun(runId, {
        usage: result?.usage ?? null,
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
        await this.repository.refreshRemediationClosureHints(auditCaseId);
        this.broker.publish({ type: "audit.completed", auditCaseId });
        return;
      }

      for (const proposal of result.proposals) {
        await this.repository.appendFindingRevision(auditCaseId, proposal, null);
        this.broker.publish({ type: "finding.proposed", auditCaseId, proposal });
      }
      await this.repository.updateCaseStatus(auditCaseId, "AWAITING_REVIEW", "AWAITING_REVIEW");
      await this.repository.refreshRemediationClosureHints(auditCaseId);
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
    trace: AgentTraceSink,
  ): Promise<AgentRunResult> {
    if (this.agentTimeoutMs <= 0) {
      return agent.run(context, parentController.signal, trace);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      parentController.abort();
    }, this.agentTimeoutMs);
    try {
      return await agent.run(context, parentController.signal, trace);
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
    // Not running here: cancel it in the repository while it is still pending,
    // so no replica can claim it out from under the cancellation.
    const auditCase = await this.repository.getCase(auditCaseId);
    if (auditCase?.status === "PENDING") {
      this.broker.publish({ type: "audit.cancelled", auditCaseId });
      await this.repository.updateCaseStatus(auditCaseId, "CANCELLED", "CANCELLED");
    }
  }

  async retry(auditCaseId: string): Promise<void> {
    await this.enqueue(auditCaseId);
  }
}
