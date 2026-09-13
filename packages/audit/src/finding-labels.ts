import type { FindingType } from "./model";

/**
 * Chinese display labels for finding types, keyed by the stable code.
 *
 * The mapping lives in the domain package because both the API (which projects
 * the review queue) and the web app (which renders the workbench) need the same
 * words for the same code. Keeping one copy here is what stops the two from
 * drifting into two vocabularies for one finding.
 */
export const findingTypeLabels: Record<FindingType, string> = {
  ADVANCE_PAYMENT_POLICY_CONFLICT: "预付款比例超过制度上限",
  SUBJECT_RED_LINE_RISK: "相对方主体风险",
  TERMINATION_CLAUSE_MISSING: "缺少合同终止/解除条款",
  PENALTY_RATIO_POLICY_CONFLICT: "违约金比例超过制度上限",
  PENALTY_CLAUSE_MISSING: "缺少违约责任条款",
  DISPUTE_JURISDICTION_CONFLICT: "争议管辖地与我方不一致",
  DISPUTE_CLAUSE_MISSING: "缺少争议解决条款",
  NEEDS_HUMAN_REVIEW: "需要人工复核",
};

/** Chinese label for a finding type; unknown codes surface as-is. */
export function getFindingTypeLabel(type: string): string {
  if (type in findingTypeLabels) return findingTypeLabels[type as FindingType];
  return type;
}
