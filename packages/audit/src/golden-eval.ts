import { type GoldenCase, goldenSet } from "./golden-set";
import type { RuleCode, RuleParamSet } from "./model";
import { createAuditSnapshot } from "./orchestrator";
import { normalizeContractDocument } from "./plaintext-adapter";

/**
 * Runs the published golden set against a candidate rule version's parameters.
 *
 * This is the shared execution path for the `bun test` bench and the rule
 * publish gate: the bench asserts the baseline stays green, the gate refuses to
 * publish a parameter set that regresses any labelled case. Both compare
 * deterministic dispositions, never model output.
 */

/**
 * The shape a labelled case has, derived from the dispositions its label
 * carries rather than stored separately — a case that fires a conflict is a
 * negative example, one that only defers to a human is a boundary example, and
 * one that is clean all the way across is a positive example.
 */
export type GoldenCaseType = "POSITIVE" | "NEGATIVE" | "BOUNDARY";

/** The parameters a rule version runs under, mapped onto snapshot overrides. */
export interface RuleValidationParams {
  /** Advance-payment / penalty ratio ceiling as a 0–1 ratio. */
  limitRatio?: number;
  /** Our side's preferred dispute jurisdiction, e.g. "重庆". */
  preferredJurisdiction?: string;
}

/** One labelled case compared against the run. */
export interface ValidationCaseResult {
  /** Stable case identity plus its description, as shown to an operator. */
  caseName: string;
  caseType: GoldenCaseType;
  expected: string;
  actual: string;
  passed: boolean;
  /** Why it failed; empty when the case passed. */
  note: string;
}

/** Totals plus counts broken out by case shape. */
export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  byCaseType: Record<GoldenCaseType, { total: number; passed: number; failed: number }>;
}

export interface GoldenValidationResult {
  details: ValidationCaseResult[];
  summary: ValidationSummary;
}

const classifyCase = (golden: GoldenCase): GoldenCaseType => {
  const values = Object.values(golden.expected);
  if (values.includes("POLICY_CONFLICT")) return "NEGATIVE";
  if (values.includes("NEEDS_HUMAN_REVIEW")) return "BOUNDARY";
  return "POSITIVE";
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Maps a rule code's parameter set onto the snapshot overrides that carry it.
 * Only the rules whose logic reads parameters appear here; the rest run on
 * their deterministic defaults, which is what keeps their bench green.
 */
function overridesFor(
  ruleCode: string,
  params: Record<string, unknown>,
  golden: GoldenCase,
): {
  policyLimitRatio?: number;
  policyPenaltyLimit?: number;
  preferredJurisdiction?: string;
  ruleParams?: Partial<Record<RuleCode, RuleParamSet>>;
} {
  const limitRatio = asNumber(params.limitRatio);
  switch (ruleCode) {
    case "ADVANCE_PAYMENT_LIMIT":
      // The case record carries the baseline ratio; an explicit version
      // parameter overrides it, and an absent parameter keeps the baseline.
      return { policyLimitRatio: limitRatio ?? golden.policyLimitRatio };
    case "PENALTY_RATIO_LIMIT":
      return limitRatio === undefined ? {} : { policyPenaltyLimit: limitRatio };
    case "DISPUTE_JURISDICTION": {
      const preferredJurisdiction = asString(params.preferredJurisdiction);
      return preferredJurisdiction === undefined ? {} : { preferredJurisdiction };
    }
    default:
      // Catalogue rules own their parameter keys; whatever a version carries is
      // handed to the rule, which falls back to its defaults for absent keys.
      return Object.keys(params).length === 0
        ? {}
        : { ruleParams: { [ruleCode as RuleCode]: params as RuleParamSet } };
  }
}

/**
 * Evaluates one rule version over every golden case that labels it, and returns
 * the per-case comparison plus its aggregate. A rule with no labelled cases
 * returns an empty, passing result: there is nothing to regress.
 */
export function runGoldenValidation(
  ruleCode: string,
  params: Record<string, string | number | boolean> = {},
): GoldenValidationResult {
  const details: ValidationCaseResult[] = [];
  const summary: ValidationSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    byCaseType: {
      POSITIVE: { total: 0, passed: 0, failed: 0 },
      NEGATIVE: { total: 0, passed: 0, failed: 0 },
      BOUNDARY: { total: 0, passed: 0, failed: 0 },
    },
  };

  for (const golden of goldenSet) {
    const expected = (golden.expected as Record<string, string | undefined>)[ruleCode];
    if (expected === undefined) continue;

    const snapshot = createAuditSnapshot({
      sourceRecordId: `bench-${golden.id}`,
      document: normalizeContractDocument(golden.text),
      ...overridesFor(ruleCode, params, golden),
    });
    const assessment = snapshot.ruleAssessments.find((item) => item.ruleCode === ruleCode);
    const actual = assessment?.disposition ?? "MISSING";
    const passed = actual === expected;
    const caseType = classifyCase(golden);

    details.push({
      caseName: `${golden.id} · ${golden.description}`,
      caseType,
      expected,
      actual,
      passed,
      note: passed ? "" : `期望 ${expected}，实际 ${actual}`,
    });

    const bucket = summary.byCaseType[caseType];
    bucket.total += 1;
    summary.total += 1;
    if (passed) {
      bucket.passed += 1;
      summary.passed += 1;
    } else {
      bucket.failed += 1;
      summary.failed += 1;
    }
  }

  return { details, summary };
}
