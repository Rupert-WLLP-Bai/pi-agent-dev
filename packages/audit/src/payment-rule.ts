import type { PaymentFacts, RuleAssessment } from "./model";

export const ADVANCE_PAYMENT_RULE_CODE = "ADVANCE_PAYMENT_LIMIT" as const;

/**
 * Evaluates the advance-payment dimension.
 *
 * When the contract states no advance term (`hasAdvanceTerm === false`) the
 * ratio is 0 by construction, and the assessment says so explicitly instead of
 * pretending a "0%" was located in the text — the evidence list then carries
 * only the policy input, never a phantom span.
 */
export function evaluateAdvancePaymentRule(
  facts: PaymentFacts,
  hasAdvanceTerm = true,
): RuleAssessment {
  const actual = Math.round(facts.advancePaymentRatio * 100);
  const limit = Math.round(facts.policyLimitRatio * 100);

  if (!hasAdvanceTerm) {
    return {
      id: "assessment-payment",
      ruleCode: ADVANCE_PAYMENT_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: ["policy-limit"],
      basis: `合同未约定预付款条款，视为无预付款，不涉及 ${limit}% 制度上限。`,
    };
  }

  const conflict = facts.advancePaymentRatio > facts.policyLimitRatio;

  return {
    id: "assessment-payment",
    ruleCode: ADVANCE_PAYMENT_RULE_CODE,
    disposition: conflict ? "POLICY_CONFLICT" : "COMPLIANT",
    evidenceIds: ["contract-payment", "policy-limit"],
    basis: conflict
      ? `预付款比例 ${actual}% 高于制度上限 ${limit}%（超出 ${actual - limit} 个百分点）。`
      : `预付款比例 ${actual}% 未超过制度上限 ${limit}%。`,
  };
}
