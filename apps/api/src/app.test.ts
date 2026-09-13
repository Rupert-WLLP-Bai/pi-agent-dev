import { beforeEach, expect, test } from "bun:test";
import type { AuditSnapshot, ContractParty, FindingProposal } from "@contract-audit/audit/model";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { createApp } from "./app";
import { FakeDispatcher, InMemoryAuditCaseRepository, RecordingEventBroker } from "./testing/fakes";

const demoContractText = "乙方签订后支付合同金额的70%作为预付款。";

let repository: InMemoryAuditCaseRepository;
let dispatcher: FakeDispatcher;
let broker: RecordingEventBroker;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  repository = new InMemoryAuditCaseRepository();
  dispatcher = new FakeDispatcher();
  dispatcher.isStarted = true;
  broker = new RecordingEventBroker();
  app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: broker.asBroker(),
  });
});

const json = (method: string, path: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

test("creates a pending case and returns 202", async () => {
  const response = await app.handle(
    json("POST", "/api/audit-cases", {
      source: "text",
      contractText: demoContractText,
    }),
  );

  expect(response.status).toBe(202);
  const body = await response.json();
  expect(body).toMatchObject({ status: "PENDING" });
  expect(typeof body.id).toBe("string");
  expect(dispatcher.enqueued).toEqual([body.id]);
});

test("rejects a create request without contract text", async () => {
  const response = await app.handle(json("POST", "/api/audit-cases", { source: "text" }));

  expect(response.status).toBe(422);
});

test("rejects a review for an unknown finding", async () => {
  const response = await app.handle(
    json("POST", "/api/findings/missing/reviews", {
      decision: "ACCEPTED",
    }),
  );

  expect(response.status).toBe(404);
});

test("records a review as an append-only revision", async () => {
  const { caseId } = await repository.createPendingCase("source-1", snapshotStub());
  const findingId = await repository.appendFindingRevision(
    caseId,
    {
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );

  const response = await app.handle(
    json("POST", `/api/findings/${findingId}/reviews`, { decision: "ACCEPTED" }),
  );

  expect(response.status).toBe(200);
  const findings = await repository.getFindingsByCase(caseId);
  expect(findings).toHaveLength(1);
  expect(findings[0].review).toMatchObject({ decision: "ACCEPTED", reviewerId: "anonymous" });
  expect(findings[0].supersedesId).toBe(findingId);
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "COMPLETED",
  });
});

test("rejects a second review of the same finding", async () => {
  const { caseId } = await repository.createPendingCase("source-1", snapshotStub());
  const findingId = await repository.appendFindingRevision(
    caseId,
    {
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );
  await app.handle(json("POST", `/api/findings/${findingId}/reviews`, { decision: "ACCEPTED" }));

  const response = await app.handle(
    json("POST", `/api/findings/${findingId}/reviews`, { decision: "REJECTED" }),
  );

  expect(response.status).toBe(409);
});

test("completes a rejected human review", async () => {
  const { caseId } = await repository.createPendingCase("source-rejected", snapshotStub());
  const findingId = await repository.appendFindingRevision(
    caseId,
    {
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );

  const response = await app.handle(
    json("POST", `/api/findings/${findingId}/reviews`, {
      decision: "REJECTED",
      reason: "Evidence does not support the proposed severity",
    }),
  );

  expect(response.status).toBe(200);
  expect((await repository.getFindingsByCase(caseId))[0].review).toMatchObject({
    decision: "REJECTED",
    reason: "Evidence does not support the proposed severity",
  });
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "COMPLETED",
  });
  expect(broker.events.at(-1)).toMatchObject({
    type: "audit.completed",
    auditCaseId: caseId,
  });
});

