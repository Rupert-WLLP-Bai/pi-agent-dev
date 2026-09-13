import { expect, test } from "bun:test";
import type { ValidationCaseResult } from "@contract-audit/audit/golden-eval";
import { classifyValidationOutcome, compareValidationRuns } from "./validation-diff";

const result = (caseName: string, expected: string, actual: string): ValidationCaseResult => ({
  caseName,
  caseType: "POSITIVE",
  expected,
  actual,
  passed: expected === actual,
  note: expected === actual ? "" : `期望 ${expected}，实际 ${actual}`,
});

test("a matched disposition passes; a mismatch fails", () => {
  expect(classifyValidationOutcome(result("c", "COMPLIANT", "COMPLIANT"))).toBe("pass");
  expect(classifyValidationOutcome(result("c", "COMPLIANT", "POLICY_CONFLICT"))).toBe("fail");
});

test("a deferral is neither a pass nor a failure", () => {
  expect(classifyValidationOutcome(result("c", "NEEDS_HUMAN_REVIEW", "NEEDS_HUMAN_REVIEW"))).toBe(
    "needs_review",
  );
  // Even where the label expected a decision, a deferral is not read as a fail.
  expect(classifyValidationOutcome(result("c", "COMPLIANT", "NEEDS_HUMAN_REVIEW"))).toBe(
    "needs_review",
  );
});

test("a first run marks every case as new", () => {
  const diff = compareValidationRuns([result("a", "COMPLIANT", "COMPLIANT")], null);
  expect(diff).toEqual([
    {
      caseName: "a",
      caseType: "POSITIVE",
      previous: null,
      previousActual: null,
      current: "pass",
      currentActual: "COMPLIANT",
      change: "new",
      note: "",
    },
  ]);
});

test("a case that stops passing is a regression, and one that starts is fixed", () => {
  const previous = [
    result("was-pass", "COMPLIANT", "COMPLIANT"),
    result("was-fail", "COMPLIANT", "POLICY_CONFLICT"),
    result("steady", "COMPLIANT", "COMPLIANT"),
  ];
  const current = [
    result("was-pass", "COMPLIANT", "POLICY_CONFLICT"),
    result("was-fail", "COMPLIANT", "COMPLIANT"),
    result("steady", "COMPLIANT", "COMPLIANT"),
    result("brand-new", "POLICY_CONFLICT", "POLICY_CONFLICT"),
  ];

  const diff = compareValidationRuns(current, previous);
  expect(diff.map((entry) => [entry.caseName, entry.change])).toEqual([
    ["was-pass", "regression"],
    ["was-fail", "fixed"],
    ["steady", "unchanged"],
    ["brand-new", "new"],
  ]);
  expect(diff[0].previous).toBe("pass");
  expect(diff[0].current).toBe("fail");
  expect(diff[0].note).toBe("期望 COMPLIANT，实际 POLICY_CONFLICT");
});

test("recognising a case as a deferral ranks worse than a pass but better than a failure", () => {
  const previous = [result("pass-to-defer", "COMPLIANT", "COMPLIANT")];
  expect(compareValidationRuns([result("pass-to-defer", "COMPLIANT", "NEEDS_HUMAN_REVIEW")], previous)[0].change).toBe(
    "regression",
  );

  const deferred = [result("defer-to-pass", "COMPLIANT", "NEEDS_HUMAN_REVIEW")];
  expect(
    compareValidationRuns([result("defer-to-pass", "COMPLIANT", "COMPLIANT")], deferred)[0].change,
  ).toBe("fixed");

  const failing = [result("fail-to-defer", "COMPLIANT", "POLICY_CONFLICT")];
  expect(compareValidationRuns([result("fail-to-defer", "COMPLIANT", "NEEDS_HUMAN_REVIEW")], failing)[0].change).toBe(
    "fixed",
  );
});

test("a case dropped since the prior run cannot be compared and is omitted", () => {
  const previous = [result("gone", "COMPLIANT", "COMPLIANT")];
  expect(compareValidationRuns([result("kept", "COMPLIANT", "COMPLIANT")], previous)).toHaveLength(1);
});
