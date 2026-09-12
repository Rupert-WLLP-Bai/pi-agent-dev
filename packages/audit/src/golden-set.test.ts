import { expect, test } from "bun:test";
import { goldenSet } from "./golden-set";
import type { RuleAssessment } from "./model";
import { createAuditSnapshot } from "./orchestrator";
import { normalizeContractDocument } from "./plaintext-adapter";

/**
 * Golden-set bench: runs every deterministic rule against 12 labelled contracts
 * and asserts each rule's disposition matches the ground truth. This is the
 * regression net for the deterministic engine — any rule change that shifts a
 * disposition must update the golden set, making the trade-off explicit.
 */

const RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
  "DISPUTE_JURISDICTION",
] as const;

// Track mismatches for a summary that names exactly what broke.
const mismatches: Array<{ caseId: string; rule: string; expected: string; actual: string }> = [];

for (const golden of goldenSet) {
  test(`bench ${golden.id}: ${golden.description}`, () => {
    const document = normalizeContractDocument(golden.text);
    const snapshot = createAuditSnapshot({
      sourceRecordId: `bench-${golden.id}`,
      document,
      policyLimitRatio: golden.policyLimitRatio,
    });

    const assessmentBy = new Map(
      snapshot.ruleAssessments.map((a: RuleAssessment) => [a.ruleCode, a]),
    );

    for (const ruleCode of RULE_CODES) {
      const assessment = assessmentBy.get(ruleCode);
      const expectedDisposition = golden.expected[ruleCode as keyof typeof golden.expected];
      const actualDisposition = assessment?.disposition ?? "MISSING";

      if (actualDisposition !== expectedDisposition) {
        mismatches.push({
          caseId: golden.id,
          rule: ruleCode,
          expected: expectedDisposition,
          actual: actualDisposition,
        });
      }

      expect(actualDisposition).toBe(expectedDisposition);
    }
  });
}

test("golden set confusion matrix: zero mismatches", () => {
  // This test runs after all bench cases and asserts the overall confusion
  // matrix is clean. If any case failed, the individual tests already reported
  // the detail — this is the aggregate gate.
  expect(mismatches).toEqual([]);
});
