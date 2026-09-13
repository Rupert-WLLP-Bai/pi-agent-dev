import type { RuleCode } from "./model";

/**
 * The codes the deterministic engine actually implements.
 *
 * This is the single source of truth for what a rule may be called: the rules
 * API rejects any code outside it, so a rule can never be persisted that no
 * evaluator will ever run. The list mirrors the `RuleCode` union — the
 * `satisfies` clause keeps the two from drifting.
 */
export const ENGINE_RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "SUBJECT_RED_LINE_RISK",
  "TERMINATION_CLAUSE_PRESENT",
  "PENALTY_RATIO_LIMIT",
  "DISPUTE_JURISDICTION",
  "PERFORMANCE_BOND_RATIO_LIMIT",
  "PAYMENT_TERM_LIMIT",
  "BACK_TO_BACK_PAYMENT_CLAUSE",
  "DEPOSIT_RATIO_LIMIT",
  "WARRANTY_RETENTION_RATIO_LIMIT",
  "DISPUTE_RESOLUTION_CONFLICT",
  "BID_BOND_RATIO_LIMIT",
  "IP_OWNERSHIP_MISSING",
  "GUARANTEE_MODE_AMBIGUOUS",
  "CONFIDENTIALITY_PERIOD_MISSING",
  "FORCE_MAJEURE_OVERBROAD",
  "LIABILITY_CAP_MISSING",
] as const satisfies readonly RuleCode[];

/** Compile-time proof the catalog covers every `RuleCode` — an unlisted code is a type error. */
export const RULE_CATALOG_IS_COMPLETE: Exclude<
  RuleCode,
  (typeof ENGINE_RULE_CODES)[number]
> extends never
  ? true
  : never = true;

/** Narrows an arbitrary string to a code the engine can evaluate. */
export function isEngineRuleCode(code: string): code is RuleCode {
  return (ENGINE_RULE_CODES as readonly string[]).includes(code);
}
