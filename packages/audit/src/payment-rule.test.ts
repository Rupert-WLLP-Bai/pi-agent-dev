import { expect, test } from "bun:test";
import { evaluateAdvancePaymentRule } from "./payment-rule";

test("returns POLICY_CONFLICT when advance payment exceeds the policy limit", () => {
  const assessment = evaluateAdvancePaymentRule({
    advancePaymentRatio: 0.7,
    policyLimitRatio: 0.3,
  });

  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.evidenceIds).toEqual(["contract-payment", "policy-limit"]);
});

test("returns COMPLIANT at the policy limit", () => {
  const assessment = evaluateAdvancePaymentRule({
    advancePaymentRatio: 0.3,
    policyLimitRatio: 0.3,
  });

  expect(assessment.disposition).toBe("COMPLIANT");
});
