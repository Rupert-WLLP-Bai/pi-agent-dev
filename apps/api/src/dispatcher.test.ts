import { beforeEach, expect, test } from "bun:test";
import type { AuditSnapshot, ContractParty, FindingProposal } from "@contract-audit/audit/model";
import type { AuditEvent } from "@contract-audit/audit/ports";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { AuditDispatcher } from "./dispatcher";
import {
  ControlledAgent,
  InMemoryAuditCaseRepository,
  RecordingEventBroker,
} from "./testing/fakes";

const snapshotFor = (sourceRecordId: string, parties: ContractParty[] = []): AuditSnapshot => ({
  sourceRecordId,
  contractDocument: { hash: `hash-${sourceRecordId}`, blocks: [] },
  facts: { advancePaymentRatio: 0.7, policyLimitRatio: 0.3 },
  parties,
  evidence: [
    {
      id: "contract-payment",
      sourceRecordId,
      location: {
        kind: "DOCUMENT_SPAN",
        contractDocumentHash: `hash-${sourceRecordId}`,
        blockId: "p-1",
        startOffset: 0,
        endOffset: 3,
        quotedText: "70%",
      },
    },
  ],
  ruleAssessments: [
    {
      id: "assessment-payment",
      disposition: "POLICY_CONFLICT",
      ruleCode: "ADVANCE_PAYMENT_LIMIT",
      evidenceIds: ["contract-payment", "policy-limit"],
      basis: "预付款比例 70% 高于制度上限 30%。",
    },
  ],
  createdAt: new Date(0).toISOString(),
});

const party = (id: string, name: string): ContractParty => ({
  id,
  label: "乙方",
  name,
  evidenceId: `${id}-name`,
});

const proposal: FindingProposal = {
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  severity: "HIGH",
  rationale: "Advance payment exceeds the policy limit",
  evidenceIds: ["contract-payment"],
  remediation: "Reduce the advance payment ratio",
};

/**
 * Lets the dispatcher's fire-and-forget `runAudit` drain. Every repository call
 * it awaits is an already-resolved promise, so advancing the microtask queue is
 * enough — no wall-clock wait and no fake clock are needed.
 */
const drainAsync = async (): Promise<void> => {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve();
};

let repository: InMemoryAuditCaseRepository;
let agent: ControlledAgent;
let broker: RecordingEventBroker;
let dispatcher: AuditDispatcher;

beforeEach(async () => {
  repository = new InMemoryAuditCaseRepository();
  agent = new ControlledAgent();
  broker = new RecordingEventBroker();
  dispatcher = new AuditDispatcher(
    repository.asRepository(),
    () => agent,
    broker.asBroker(),
    1,
    createFixtureSubjectVerificationPort(),
  );
  await dispatcher.start();
});

