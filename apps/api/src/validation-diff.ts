import type { ValidationCaseResult } from "@contract-audit/audit/golden-eval";

/**
 * A validation run compared against the run before it. The point of the diff is
 * to name what moved between two rule versions, not to print a score.
 */

/**
 * What one case's result counts as. A case that deferred to a human
 * (NEEDS_HUMAN_REVIEW) is neither a pass nor a fail — the rule behaved as
 * designed, so it must not be read as a regression or as a green light.
 */
export type ValidationOutcome = "pass" | "fail" | "needs_review";

export type ValidationChange = "regression" | "fixed" | "unchanged" | "new";

export interface ValidationDiffEntry {
  caseName: string;
  caseType: ValidationCaseResult["caseType"];
  /** The outcome in the prior run, or null when the case is new to this run. */
  previous: ValidationOutcome | null;
  previousActual: string | null;
  current: ValidationOutcome;
  currentActual: string;
  change: ValidationChange;
  /** Why the current result differs, empty when it does not. */
  note: string;
}

export function classifyValidationOutcome(
  result: Pick<ValidationCaseResult, "actual" | "passed">,
): ValidationOutcome {
  if (result.actual === "NEEDS_HUMAN_REVIEW") return "needs_review";
  return result.passed ? "pass" : "fail";
}

/**
 * Ranking that treats a deferral as worse than a pass and better than a
 * failure: deferring to a human is a real change in behaviour, just not a wrong
 * answer. Regression/fixed are direction, never magnitude.
 */
const OUTCOME_SEVERITY: Record<ValidationOutcome, number> = {
  pass: 0,
  needs_review: 1,
  fail: 2,
};

const toEntry = (
  current: ValidationCaseResult,
  previous: ValidationCaseResult | undefined,
): ValidationDiffEntry => {
  const currentOutcome = classifyValidationOutcome(current);
  if (previous === undefined) {
    return {
      caseName: current.caseName,
      caseType: current.caseType,
      previous: null,
      previousActual: null,
      current: currentOutcome,
      currentActual: current.actual,
      change: "new",
      note: current.note,
    };
  }

  const previousOutcome = classifyValidationOutcome(previous);
  const delta = OUTCOME_SEVERITY[currentOutcome] - OUTCOME_SEVERITY[previousOutcome];
  return {
    caseName: current.caseName,
    caseType: current.caseType,
    previous: previousOutcome,
    previousActual: previous.actual,
    current: currentOutcome,
    currentActual: current.actual,
    change: delta > 0 ? "regression" : delta < 0 ? "fixed" : "unchanged",
    note: current.note,
  };
};

/**
 * Compares a run's cases against the prior run of the same rule. A case with no
 * prior baseline (a first run, or a case added since) is `new`; a case that has
 * disappeared from the current run cannot be compared and is dropped.
 */
export function compareValidationRuns(
  current: readonly ValidationCaseResult[],
  previous: readonly ValidationCaseResult[] | null,
): ValidationDiffEntry[] {
  const previousByName = new Map((previous ?? []).map((entry) => [entry.caseName, entry]));
  return current.map((entry) => toEntry(entry, previousByName.get(entry.caseName)));
}
