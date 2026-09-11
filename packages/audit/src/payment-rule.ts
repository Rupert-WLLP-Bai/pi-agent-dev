import type { PaymentFacts, RuleAssessment } from "./model";

export function evaluateAdvancePaymentRule(facts: PaymentFacts): RuleAssessment {
  return {
    disposition:
      facts.advancePaymentRatio > facts.policyLimitRatio
        ? "POLICY_CONFLICT"
        : "COMPLIANT",
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    evidenceIds: ["contract-payment", "policy-limit"],
  };
}
