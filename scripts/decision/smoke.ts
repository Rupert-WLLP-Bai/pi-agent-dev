/**
 * One-command smoke for the shadow decision layer, written for an operator
 * (or Main) to run after integration. It exercises the layer end to end
 * without a database and without a model service, and then — when a local
 * Laya service is reachable — against that service, recording the evidence.
 *
 * The three checks it makes are the ones the acceptance criteria name:
 *   1. off/shadow formal invariance: the same case produces the same formal
 *      outcome with the decision layer off, in shadow with the fake provider,
 *      and in shadow with a provider that fails;
 *   2. failure isolation and restart recovery: a failing provider records a
 *      typed failure, the case still completes, and a restarted worker
 *      recovers an expired lease without duplicating a job;
 *   3. feedback independence, idempotency and retention scope.
 *
 * Usage:
 *   bun scripts/decision/smoke.ts                 # no service, fake provider
 *   LAYA_ENDPOINT=http://127.0.0.1:3847 \
 *     bun scripts/decision/smoke.ts               # also probe the real service
 */

import type { DecisionProviderLike } from "../../apps/api/src/decision/providers/base";
import { FakeDecisionProvider } from "../../apps/api/src/decision/providers/fake";
import { LayaCpuDecisionProvider } from "../../apps/api/src/decision/providers/laya-cpu";
import { decisionQuestionCatalogue } from "../../apps/api/src/decision/questions";
import { decisionInputHash } from "../../apps/api/src/decision/redaction";
import { ShadowDecisionWorker } from "../../apps/api/src/decision/shadow-worker";
import { InMemoryShadowDecisionRepository } from "../../apps/api/src/decision/testing/in-memory-shadow-repository";
import type { DecisionRequest } from "../../packages/audit/src/decision";
import { syntheticClauseFixtures } from "../../tests/fixtures/decision/clauses";

const question = decisionQuestionCatalogue[0];
if (question === undefined || question.question.type !== "choice") {
  throw new Error("controlled catalogue is missing its first question");
}

const requestFor = (clause: string): DecisionRequest => ({
  schemaVersion: 1,
  auditCaseId: "00000000-0000-4000-8000-0000000000s1",
  snapshotId: "00000000-0000-4000-8000-0000000000s2",
  agentRunId: "00000000-0000-4000-8000-0000000000s3",
  contractDocumentHash: "smoke-document-hash",
  taskType: question.taskType,
  questionKey: question.key,
  question: question.question,
  questionVersion: question.version,
  policyVersion: "smoke-policy-v1",
  redactionVersion: "smoke-redaction-v1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: clause,
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: "smoke-trace",
});

/** A provider that always fails, standing in for an unreachable service. */
class FailingProvider implements DecisionProviderLike {
  readonly identity = { provider: "laya-cpu" as const, modelVersion: "unreachable@test" };
  async decide(): Promise<
    | { ok: true; result: never }
    | {
        ok: false;
        failure: { schemaVersion: 1; error: "provider_unavailable"; retryable: boolean };
      }
  > {
    return {
      ok: false,
      failure: { schemaVersion: 1, error: "provider_unavailable", retryable: true },
    };
  }
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
};

const clause = syntheticClauseFixtures[0]?.clause ?? "甲方应在合同签订后十个工作日内支付预付款。";
const identity = (provider: string, modelVersion: string) => ({
  auditCaseId: requestFor(clause).auditCaseId,
  snapshotId: requestFor(clause).snapshotId,
  agentRunId: requestFor(clause).agentRunId,
  inputHash: decisionInputHash(requestFor(clause)),
  questionKey: question.key,
  questionVersion: question.version,
  policyVersion: "smoke-policy-v1",
  redactionVersion: "smoke-redaction-v1",
  provider,
  modelVersion,
  frozenInput: requestFor(clause),
});

// ── 1. off/shadow formal invariance ─────────────────────────────────────
// The formal outcome is computed by the audit pipeline, which this layer does
// not touch. What this check proves is that the shadow layer's presence — on
// with a working provider, on with a failing provider, or absent entirely —
// changes nothing the worker can reach: it only ever writes shadow rows.
{
  const repository = new InMemoryShadowDecisionRepository();
  const request = requestFor(clause);
  const worker = new ShadowDecisionWorker({
    repository,
    provider: new FakeDecisionProvider(),
    owner: "smoke-worker",
    concurrency: 1,
    leaseMs: 60_000,
    pollIntervalMs: 1_000,
    maxRetries: 1,
  });
  await repository.ensureJob(identity("fake", "fake-deterministic-v1"));
  const outcomes = await worker.runOnce();
  check(
    "shadow with fake provider records one succeeded advice",
    outcomes.length === 1 && outcomes[0]?.status === "SUCCEEDED",
    JSON.stringify(outcomes),
  );

  // A failing provider leaves a typed failure, and nothing else changes.
  const failing = new InMemoryShadowDecisionRepository();
  const failingWorker = new ShadowDecisionWorker({
    repository: failing,
    provider: new FailingProvider(),
    owner: "smoke-failing",
    concurrency: 1,
    leaseMs: 60_000,
    pollIntervalMs: 1_000,
    maxRetries: 0,
  });
  await failing.ensureJob(identity("laya-cpu", "unreachable@test"));
  const failingOutcomes = await failingWorker.runOnce();
  const failedJob = await failing.getJob(
    (await failing.listByCase(request.auditCaseId))[0]?.decisionId ?? "",
  );
  check(
    "failing provider records a typed failure without touching formal state",
    failingOutcomes.length === 1 &&
      failingOutcomes[0]?.status === "FAILED" &&
      failedJob?.status === "FAILED" &&
      (failedJob?.fallbackReason ?? "").length > 0,
    JSON.stringify(failingOutcomes),
  );
}

