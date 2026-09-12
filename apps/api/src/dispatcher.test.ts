import { beforeEach, expect, test } from "bun:test";
import type { AuditSnapshot, ContractParty, FindingProposal } from "@contract-audit/audit/model";
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

test("completes the audit for the enqueued case and records telemetry", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  await dispatcher.enqueue(caseId);

  await new Promise((resolve) => setTimeout(resolve, 10));
  agent.resolveRun([proposal], {
    provider: "test",
    model: "test-model",
    version: "1.0",
    usage: { input: 10, output: 5 },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const auditCase = await repository.getCase(caseId);
  expect(auditCase).toMatchObject({ status: "COMPLETED", stage: "AWAITING_REVIEW" });
  expect(repository.recordedRuns).toHaveLength(1);
  expect(repository.recordedRuns[0]).toMatchObject({
    auditCaseId: caseId,
    model: "test-model",
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

test("ignores a stale queued entry whose case is no longer pending", async () => {
  const { caseId } = await repository.createPendingCase("source-a", snapshotFor("source-a"));
  // The case is claimed directly (e.g. through a concurrent path).
  await repository.claimCase(caseId);
  await repository.updateCaseStatus(caseId, "RUNNING", "AGENT_RUNNING");

  await dispatcher.enqueue(caseId);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(agent.startedCaseIds).toEqual([]);
  expect((await repository.getCase(caseId))?.status).toBe("RUNNING");
});

test("marks stale RUNNING cases interrupted and re-enqueues pending cases on start", async () => {
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