test("does not run more than one audit when concurrency is one", async () => {
  const { caseId: caseA } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  const { caseId: caseB } = await repository.createPendingCase("source-b", snapshotFor("source-b"));
  await dispatcher.enqueue(caseA);
  await dispatcher.enqueue(caseB);

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(agent.startedCaseIds).toEqual(["source-a"]);

  agent.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(agent.startedCaseIds).toEqual(["source-a", "source-b"]);
  agent.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("enqueue makes the case claimable in the repository without dispatching locally", async () => {
  // Occupy the single concurrency slot so the enqueued case cannot be claimed
  // yet — its only remaining home is the repository row.
  const { caseId: blocker } = await repository.createPendingCase(
    "source-blocker",
    snapshotFor("source-blocker"),
  );
  await dispatcher.enqueue(blocker);
  await drainAsync();
  expect(agent.startedCaseIds).toEqual(["source-blocker"]);

  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  // Start from a terminal status so the write to PENDING is unambiguously the
  // enqueue's doing.
  await repository.updateCaseStatus(caseId, "FAILED", "FAILED");
  await dispatcher.enqueue(caseId);

  expect(await repository.getCase(caseId)).toMatchObject({ status: "PENDING", stage: "QUEUED" });
  expect(agent.startedCaseIds).toEqual(["source-blocker"]);

  // Releasing the slot lets the claim loop pick the case up from the DB.
  agent.resolveRun([proposal]);
  await drainAsync();
  expect(agent.startedCaseIds).toEqual(["source-blocker", "source-a"]);
  agent.resolveRun([proposal]);
  await drainAsync();
});

test("two dispatchers sharing a repository run the same case only once", async () => {
  const otherAgent = new ControlledAgent();
  const otherBroker = new RecordingEventBroker();
  const otherDispatcher = new AuditDispatcher(
    repository.asRepository(),
    () => otherAgent,
    otherBroker.asBroker(),
    1,
    createFixtureSubjectVerificationPort(),
  );
  await otherDispatcher.start();

  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  // Both replicas are notified, as happens when the API node that accepted the
  // upload is not the node that runs the audit.
  await Promise.all([dispatcher.enqueue(caseId), otherDispatcher.enqueue(caseId)]);
  await drainAsync();

  // The atomic claim handed the case to exactly one replica: it is RUNNING and
  // nothing is left pending for the other to pick up.
  expect(await repository.getCase(caseId)).toMatchObject({ status: "RUNNING" });
  expect(await repository.getPendingCaseIds()).toEqual([]);
  expect(repository.recordedRuns).toHaveLength(1);
  expect([...agent.startedCaseIds, ...otherAgent.startedCaseIds]).toEqual(["source-a"]);

  // Resolve on both: only the owner holds a pending run.
  agent.resolveRun([proposal]);
  otherAgent.resolveRun([proposal]);
  await drainAsync();
  expect(repository.recordedRuns).toHaveLength(1);
});

test("claimNextPendingCase hands out pending cases in creation order", async () => {
  const { caseId: first } = await repository.createPendingCase(
    "source-first",
    snapshotFor("source-first"),
  );
  const { caseId: second } = await repository.createPendingCase(
    "source-second",
    snapshotFor("source-second"),
  );

  expect(await repository.claimNextPendingCase()).toMatchObject({ caseId: first });
  expect(await repository.claimNextPendingCase()).toMatchObject({ caseId: second });
  expect(await repository.claimNextPendingCase()).toBeNull();
});

test("completes the audit for the enqueued case and records the run", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  await dispatcher.enqueue(caseId);

  await new Promise((resolve) => setTimeout(resolve, 10));
  agent.resolveRun([proposal], { input: 10, output: 5 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const auditCase = await repository.getCase(caseId);
  expect(auditCase).toMatchObject({ status: "COMPLETED", stage: "AWAITING_REVIEW" });
  expect(repository.recordedRuns).toHaveLength(1);
  expect(repository.recordedRuns[0]).toMatchObject({
    auditCaseId: caseId,
    identity: { provider: "test", model: "test-model", version: "0" },
    usage: { input: 10, output: 5 },
    error: null,
  });
  expect((await repository.getFindingsByCase(caseId))[0].proposal).toEqual(proposal);
  expect(broker.events.map((event) => event.type)).toEqual([
    "audit.started",
    "rules.completed",
    "agent.started",
    "finding.proposed",
    "audit.awaiting_review",
  ]);
});

test("publishes rule coverage with the rules.completed event", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  await dispatcher.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const event = broker.events.find(
    (item): item is Extract<AuditEvent, { type: "rules.completed" }> =>
      item.type === "rules.completed",
  );
  expect(event?.summary).toEqual({ total: 1, conflict: 1, needsReview: 0, compliant: 0 });

  agent.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("hands the agent a context that includes the subject verification evidence", async () => {
  const { caseId } = await repository.createPendingCase(
    "source-a",
    snapshotFor("source-a", [party("party-1", "深圳精工科技有限公司")]),
  );
  await dispatcher.enqueue(caseId);

  await new Promise((resolve) => setTimeout(resolve, 10));
  agent.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const context = agent.receivedSnapshots[0];
  expect(context.evidence.some((locator) => locator.location.kind === "EXTERNAL_RECORD")).toBe(
    true,
  );
  expect(context.ruleAssessments.some((item) => item.ruleCode === "SUBJECT_RED_LINE_RISK")).toBe(
    true,
  );
});

test("records an unavailable subject verification without failing the case", async () => {
  const repository2 = new InMemoryAuditCaseRepository();
  const agent2 = new ControlledAgent();
  const broker2 = new RecordingEventBroker();
  const disputed = "重庆恒昌建筑工程有限公司";
  const dispatcher2 = new AuditDispatcher(
    repository2.asRepository(),
    () => agent2,
    broker2.asBroker(),
    1,
    createFixtureSubjectVerificationPort({ unavailable: [disputed] }),
  );
  await dispatcher2.start();
  const { caseId } = await repository2.createPendingCase(
    "source-degraded",
    snapshotFor("source-degraded", [party("party-1", disputed)]),
  );

  await dispatcher2.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));
  agent2.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(await repository2.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "AWAITING_REVIEW",
  });
  const { verifications } = await repository2.getSubjectDimension(caseId);
  expect(verifications).toHaveLength(1);
  expect(verifications[0].status).toBe("UNAVAILABLE");
  expect(verifications[0].failureReason).not.toBeNull();
});

test("marks an active run cancelled after explicit cancellation", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  await dispatcher.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  await dispatcher.cancel(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(agent.abortedRuns).toBe(1);
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "CANCELLED",
    stage: "CANCELLED",
  });
  expect(broker.events.at(-1)?.type).toBe("audit.cancelled");
  expect(repository.recordedRuns).toHaveLength(1);
});

