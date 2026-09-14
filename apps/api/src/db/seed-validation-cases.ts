import { type GoldenDisposition, goldenSet } from "@contract-audit/audit/golden-set";
import type { RuleCode } from "@contract-audit/audit/model";
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

/**
 * The rules the golden set actually labels, derived from the set at load time
 * rather than hardcoded: a rule code with no labelled case has no material to
 * validate against, and materialising it would make the 案例验证 page claim
 * coverage it does not have. `SUBJECT_RED_LINE_RISK` is deliberately absent —
 * subject verification decides it from provider records, not from a contract
 * body, so the golden set never labels it. Insertion order follows the first
 * case that labels each rule, which keeps the derived list stable across boots.
 */
const RULE_CODES: readonly RuleCode[] = [
  ...new Set(goldenSet.flatMap((golden) => Object.keys(golden.expected) as RuleCode[])),
];

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
 * - `bench-14` / `bench-18` / `bench-25` / `bench-30` / `bench-36` sit exactly
 *   on the catalogue ceilings (10% / 60 days / 20% / 3% / 2%): the "equal to the
 *   limit is compliant" side of each numeric comparison. `bench-16` and
 *   `bench-28` omit the ratio denominator, the other boundary each ratio rule
 *   must handle — by deferring, not by guessing.
 * - `bench-20` states the payment term as 60 working days, the unit-conversion
 *   variant; `bench-26` writes 订金 rather than 定金, the character the deposit
 *   ceiling legally hinges on; `bench-23` is the same-proportion mirror of a
 *   back-to-back clause; `bench-34` is the valid "仲裁不成的，可起诉" fallback
 *   the conflict rule must not flag.
 * - `bench-43` accepts a confidentiality term ending when the information
 *   becomes public (an equivalent wording to a fixed period); `bench-48` is the
 *   high-value contract with no cap, the threshold at which the liability rule
 *   defers to a human rather than accusing.
 *
 * A rule may legitimately have no boundary case — nothing in the golden set
 * pins its threshold or wording; the empty list says so.
 */
const BOUNDARY_CASE_IDS: Partial<Record<RuleCode, readonly string[]>> = {
  ADVANCE_PAYMENT_LIMIT: ["bench-08", "bench-09"],
  PENALTY_RATIO_LIMIT: ["bench-08", "bench-09"],
  TERMINATION_CLAUSE_PRESENT: ["bench-50"],
  DISPUTE_JURISDICTION: ["bench-49"],
  PERFORMANCE_BOND_RATIO_LIMIT: ["bench-14", "bench-16"],
  PAYMENT_TERM_LIMIT: ["bench-18", "bench-20"],
  BACK_TO_BACK_PAYMENT_CLAUSE: ["bench-23"],
  DEPOSIT_RATIO_LIMIT: ["bench-25", "bench-26", "bench-28"],
  WARRANTY_RETENTION_RATIO_LIMIT: ["bench-30"],
  DISPUTE_RESOLUTION_CONFLICT: ["bench-34"],
  BID_BOND_RATIO_LIMIT: ["bench-36"],
  CONFIDENTIALITY_PERIOD_MISSING: ["bench-43"],
  LIABILITY_CAP_MISSING: ["bench-48"],
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
function caseTypeFor(
  ruleCode: RuleCode,
  goldenId: string,
  expected: GoldenDisposition,
): ValidationCaseType {
  if (BOUNDARY_CASE_IDS[ruleCode]?.includes(goldenId) === true) return "boundary";
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
  goldenSet.flatMap((golden) => {
    const expected = golden.expected[ruleCode];
    // Partial expectations (Wave-2 catalogue rules): a case that does not
    // label this rule is simply not a validation case for it.
    if (expected === undefined) return [];
    const caseType = caseTypeFor(ruleCode, golden.id, expected);
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
