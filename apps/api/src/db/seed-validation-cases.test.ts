import { expect, test } from "bun:test";
import { VALIDATION_CASE_SEEDS } from "./seed-validation-cases";

/**
 * The seed derives its rule codes from the golden set, so this pins the two
 * things that could silently regress: a rule the golden set labels going
 * missing from the catalog, and a rule it never labels (SUBJECT_RED_LINE_RISK)
 * being materialised with no ground truth behind it.
 */

/** Every rule code the golden set labels, in the order the seed derives them. */
const DERIVED_RULE_CODES = [
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
];

test("materialises exactly the rules the golden set labels", () => {
  const codes = [...new Set(VALIDATION_CASE_SEEDS.map((seed) => seed.ruleCode))];
  expect(codes).toEqual(DERIVED_RULE_CODES);
  // Subject verification and party history decide these outside the document;
  // they have no golden-set body to validate.
  expect(codes).not.toContain("SUBJECT_RED_LINE_RISK");
  expect(codes).not.toContain("PARTY_HISTORY_ASSOCIATION");
});

test("每个规则至少两条验证案例", () => {
  for (const code of DERIVED_RULE_CODES) {
    const count = VALIDATION_CASE_SEEDS.filter((seed) => seed.ruleCode === code).length;
    expect(count).toBeGreaterThanOrEqual(2);
  }
});

test("the six priority catalogue rules each carry a boundary case", () => {
  const priority = [
    "PERFORMANCE_BOND_RATIO_LIMIT",
    "PAYMENT_TERM_LIMIT",
    "BACK_TO_BACK_PAYMENT_CLAUSE",
    "DEPOSIT_RATIO_LIMIT",
    "WARRANTY_RETENTION_RATIO_LIMIT",
    "DISPUTE_RESOLUTION_CONFLICT",
  ];
  for (const code of priority) {
    const boundary = VALIDATION_CASE_SEEDS.filter(
      (seed) => seed.ruleCode === code && seed.caseType === "boundary",
    ).length;
    expect(boundary).toBeGreaterThan(0);
  }
});

test("case identity (ruleCode, name) is unique so reseeding never rewrites", () => {
  const keys = VALIDATION_CASE_SEEDS.map((seed) => `${seed.ruleCode}\u0000${seed.name}`);
  expect(new Set(keys).size).toBe(keys.length);
});
