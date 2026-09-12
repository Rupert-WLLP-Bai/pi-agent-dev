import { expect, test } from "bun:test";
import type { PaymentFacts } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { demoContracts } from "./demo-contracts";

const expectedAdvanceRatio: Record<string, number> = {
  "equipment-purchase": 0.7,
  "raw-material-purchase": 0.3,
  "electronic-components": 0.5,
  "engineering-service": 0.3,
  "spare-power-purchase": 0.3,
};

const paymentFacts = (id: string, text: string): PaymentFacts =>
  createAuditSnapshot({
    sourceRecordId: `demo-${id}`,
    document: normalizeContractDocument(text),
    policyLimitRatio: 0.3,
  }).facts;

const paymentDisposition = (id: string, text: string): string =>
  createAuditSnapshot({
    sourceRecordId: `demo-${id}`,
    document: normalizeContractDocument(text),
    policyLimitRatio: 0.3,
  }).ruleAssessments.find((item) => item.ruleCode === "ADVANCE_PAYMENT_LIMIT")?.disposition ??
  "MISSING";

test("each demo contract exposes its intended advance-payment ratio", () => {
  for (const contract of demoContracts) {
    expect(paymentFacts(contract.id, contract.text).advancePaymentRatio).toBe(
      expectedAdvanceRatio[contract.id],
    );
  }
});

test("demo contracts cover both a policy conflict and a compliant case", () => {
  const dispositions = demoContracts.map((contract) =>
    paymentDisposition(contract.id, contract.text),
  );

  expect(dispositions).toContain("POLICY_CONFLICT");
  expect(dispositions).toContain("COMPLIANT");
});