test("cancels a queued case without running it", async () => {
  const { caseId: running } = await repository.createPendingCase(
    "source-a",
    snapshotFor("source-a"),
  );
  const { caseId: queued } = await repository.createPendingCase(
    "source-b",
    snapshotFor("source-b"),
  );
  await dispatcher.enqueue(running);
  await dispatcher.enqueue(queued);
  await new Promise((resolve) => setTimeout(resolve, 10));

  await dispatcher.cancel(queued);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(agent.startedCaseIds).toEqual(["source-a"]);
  expect(await repository.getCase(queued)).toMatchObject({
    status: "CANCELLED",
    stage: "CANCELLED",
  });
  expect(
    broker.events.some((event) => event.type === "audit.cancelled" && event.auditCaseId === queued),
  ).toBe(true);

  agent.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("marks a failed agent run as FAILED and records the error", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  await dispatcher.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  agent.rejectRun(new Error("XYG_ENDPOINT_UNREACHABLE"));
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(await repository.getCase(caseId)).toMatchObject({ status: "FAILED", stage: "FAILED" });
  expect(repository.recordedRuns[0].error).toBe("XYG_ENDPOINT_UNREACHABLE");
  expect(broker.events.at(-1)).toMatchObject({
    type: "audit.failed",
    auditCaseId: caseId,
    error: "XYG_ENDPOINT_UNREACHABLE",
  });
});

test("leaves a case another runner already claimed untouched", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  // Another replica won the claim first.
  await repository.claimCase(caseId);
  await repository.updateCaseStatus(caseId, "RUNNING", "AGENT_RUNNING");

  await dispatcher.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(agent.startedCaseIds).toEqual([]);
  expect((await repository.getCase(caseId))?.status).toBe("RUNNING");
});