test("publishes completion only after the case reaches its terminal state", async () => {
  const { caseId } = await repository.createPendingCase("source-order", snapshotStub());
  const findingId = await repository.appendFindingRevision(
    caseId,
    {
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );

  const statusAtPublish: Array<Promise<string | undefined>> = [];
  broker.subscribe(caseId, (event) => {
    // The accepting review also opens a remediation; this order check is about
    // the completion transition alone.
    if (event.type !== "audit.completed") return;
    statusAtPublish.push(repository.getCase(caseId).then((current) => current?.status));
  });

  await app.handle(json("POST", `/api/findings/${findingId}/reviews`, { decision: "ACCEPTED" }));

  expect(await Promise.all(statusAtPublish)).toEqual(["COMPLETED"]);
});

test("returns case detail with snapshot and findings", async () => {
  const { caseId } = await repository.createPendingCase("source-1", snapshotStub());
  await repository.appendFindingRevision(
    caseId,
    {
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );

  const response = await app.handle(json("GET", `/api/audit-cases/${caseId}`));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.case).toMatchObject({ id: caseId });
  expect(body.snapshot.facts).toEqual({ advancePaymentRatio: 0.7, policyLimitRatio: 0.3 });
  expect(body.snapshot.parties).toEqual([]);
  expect(body.ruleAssessments.map((item: { ruleCode: string }) => item.ruleCode)).toContain(
    "SUBJECT_RED_LINE_RISK",
  );
  expect(body.findings).toHaveLength(1);
});

test("returns the saved subject verification with the case detail", async () => {
  const parties = [party("party-1", "深圳精工科技有限公司")];
  const { caseId } = await repository.createPendingCase("source-subject", snapshotStub(parties));
  const verification = await runSubjectVerification({
    parties,
    port: createFixtureSubjectVerificationPort(),
  });
  await repository.saveSubjectVerifications(caseId, verification);

  const response = await app.handle(json("GET", `/api/audit-cases/${caseId}`));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.snapshot.parties).toEqual(parties);
  expect(body.subjectVerifications).toHaveLength(1);
  expect(body.subjectVerifications[0]).toMatchObject({ partyId: "party-1", status: "RESOLVED" });
  expect(
    body.evidence.some(
      (locator: { location: { kind: string } }) => locator.location.kind === "EXTERNAL_RECORD",
    ),
  ).toBe(true);
  const subjectAssessment = body.ruleAssessments.find(
    (item: { ruleCode: string }) => item.ruleCode === "SUBJECT_RED_LINE_RISK",
  );
  expect(subjectAssessment?.disposition).toBe("COMPLIANT");
});

test("returns 404 for an unknown case", async () => {
  const response = await app.handle(json("GET", "/api/audit-cases/missing"));

  expect(response.status).toBe(404);
});

const proposal = (findingType: FindingProposal["findingType"]): FindingProposal => ({
  findingType,
  severity: "HIGH" as const,
  rationale: "Advance payment exceeds the policy limit",
  evidenceIds: ["contract-payment"],
  remediation: "Reduce the advance payment ratio",
});

test("keeps a case awaiting review until every finding is reviewed", async () => {
  const { caseId } = await repository.createPendingCase("source-multi", snapshotStub());
  const first = await repository.appendFindingRevision(
    caseId,
    proposal("ADVANCE_PAYMENT_POLICY_CONFLICT"),
    null,
  );
  const second = await repository.appendFindingRevision(
    caseId,
    proposal("DISPUTE_JURISDICTION_CONFLICT"),
    null,
  );
  await repository.updateCaseStatus(caseId, "COMPLETED", "AWAITING_REVIEW");

  expect(
    (await app.handle(json("POST", `/api/findings/${first}/reviews`, { decision: "ACCEPTED" })))
      .status,
  ).toBe(200);
  // One review on a two-finding case is not completion.
  expect(await repository.getCase(caseId)).toMatchObject({ stage: "AWAITING_REVIEW" });
  expect(broker.events.some((event) => event.type === "audit.completed")).toBe(false);

  expect(
    (await app.handle(json("POST", `/api/findings/${second}/reviews`, { decision: "REJECTED" })))
      .status,
  ).toBe(200);
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "COMPLETED",
  });
  expect(broker.events.filter((event) => event.type === "audit.completed")).toHaveLength(1);
});

