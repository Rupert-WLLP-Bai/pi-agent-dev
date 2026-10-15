import { describe, expect, test } from "bun:test";
import type { DecisionProviderResult, DecisionRequest } from "@contract-audit/audit/decision";
import type { DecisionProviderLike } from "./providers/base";
import { InMemoryShadowDecisionRepository } from "./testing/in-memory-shadow-repository";
import { ShadowDecisionWorker } from "./shadow-worker";
import { toDecisionAdvice } from "./shadow-repository";
import { decisionInputHash } from "./redaction";
import { decisionQuestionCatalogue } from "./questions";

const question = decisionQuestionCatalogue[0];
if (question === undefined || question.question.type !== "choice") {
  throw new Error("catalogue missing its first question");
}

const request: DecisionRequest = {
  schemaVersion: 1,
  auditCaseId: "case-1",
  snapshotId: "snapshot-1",
  agentRunId: "run-1",
  contractDocumentHash: "doc-hash",
  taskType: question.taskType,
  questionKey: question.key,
  question: question.question,
  questionVersion: question.version,
  policyVersion: "p1",
  redactionVersion: "r1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: "甲方应在合同签订后十个工作日内支付预付款。",
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: "trace-1",
};

const identity = (provider: string, modelVersion: string) => ({
  auditCaseId: request.auditCaseId,
  snapshotId: request.snapshotId,
  agentRunId: request.agentRunId,
  inputHash: decisionInputHash(request),
  questionKey: question.key,
  questionVersion: question.version,
  policyVersion: request.policyVersion,
  redactionVersion: request.redactionVersion,
  provider,
  modelVersion,
  frozenInput: request,
});

const result: DecisionProviderResult = {
  schemaVersion: 1,
  modelVersion: "test-model",
  answer: { type: "choice", choice: "payment" },
  rawProbabilities: { payment: 1, dispute: 0 },
  rawScore: null,
  confidence: null,
  confidenceType: "none",
  usage: null,
};

class SucceedingProvider implements DecisionProviderLike {
  readonly identity = { provider: "fake" as const, modelVersion: "test-model" };
  calls = 0;
  async decide(): Promise<{ ok: true; result: DecisionProviderResult }> {
    this.calls += 1;
    return { ok: true, result };
  }
}

class UnavailableProvider implements DecisionProviderLike {
  readonly identity = { provider: "laya-cpu" as const, modelVersion: "unreachable" };
  calls = 0;
  async decide(): Promise<
    | { ok: true; result: DecisionProviderResult }
    | {
        ok: false;
        failure: { schemaVersion: 1; error: "provider_unavailable"; retryable: boolean };
      }
  > {
    this.calls += 1;
    return {
      ok: false,
      failure: { schemaVersion: 1, error: "provider_unavailable", retryable: true },
    };
  }
}

const workerFor = (
  repository: InMemoryShadowDecisionRepository,
  provider: DecisionProviderLike,
  overrides: Partial<{ owner: string; concurrency: number; leaseMs: number; maxRetries: number }> = {},
): ShadowDecisionWorker =>
  new ShadowDecisionWorker({
    repository,
    provider,
    owner: overrides.owner ?? "worker-1",
    concurrency: overrides.concurrency ?? 1,
    leaseMs: overrides.leaseMs ?? 60_000,
    pollIntervalMs: 1_000,
    maxRetries: overrides.maxRetries ?? 1,
  });

