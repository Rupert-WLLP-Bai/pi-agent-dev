import { expect, test } from "bun:test";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

const snapshot = () =>
  createAuditSnapshot({
    sourceRecordId: "source-stats",
    document: normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。"),
    policyLimitRatio: 0.3,
  });

test("GET /api/stats/overview returns dashboard aggregates", async () => {
  const repository = new InMemoryAuditCaseRepository();
  const { caseId } = await repository.createPendingCase("source-stats", snapshot());
  await repository.updateCaseStatus(caseId, "AWAITING_REVIEW", "AWAITING_REVIEW");
  const findingId = await repository.appendFindingRevision(
    caseId,
    {
      assessmentId: "assessment-payment",
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "超限",
      evidenceIds: ["contract-payment"],
      remediation: "下调",
    },
    null,
  );
  await repository.appendReviewRevision(findingId, {
    decision: "ACCEPTED",
    reviewerId: "张三",
    reviewedAt: new Date().toISOString(),
  });

  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });

  const response = await app.handle(new Request("http://localhost/api/stats/overview"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.totalCases).toBe(1);
  expect(body.awaitingReview).toBe(1);
  expect(body.acceptedFindings).toBe(1);
  expect(body.chainHeadFindings).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(body.dailyCounts)).toBe(true);
  expect(body.dailyCounts).toHaveLength(30);
});
