import { expect, test } from "bun:test";
import { runGoldenValidation } from "./golden-eval";
import { goldenSet } from "./golden-set";

/**
 * Golden-set bench: runs every deterministic rule against the labelled
 * contracts and asserts each rule's disposition matches the ground truth. This
 * is the regression net for the deterministic engine — any rule change that
 * shifts a disposition must update the golden set, making the trade-off
 * explicit.
 *
 * The execution lives in `runGoldenValidation` (also the rule publish gate);
 * the bench only asserts the baseline stays green.
 */

const RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
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
  "AMOUNT_IN_WORDS_MISMATCH",
] as const;

// One run per rule; its details carry every case that labels that rule.
const runs = RULE_CODES.map((ruleCode) => ({ ruleCode, run: runGoldenValidation(ruleCode) }));

for (const { ruleCode, run } of runs) {
  for (const detail of run.details) {
    test(`bench ${detail.caseName} · ${ruleCode}`, () => {
      expect(detail.actual).toBe(detail.expected);
    });
  }
}

test("every labelled case is exercised for every rule", () => {
  for (const { ruleCode, run } of runs) {
    const labelled = goldenSet.filter(
      (golden) => (golden.expected as Record<string, string | undefined>)[ruleCode] !== undefined,
    );
    expect(run.details.length, `${ruleCode} must cover every labelled case`).toBe(labelled.length);
    expect(run.summary.total).toBe(run.details.length);
  }
});

test("golden set confusion matrix: zero mismatches", () => {
  // Runs after the per-case tests and asserts the overall confusion matrix is
  // clean. If any case failed, the individual tests already reported the
  // detail — this is the aggregate gate.
  const mismatches = runs.flatMap(({ ruleCode, run }) =>
    run.details
      .filter((detail) => !detail.passed)
      .map((detail) => ({
        caseName: detail.caseName,
        rule: ruleCode,
        expected: detail.expected,
        actual: detail.actual,
      })),
  );
  expect(mismatches).toEqual([]);
});
