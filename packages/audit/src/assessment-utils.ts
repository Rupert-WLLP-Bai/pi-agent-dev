import type { AuditSnapshot, RuleCode } from "./model";

/** Resolves the Rule Code cited by a Finding Proposal's assessment id. */
export function ruleCodeForAssessment(
  snapshot: AuditSnapshot,
  assessmentId: string,
): RuleCode | null {
  return snapshot.ruleAssessments.find((item) => item.id === assessmentId)?.ruleCode ?? null;
}
