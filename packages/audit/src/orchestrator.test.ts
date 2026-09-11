import { expect, test } from "bun:test";
import { createAuditSnapshot } from "./orchestrator";

test("anchors the 70% payment term to a stable text span", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    contractText: "乙方签订后支付合同金额的70%作为预付款。",
    policyLimitRatio: 0.3,
  });

  expect(snapshot.facts.advancePaymentRatio).toBe(0.7);
  expect(snapshot.evidence[0]).toMatchObject({ blockId: "p-1", quotedText: "70%" });
});

test("assesses an advance payment above the policy limit as a conflict", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    contractText: "乙方签订后支付合同金额的70%作为预付款。",
    policyLimitRatio: 0.3,
  });

  expect(snapshot.ruleAssessment.disposition).toBe("POLICY_CONFLICT");
  expect(snapshot.ruleAssessment.evidenceIds).toEqual(["contract-payment", "policy-limit"]);
  // Rule assessment evidence IDs must resolve to snapshot locators so the
  // agent can cite them.
  const evidenceIds = new Set(snapshot.evidence.map((locator) => locator.id));
  for (const id of snapshot.ruleAssessment.evidenceIds) {
    expect(evidenceIds.has(id)).toBe(true);
  }
});
