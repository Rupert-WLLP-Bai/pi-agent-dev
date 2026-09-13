import type { RuleListItem } from "@contract-audit/api";

/** How many rules 演示概览 previews before it hands over to 规则管理. */
export const RULE_MATRIX_LIMIT = 8;

export interface RuleStats {
  /** Every rule on the server. */
  total: number;
  /** Rules whose runtime toggle is on — the set a new audit case will run. */
  enabled: number;
  /** Rules with at least one recorded validation run against any version. */
  validated: number;
}

/**
 * The 演示概览 KPI counts. A rule counts as enabled unless explicitly disabled,
 * so a row that predates the toggle still reads as running.
 */
export function summarizeRules(rules: RuleListItem[]): RuleStats {
  return {
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled !== false).length,
    validated: rules.filter((rule) => rule.lastValidation !== null).length,
  };
}
