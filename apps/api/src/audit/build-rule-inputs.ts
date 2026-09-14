import type { RuleCode, RuleParamSet } from "@contract-audit/audit/model";
import type { RuleRepository } from "../db/rule-repository";

/** The deterministic rules whose parameters shape snapshot assembly. */
export const SNAPSHOT_RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
  "DISPUTE_JURISDICTION",
  "PERFORMANCE_BOND_RATIO_LIMIT",
  "PAYMENT_TERM_LIMIT",
  "DEPOSIT_RATIO_LIMIT",
  "WARRANTY_RETENTION_RATIO_LIMIT",
  "BID_BOND_RATIO_LIMIT",
  "CONFIDENTIALITY_PERIOD_MISSING",
  "LIABILITY_CAP_MISSING",
] as const;

/**
 * Maps the published Rule Versions onto the parameters createAuditSnapshot
 * reads. An operator's explicit per-audit ceiling still wins — it is the same
 * concept stated for one audit — and when neither an override nor a published
 * rule is present the snapshot keeps its built-in default.
 */
export async function buildRuleInputs(rules: RuleRepository, policyLimitRatioOverride?: number) {
  const [published, enabledCodes] = await Promise.all([
    rules.getPublishedVersions(SNAPSHOT_RULE_CODES),
    rules.listEnabledCodes(),
  ]);
  const advanceLimit = published.get("ADVANCE_PAYMENT_LIMIT")?.params.limitRatio;
  const penaltyLimit = published.get("PENALTY_RATIO_LIMIT")?.params.limitRatio;
  const jurisdiction = published.get("DISPUTE_JURISDICTION")?.params.preferredJurisdiction;

  const ruleVersions: Partial<Record<RuleCode, number>> = {};
  for (const [code, version] of published) ruleVersions[code as RuleCode] = version.version;

  const ruleVersionIds: Partial<Record<RuleCode, string>> = {};
  for (const [code, version] of published) ruleVersionIds[code as RuleCode] = version.versionId;

  const ruleParams: Partial<Record<RuleCode, RuleParamSet>> = {};
  for (const [code, version] of published) {
    if (Object.keys(version.params).length > 0) {
      ruleParams[code as RuleCode] = version.params;
    }
  }

  return {
    policyLimitRatio:
      policyLimitRatioOverride ?? (typeof advanceLimit === "number" ? advanceLimit : undefined),
    policyPenaltyLimit: typeof penaltyLimit === "number" ? penaltyLimit : undefined,
    preferredJurisdiction: typeof jurisdiction === "string" ? jurisdiction : undefined,
    ruleVersions,
    ruleParams,
    ruleVersionIds,
    enabledRuleCodes: enabledCodes as RuleCode[],
  };
}
