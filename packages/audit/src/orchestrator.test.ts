import { expect, test } from "bun:test";
import { normalizeContractDocument } from "./plaintext-adapter";
import { createAuditSnapshot } from "./orchestrator";

const contractText = "乙方签订后支付合同金额的70%作为预付款。";

test("anchors the 70% payment term to a stable text span", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    document: normalizeContractDocument(contractText),
    policyLimitRatio: 0.3,
  });

  expect(snapshot.facts.advancePaymentRatio).toBe(0.7);
  expect(snapshot.evidence[0]).toMatchObject({
    location: { kind: "DOCUMENT_SPAN", blockId: "p-1", quotedText: "70%" },
  });
});

test("assesses an advance payment above the policy limit as a conflict", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    document: normalizeContractDocument(contractText),
    policyLimitRatio: 0.3,
  });

  const assessment = snapshot.ruleAssessments.find((item) => item.ruleCode === "ADVANCE_PAYMENT_LIMIT");
  expect(assessment?.disposition).toBe("POLICY_CONFLICT");
  expect(assessment?.evidenceIds).toEqual(["contract-payment", "policy-limit"]);
  // Rule assessment evidence IDs must resolve to snapshot locators so the
  // agent can cite them.
  const evidenceIds = new Set(snapshot.evidence.map((locator) => locator.id));
  for (const id of assessment?.evidenceIds ?? []) {
    expect(evidenceIds.has(id)).toBe(true);
  }
});

test("extracts no parties from a contract with no party lines", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    document: normalizeContractDocument(contractText),
    policyLimitRatio: 0.3,
  });

  expect(snapshot.parties).toEqual([]);
});