test("marks stale RUNNING cases interrupted and claims pending cases on start", async () => {
  const repository2 = new InMemoryAuditCaseRepository();
  const agent2 = new ControlledAgent();
  const broker2 = new RecordingEventBroker();
  const { caseId: stale } = await repository2.createPendingCase(
    "source-stale",
    snapshotFor("source-stale"),
  );
  await repository2.updateCaseStatus(stale, "RUNNING", "AGENT_RUNNING");
  await repository2.createPendingCase("source-pending", snapshotFor("source-pending"));

  const dispatcher2 = new AuditDispatcher(
    repository2.asRepository(),
    () => agent2,
    broker2.asBroker(),
    1,
    createFixtureSubjectVerificationPort(),
  );
  await dispatcher2.start();
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(await repository2.getCase(stale)).toMatchObject({ status: "INTERRUPTED" });
  expect(agent2.startedCaseIds).toEqual(["source-pending"]);
  agent2.resolveRun([proposal]);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("times out a stalled agent run and marks the case FAILED", async () => {
  const repo = new InMemoryAuditCaseRepository();
  const stalledAgent = new ControlledAgent();
  const stalledBroker = new RecordingEventBroker();
  const { caseId } = await repo.createPendingCase("source-timeout", snapshotFor("source-timeout"));

  const timeoutDispatcher = new AuditDispatcher(
    repo.asRepository(),
    () => stalledAgent,
    stalledBroker.asBroker(),
    1,
    createFixtureSubjectVerificationPort(),
    50, // 50 ms deadline
  );
  await timeoutDispatcher.start();
  await timeoutDispatcher.enqueue(caseId);

  // Integration test: the dispatcher's timeout uses a real setTimeout, so we
  // must wait on the platform clock. Fake timers cannot drive the abort path
  // because the ControlledAgent's signal listener fires synchronously.
  await new Promise((resolve) => setTimeout(resolve, 200));

  expect(stalledAgent.abortedRuns).toBe(1);
  expect(await repo.getCase(caseId)).toMatchObject({ status: "FAILED", stage: "FAILED" });
  expect(repo.recordedRuns[0].error).toContain("AGENT_TIMEOUT");
  expect(stalledBroker.events.at(-1)).toMatchObject({
    type: "audit.failed",
    auditCaseId: caseId,
  });
});

test("skips subject verification when SUBJECT_RED_LINE_RISK is not enabled", async () => {
  const repo = new InMemoryAuditCaseRepository();
  const disabledAgent = new ControlledAgent();
  const disabledBroker = new RecordingEventBroker();
  const disabledDispatcher = new AuditDispatcher(
    repo.asRepository(),
    () => disabledAgent,
    disabledBroker.asBroker(),
    1,
    createFixtureSubjectVerificationPort(),
    0,
    { listEnabledCodes: async () => ["ADVANCE_PAYMENT_LIMIT"] },
  );
  await disabledDispatcher.start();
  const originalSnapshot = snapshotFor("source-disabled", [
    party("party-1", "深圳精工科技有限公司"),
  ]);
  const { caseId } = await repo.createPendingCase("source-disabled", originalSnapshot);

  await disabledDispatcher.enqueue(caseId);
  // Integration test against the real dispatcher: `runAudit` is fired
  // fire-and-forget and ControlledAgent's run is only settled by resolveRun
  // below, so deterministic timers cannot drive the interleaving. (Mirrors the
  // real-clock waits the rest of this file's dispatcher tests use.)
  await Bun.sleep(10);
  disabledAgent.resolveRun([proposal]);
  await Bun.sleep(10);

  // The context is the untouched snapshot: no provider evidence and no
  // subject assessment were merged in, and nothing was stored for the case.
  const context = disabledAgent.receivedSnapshots[0];
  expect(context).toEqual(originalSnapshot);
  expect(context.evidence.some((locator) => locator.location.kind === "EXTERNAL_RECORD")).toBe(
    false,
  );
  expect(context.ruleAssessments.some((item) => item.ruleCode === "SUBJECT_RED_LINE_RISK")).toBe(
    false,
  );
  expect((await repo.getSubjectDimension(caseId)).verifications).toHaveLength(0);
  expect(await repo.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "AWAITING_REVIEW",
  });
});