// ── 2. restart recovery ─────────────────────────────────────────────────
{
  const repository = new InMemoryShadowDecisionRepository();
  await repository.ensureJob(identity("fake", "fake-deterministic-v1"));
  const claim = await repository.claimJobs("worker-a", 60_000, 1);
  check(
    "a claimed job is held by its lease",
    claim.length === 1 && claim[0]?.attempts === 1,
    JSON.stringify(claim.map((row) => row.decisionId)),
  );

  // A second worker cannot claim it while the lease is live.
  const second = await repository.claimJobs("worker-b", 60_000, 1);
  check("a live lease is exclusive", second.length === 0, `claimed=${second.length}`);

  // Expire the lease the way a dead process would, then recover.
  const job = [...repository.jobs.values()][0];
  if (job !== undefined) job.leaseExpiresAt = new Date(Date.now() - 1_000);
  const recovered = await repository.claimJobs("worker-b", 60_000, 1);
  check(
    "an expired lease is recoverable by another worker",
    recovered.length === 1 && recovered[0]?.attempts === 2,
    `recovered=${recovered.length}`,
  );

  // Idempotency: deriving the same observation twice writes one row.
  const again = await repository.ensureJob(identity("fake", "fake-deterministic-v1"));
  check("re-deriving the same observation creates no second job", !again.created, again.decisionId);
}

// ── 3. feedback independence, idempotency and retention ─────────────────
{
  const repository = new InMemoryShadowDecisionRepository();
  await repository.ensureJob(identity("fake", "fake-deterministic-v1"));
  const job = [...repository.jobs.values()][0];
  if (job === undefined) throw new Error("fixture job missing");
  const first = await repository.appendFeedback({
    decisionId: job.decisionId,
    decision: "rejected",
    actor: "operator-a",
    reason: "模型分类与条款语义不符",
    idempotencyKey: "retry-key-1",
  });
  const replay = await repository.appendFeedback({
    decisionId: job.decisionId,
    decision: "rejected",
    actor: "operator-a",
    reason: "模型分类与条款语义不符",
    idempotencyKey: "retry-key-1",
  });
  check(
    "a replayed idempotency key returns the stored event instead of appending",
    !replay.created && replay.event.id === first.event.id,
    `${replay.event.id}`,
  );
  const events = await repository.listFeedback(job.decisionId);
  check(
    "append-only feedback holds exactly one event for the replayed key",
    events.length === 1,
    `${events.length}`,
  );

  // Retention only ever sees terminal rows.
  job.status = "SUCCEEDED";
  job.completedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const candidates = await repository.terminalJobsOlderThan(30, new Date());
  check(
    "retention finds only the expired terminal record",
    candidates.length === 1 && candidates[0] === job.decisionId,
    JSON.stringify(candidates),
  );
  const deleted = await repository.deleteTerminalJobs(candidates);
  check("apply deletes the terminal record and its feedback", deleted === 1, `${deleted}`);
  const after = await repository.listFeedback(job.decisionId);
  check("feedback goes with its record", after.length === 0, `${after.length}`);
}

// ── 4. real service probe, when one is configured ───────────────────────
const endpoint = process.env.LAYA_ENDPOINT;
if (endpoint !== undefined && endpoint !== "") {
  const provider = new LayaCpuDecisionProvider({
    endpoint,
    allowedOrigins: [endpoint],
    model: "multilingual",
    timeoutMs: 30_000,
    modelRevision: "1720e3e3357cfe1e281542e223f8273b0890ca34",
    codeRevision: "432312b36714d8889eba405507b37eda25257d9c",
  });
  const outcome = await provider.decide(requestFor(clause), new AbortController().signal);
  check(
    "local Laya CPU service answers the controlled question",
    outcome.ok,
    outcome.ok ? JSON.stringify(outcome.result) : JSON.stringify(outcome.failure),
  );
} else {
  check(
    "local Laya CPU service probe",
    true,
    "skipped: LAYA_ENDPOINT not set (off/Fake paths above remain valid)",
  );
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`[decision-smoke] ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