test("lists a chain-head finding per awaiting-review case and filters by assignee", async () => {
  const { caseId } = await repository.createPendingCase("source-queue", snapshotStub());
  await repository.appendFindingRevision(caseId, proposal("ADVANCE_PAYMENT_POLICY_CONFLICT"), null);
  await repository.updateCaseStatus(caseId, "COMPLETED", "AWAITING_REVIEW");

  const queued = await app.handle(json("GET", "/api/reviews/queue"));
  expect(queued.status).toBe(200);
  const items = (await queued.json()) as Array<{ caseId: string; assignee: string | null }>;
  expect(items.map((item) => item.caseId)).toContain(caseId);

  await app.handle(
    json("POST", `/api/audit-cases/${caseId}/assignment`, { assignee: "张三", priority: "high" }),
  );
  const mine = (await (
    await app.handle(json("GET", "/api/reviews/queue?mine=张三"))
  ).json()) as Array<{ caseId: string; assignee: string | null }>;
  expect(mine.find((item) => item.caseId === caseId)?.assignee).toBe("张三");
  const other = (await (
    await app.handle(json("GET", "/api/reviews/queue?mine=李四"))
  ).json()) as Array<{ caseId: string }>;
  expect(other.some((item) => item.caseId === caseId)).toBe(false);
  expect(broker.events.at(-1)).toMatchObject({
    type: "review.assigned",
    auditCaseId: caseId,
    assignee: "张三",
    priority: "high",
  });
});

test("rejects assignment for an unknown or not-awaiting-review case", async () => {
  const missing = await app.handle(
    json("POST", "/api/audit-cases/missing/assignment", { assignee: "张三" }),
  );
  expect(missing.status).toBe(404);

  // The case exists but never entered review, so there is no queue item to transfer.
  const { caseId } = await repository.createPendingCase("source-queued", snapshotStub());
  const conflict = await app.handle(
    json("POST", `/api/audit-cases/${caseId}/assignment`, { assignee: "张三" }),
  );
  expect(conflict.status).toBe(409);
});

const party = (id: string, name: string): ContractParty => ({
  id,
  label: "乙方",
  name,
  evidenceId: `${id}-name`,
});

