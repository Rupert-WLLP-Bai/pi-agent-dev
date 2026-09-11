import { expect, test } from "bun:test";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { demoContracts } from "./demo-contracts";

const expectedAdvanceRatio: Record<string, number> = {
  "equipment-purchase": 0.7,
  "raw-material-purchase": 0.3,
  "electronic-components": 0.5,
};

test("each demo contract exposes its intended advance-payment ratio", () => {
  for (const contract of demoContracts) {
    const snapshot = createAuditSnapshot({
      sourceRecordId: `demo-${contract.id}`,
      contractText: contract.text,
      policyLimitRatio: 0.3,
    });
    expect(snapshot.facts.advancePaymentRatio).toBe(expectedAdvanceRatio[contract.id]);
  }
});

test("demo contracts cover both a policy conflict and a compliant case", () => {
  const dispositions = demoContracts.map((contract) =>
    createAuditSnapshot({
      sourceRecordId: `demo-${contract.id}`,
      contractText: contract.text,
      policyLimitRatio: 0.3,
    }).ruleAssessment.disposition,
  );
  expect(dispositions).toContain("POLICY_CONFLICT");
  expect(dispositions).toContain("COMPLIANT");
});
