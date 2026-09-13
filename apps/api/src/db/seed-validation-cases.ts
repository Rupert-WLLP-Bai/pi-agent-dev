import { type GoldenCase, goldenSet } from "@contract-audit/audit/golden-set";
import type { RuleRepository, SeedValidationCase } from "./rule-repository";
import type { ValidationCaseType } from "./schema";

/**
 * Materialises the canonical golden set (`packages/audit/src/golden-set.ts`)
 * into `validation_cases`, so the 案例验证 page can list and filter cases
 * without recompiling and a run's per-case result can be tied back to its
 * catalog row.
 *
 * The golden set is the source of truth for the contract body and the expected
 * disposition per rule; only the operator-facing type is derived here.
 */

/** The deterministic rules the golden set labels. */
const RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
  "DISPUTE_JURISDICTION",
] as const;

type GoldenRuleCode = (typeof RULE_CODES)[number];

/**
 * Cases that pin a rule's exact decision boundary or a wording variant, rather
 * than a plain "fires" / "does not fire" example. They are named explicitly
 * instead of sniffed from the text so the designation reads as a deliberate
 * judgement:
 *
 * - `bench-08` sits exactly on the ratio ceiling (30% vs a 30% limit) for both
 *   ratio rules; `bench-09` is one point either side (31% over, 29% under).
 * - `bench-49` names a jurisdiction inside our own city (重庆市南岸区), the
 *   region-containment boundary of the dispute rule.
 * - `bench-50` states termination only in a heading, not an affirmative act on
 *   the contract — the wording variant the termination rule must still accept.
 *
 * Every rule the golden set labels has at least one boundary case; the ones
 * missing from the original twelve were added to `golden-set.ts`.
 */
const BOUNDARY_CASE_IDS: Record<GoldenRuleCode, readonly string[]> = {
  ADVANCE_PAYMENT_LIMIT: ["bench-08", "bench-09"],
  PENALTY_RATIO_LIMIT: ["bench-08", "bench-09"],
  TERMINATION_CLAUSE_PRESENT: ["bench-50"],
  DISPUTE_JURISDICTION: ["bench-49"],
};

/**
 * Maps an expectation onto the five case shapes:
 * - a rule that should fire (POLICY_CONFLICT, i.e. a confirmed violation) is a
 *   正例 — it guards against "该报没报" (a missed finding);
 * - a rule that should stay clean (COMPLIANT) is a 反例 — it guards against
 *   "不该报却报了" (an over-report);
 * - a deliberate deferral (NEEDS_HUMAN_REVIEW) is 证据缺失 — the case the rule
 *   hands to a human by design, counted as neither pass nor fail;
 * - 历史误报 (`false_positive`) is reserved for confirmed over-reports promoted
 *   from production; none are seeded yet, but the type exists and renders.
 */
function caseTypeFor(ruleCode: GoldenRuleCode, golden: GoldenCase): ValidationCaseType {
  if (BOUNDARY_CASE_IDS[ruleCode].includes(golden.id)) return "boundary";
  const expected = golden.expected[ruleCode];
  switch (expected) {
    case "POLICY_CONFLICT":
      return "positive";
    case "COMPLIANT":
      return "negative";
    case "NEEDS_HUMAN_REVIEW":
      return "missing_evidence";
  }
}

const expectedNoteFor = (caseType: ValidationCaseType, expected: string): string => {
  switch (caseType) {
    case "positive":
      return `应触发风险（期望处置 ${expected}）`;
    case "negative":
      return `不应触发风险（期望处置 ${expected}）`;
    case "boundary":
      return `阈值或措辞边界样本（期望处置 ${expected}）`;
    case "missing_evidence":
      return `按设计转人工复核，不计通过也不计失败（期望处置 ${expected}）`;
    case "false_positive":
      return `历史误报回归样本（期望处置 ${expected}）`;
  }
};

export const VALIDATION_CASE_SEEDS: readonly SeedValidationCase[] = RULE_CODES.flatMap((ruleCode) =>
  goldenSet.map((golden) => {
    const caseType = caseTypeFor(ruleCode, golden);
    const expected = golden.expected[ruleCode];
    return {
      ruleCode,
      caseType,
      // Mirrors `runGoldenValidation`'s `caseName`, which links run → catalog.
      name: `${golden.id} · ${golden.description}`,
      input: golden.text,
      expectedDisposition: expected,
      expectedNote: expectedNoteFor(caseType, expected),
    };
  }),
);

/**
 * Seeds the catalog once per restart. Existing rows are never rewritten — a
 * case an operator has annotated keeps its identity — while cases added to the
 * golden set later are inserted on the next boot.
 */
export async function seedValidationCases(repository: RuleRepository): Promise<number> {
  return repository.bootstrapValidationCases(VALIDATION_CASE_SEEDS);
}