function snapshotStub(parties: ContractParty[] = []): AuditSnapshot {
  return {
    sourceRecordId: "source-1",
    contractDocument: { hash: "hash-1", blocks: [] },
    facts: { advancePaymentRatio: 0.7, policyLimitRatio: 0.3 },
    parties,
    evidence: [
      {
        id: "contract-payment",
        sourceRecordId: "source-1",
        location: {
          kind: "DOCUMENT_SPAN",
          contractDocumentHash: "hash-1",
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
  };
}

// ── Remediation Item routes ──────────────────────────────────────

const remediationProposal: FindingProposal = {
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  severity: "HIGH",
  rationale: "Advance payment exceeds the policy limit",
  evidenceIds: ["contract-payment"],
  remediation: "Reduce the advance payment ratio",
};

/** Seeds a case with one finding and confirms it as risk. */
async function seedAcceptedCase(sourceId: string): Promise<string> {
  const { caseId } = await repository.createPendingCase(sourceId, snapshotStub());
  const findingId = await repository.appendFindingRevision(caseId, remediationProposal, null);
  const response = await app.handle(
    json("POST", `/api/findings/${findingId}/reviews`, { decision: "ACCEPTED" }),
  );
  expect(response.status).toBe(200);
  return caseId;
}

/** The id of the remediation the board projects for a case. */
async function remediationIdFor(caseId: string): Promise<string> {
  const response = await app.handle(json("GET", "/api/remediations"));
  const board = (await response.json()) as {
    columns: Array<{ items: Array<{ id: string; caseId: string }> }>;
  };
  const card = board.columns
    .flatMap((column) => column.items)
    .find((item) => item.caseId === caseId);
  if (card === undefined) throw new Error(`no remediation for case ${caseId}`);
  return card.id;
}

test("accepting a review opens a remediation; rejecting opens none", async () => {
  const caseId = await seedAcceptedCase("source-rem-accept");
  await remediationIdFor(caseId);
  expect(broker.events.some((event) => event.type === "remediation.created")).toBe(true);

  const { caseId: rejectedCase } = await repository.createPendingCase(
    "source-rem-reject",
    snapshotStub(),
  );
  const rejectedFinding = await repository.appendFindingRevision(
    rejectedCase,
    remediationProposal,
    null,
  );
  await app.handle(
    json("POST", `/api/findings/${rejectedFinding}/reviews`, {
      decision: "REJECTED",
      reason: "误报",
    }),
  );

  const response = await app.handle(json("GET", "/api/remediations"));
  const board = (await response.json()) as { columns: Array<{ items: Array<{ caseId: string }> }> };
  const all = board.columns.flatMap((column) => column.items);
  expect(all.some((item) => item.caseId === rejectedCase)).toBe(false);
});

test("advances a remediation one step and refuses illegal transitions", async () => {
  const caseId = await seedAcceptedCase("source-rem-advance");
  const id = await remediationIdFor(caseId);

  // Skipping 整改中 to land on 待复核 is refused.
  const skip = await app.handle(
    json("PATCH", `/api/remediations/${id}`, { status: "awaiting_review" }),
  );
  expect(skip.status).toBe(409);

  // Closing is not reachable through PATCH at all.
  const closeViaPatch = await app.handle(
    json("PATCH", `/api/remediations/${id}`, { status: "closed" }),
  );
  expect(closeViaPatch.status).toBe(409);

  const started = await app.handle(
    json("PATCH", `/api/remediations/${id}`, { owner: "张工", status: "in_progress" }),
  );
  expect(await started.json()).toMatchObject({ status: "in_progress", owner: "张工" });

  const awaiting = await app.handle(
    json("PATCH", `/api/remediations/${id}`, { status: "awaiting_review" }),
  );
  expect(await awaiting.json()).toMatchObject({ status: "awaiting_review" });
  expect(broker.events.some((event) => event.type === "remediation.transitioned")).toBe(true);
});

test("closing needs 待复核 and a reviewer other than the owner", async () => {
  const caseId = await seedAcceptedCase("source-rem-close");
  const id = await remediationIdFor(caseId);

  const tooEarly = await app.handle(
    json("POST", `/api/remediations/${id}/close`, { closedBy: "李复核" }),
  );
  expect(tooEarly.status).toBe(409);

  await app.handle(
    json("PATCH", `/api/remediations/${id}`, { owner: "张工", status: "in_progress" }),
  );
  await app.handle(json("PATCH", `/api/remediations/${id}`, { status: "awaiting_review" }));

  const self = await app.handle(
    json("POST", `/api/remediations/${id}/close`, { closedBy: "张工" }),
  );
  expect(self.status).toBe(409);
  expect((await self.json()).error).toContain("责任人不能自行关闭");

  const closed = await app.handle(
    json("POST", `/api/remediations/${id}/close`, { closedBy: "李复核" }),
  );
  expect(closed.status).toBe(200);
  expect(await closed.json()).toMatchObject({ status: "closed", closedBy: "李复核" });
  expect(broker.events.some((event) => event.type === "remediation.closed")).toBe(true);
});

test("unknown remediation ids are 404", async () => {
  const patch = await app.handle(json("PATCH", "/api/remediations/missing", { owner: "张三" }));
  expect(patch.status).toBe(404);
  const close = await app.handle(
    json("POST", "/api/remediations/missing/close", { closedBy: "张三" }),
  );
  expect(close.status).toBe(404);
});
