import { beforeEach, expect, test } from "bun:test";
import type { AuditSnapshot, ContractParty } from "@contract-audit/audit/model";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { createApp } from "./app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "./testing/fakes";

const demoContractText = "乙方签订后支付合同金额的70%作为预付款。";

let repository: InMemoryAuditCaseRepository;
let dispatcher: FakeDispatcher;
let broker: RecordingEventBroker;
let rules: InMemoryRuleRepository;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  repository = new InMemoryAuditCaseRepository();
  rules = new InMemoryRuleRepository();
  dispatcher = new FakeDispatcher();
  dispatcher.isStarted = true;
  broker = new RecordingEventBroker();
  app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: broker.asBroker(),
    rules: rules.asRepository(),
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
  broker.subscribe(caseId, () => {
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