describe("ShadowDecisionWorker", () => {
  test("runs a derived job once and records the succeeded advice", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const provider = new SucceedingProvider();
    await repository.ensureJob(identity("fake", "test-model"));
    const outcomes = await workerFor(repository, provider).runOnce();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe("SUCCEEDED");
    expect(provider.calls).toBe(1);
    const job = [...repository.jobs.values()][0];
    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.result?.answer).toEqual({ type: "choice", choice: "payment" });
    // A completed job is not claimable again.
    expect(await repository.claimJobs("worker-2", 60_000, 1)).toHaveLength(0);
  });

  test("a retryable failure is requeued and retried within the bound", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const provider = new UnavailableProvider();
    await repository.ensureJob(identity("laya-cpu", "unreachable"));

    // Attempt 1 fails and is requeued.
    const first = await workerFor(repository, provider, { maxRetries: 1 }).runOnce();
    expect(first[0]?.status).toBe("RETRIED");
    const job = [...repository.jobs.values()][0];
    expect(job?.status).toBe("PENDING");

    // Attempt 2 exhausts the bound: the job is terminal, not retried again.
    const second = await workerFor(repository, provider, { maxRetries: 1 }).runOnce();
    expect(second[0]?.status).toBe("FAILED");
    expect(job?.status).toBe("FAILED");
    expect(job?.fallbackReason).toBe("provider_unavailable");
    expect(provider.calls).toBe(2);

    // A terminal job is never claimed again.
    expect(await repository.claimJobs("worker-3", 60_000, 1)).toHaveLength(0);
  });

  test("a non-retryable failure is terminal on the first attempt", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    class RefusingProvider implements DecisionProviderLike {
      readonly identity = { provider: "laya-cpu" as const, modelVersion: "refusing" };
      async decide(): Promise<{
        ok: false;
        failure: { schemaVersion: 1; error: "invalid_response"; retryable: boolean };
      }> {
        return { ok: false, failure: { schemaVersion: 1, error: "invalid_response", retryable: false } };
      }
    }
    await repository.ensureJob(identity("laya-cpu", "refusing"));
    const outcomes = await workerFor(repository, new RefusingProvider(), { maxRetries: 5 }).runOnce();
    expect(outcomes[0]?.status).toBe("FAILED");
    expect([...repository.jobs.values()][0]?.status).toBe("FAILED");
  });

  test("a provider that throws is recorded as a failure, not a crash", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    class ThrowingProvider implements DecisionProviderLike {
      readonly identity = { provider: "laya-cpu" as const, modelVersion: "throwing" };
      async decide(): Promise<never> {
        throw new Error("socket hang up");
      }
    }
    await repository.ensureJob(identity("laya-cpu", "throwing"));
    const outcomes = await workerFor(repository, new ThrowingProvider(), { maxRetries: 0 }).runOnce();
    expect(outcomes[0]?.status).toBe("FAILED");
    expect(outcomes[0]?.fallbackReason).toContain("provider_error");
  });

  test("a live lease is exclusive and an expired one is recoverable", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob(identity("fake", "test-model"));

    const claimed = await repository.claimJobs("worker-a", 60_000, 1);
    expect(claimed).toHaveLength(1);

    // While the lease is live, another worker sees nothing.
    expect(await repository.claimJobs("worker-b", 60_000, 1)).toHaveLength(0);
    const secondRun = await workerFor(repository, new SucceedingProvider(), {
      owner: "worker-b",
    }).runOnce();
    expect(secondRun).toHaveLength(0);

    // Expire it, the way a dead process would, and the next worker recovers.
    const job = [...repository.jobs.values()][0];
    if (job !== undefined) job.leaseExpiresAt = new Date(Date.now() - 1_000);
    const recovered = await workerFor(repository, new SucceedingProvider(), {
      owner: "worker-b",
    }).runOnce();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe("SUCCEEDED");
    expect(job?.attempts).toBe(2);
  });

  test("re-deriving the same observation never creates a second job", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    const first = await repository.ensureJob(identity("fake", "test-model"));
    const second = await repository.ensureJob(identity("fake", "test-model"));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.decisionId).toBe(first.decisionId);
    expect(repository.jobs.size).toBe(1);
  });

  test("stopping releases the worker's leases", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob(identity("fake", "test-model"));
    await repository.claimJobs("worker-stop", 60_000, 1);
    const released = await repository.releaseLeases("worker-stop");
    expect(released).toBe(1);
    expect([...repository.jobs.values()][0]?.status).toBe("PENDING");
  });

  test("the worker loop runs a pass and stops without hanging", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob(identity("fake", "test-model"));
    // A sleep that resolves immediately: the loop's pacing is not what this
    // test is about, and a real 1s poll would slow the suite for nothing.
    const worker = new ShadowDecisionWorker({
      repository,
      provider: new SucceedingProvider(),
      owner: "worker-loop",
      concurrency: 1,
      leaseMs: 60_000,
      pollIntervalMs: 1,
      maxRetries: 1,
      // A real timer, so the loop yields between passes instead of spinning
      // the microtask queue and starving the test.
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    });
    await worker.start();
    expect(worker.isRunning).toBe(true);
    // One pass completes the only job; stop before the next poll.
    await worker.stop();
    expect(worker.isRunning).toBe(false);
    expect([...repository.jobs.values()][0]?.status).toBe("SUCCEEDED");
  });
});

describe("shadow advice projection", () => {
  test("an unverified answer is never reported as calibrated", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob(identity("fake", "test-model"));
    await workerFor(repository, new SucceedingProvider()).runOnce();
    const job = [...repository.jobs.values()][0];
    if (job === undefined) throw new Error("job missing");
    const advice = toDecisionAdvice(job);
    expect(advice.calibrated).toBe(false);
    expect(advice.uncertainty).toBe("uncalibrated");
    expect(advice.threshold).toBeNull();
    expect(advice.needsHumanReview).toBe(true);
    expect(advice.mode).toBe("shadow");
  });

  test("a job with no result reports unavailable uncertainty, not a zero", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob(identity("fake", "test-model"));
    const job = [...repository.jobs.values()][0];
    if (job === undefined) throw new Error("job missing");
    const advice = toDecisionAdvice(job);
    expect(advice.status).toBe("PENDING");
    expect(advice.answer).toBeNull();
    expect(advice.uncertainty).toBe("unavailable");
  });

  test("a comparison against the same proposition is recorded as a conflict", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob({
      ...identity("fake", "test-model"),
      frozenInput: {
        ...request,
        comparison: {
          assessmentId: "assessment-1",
          ruleCode: "ADVANCE_PAYMENT_LIMIT",
          baselineAnswer: { type: "choice", choice: "dispute" },
        },
      },
    });
    await workerFor(repository, new SucceedingProvider()).runOnce();
    const job = [...repository.jobs.values()][0];
    if (job === undefined) throw new Error("job missing");
    const advice = toDecisionAdvice(job);
    expect(advice.ruleConflicts).toHaveLength(1);
    expect(advice.ruleConflicts[0]?.conflictType).toBe("OPPOSED_ASSESSMENT");
    expect(advice.ruleConflicts[0]?.baselineAnswer).toEqual({ type: "choice", choice: "dispute" });
  });

  test("an agreeing answer produces no conflict", async () => {
    const repository = new InMemoryShadowDecisionRepository();
    await repository.ensureJob({
      ...identity("fake", "test-model"),
      frozenInput: {
        ...request,
        comparison: {
          assessmentId: "assessment-1",
          ruleCode: "ADVANCE_PAYMENT_LIMIT",
          baselineAnswer: { type: "choice", choice: "payment" },
        },
      },
    });
    await workerFor(repository, new SucceedingProvider()).runOnce();
    const job = [...repository.jobs.values()][0];
    if (job === undefined) throw new Error("job missing");
    expect(toDecisionAdvice(job).ruleConflicts).toHaveLength(0);
  });
});
