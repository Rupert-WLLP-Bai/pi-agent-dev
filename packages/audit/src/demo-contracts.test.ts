import { expect, test } from "bun:test";
import { demoContracts } from "./demo-contracts";
import type { RuleAssessment, RuleCode, RuleDisposition } from "./model";
import { createAuditSnapshot } from "./orchestrator";
import { normalizeContractDocument } from "./plaintext-adapter";

/**
 * Demo samples are the surface a competition judge sees first, so their risk
 * classes must come from the contract text and not from a comment hoping for
 * the best. This pins every sample's full deterministic rule profile: a
 * "passed" sample must be COMPLIANT everywhere, and each riskier sample must
 * violate exactly the dimensions its summary claims.
 */
const RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
  "DISPUTE_JURISDICTION",
] as const satisfies readonly RuleCode[];

type RuleProfile = Record<(typeof RULE_CODES)[number], RuleDisposition>;

const profileOf = (text: string): RuleProfile => {
  const assessments = new Map<string, RuleAssessment>(
    createAuditSnapshot({
      sourceRecordId: "demo-profile",
      document: normalizeContractDocument(text),
      policyLimitRatio: 0.3,
    }).ruleAssessments.map((assessment) => [assessment.ruleCode, assessment]),
  );
  return Object.fromEntries(
    RULE_CODES.map((ruleCode) => [ruleCode, assessments.get(ruleCode)?.disposition ?? "MISSING"]),
  ) as RuleProfile;
};

const COMPLIANT: RuleProfile = {
  ADVANCE_PAYMENT_LIMIT: "COMPLIANT",
  PENALTY_RATIO_LIMIT: "COMPLIANT",
  TERMINATION_CLAUSE_PRESENT: "COMPLIANT",
  DISPUTE_JURISDICTION: "COMPLIANT",
};

/** One contract per distinct rule profile; the shared shape stays COMPLIANT. */
const expectedProfiles: Record<string, Partial<RuleProfile>> = {
  // Passed: every dimension clean.
  "standard-equipment": {},
  "consulting-service": {},
  "tech-license": {},
  // Low: a single protective clause is missing.
  "logistics-service": { TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW" },
  "maintenance-service": { DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW" },
  "material-supply": { PENALTY_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW" },
  "spare-power-purchase": {},
  // Medium: a conflict plus a gap, or two gaps.
  "construction-material": {
    DISPUTE_JURISDICTION: "POLICY_CONFLICT",
    TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
  },
  "advertising-service": {
    DISPUTE_JURISDICTION: "POLICY_CONFLICT",
    PENALTY_RATIO_LIMIT: "NEEDS_HUMAN_REVIEW",
  },
  "it-outsourcing": {
    TERMINATION_CLAUSE_PRESENT: "NEEDS_HUMAN_REVIEW",
    DISPUTE_JURISDICTION: "NEEDS_HUMAN_REVIEW",
  },
  // High: a settled policy conflict on a money term, or a red-line party.
  "equipment-lease": {
    ADVANCE_PAYMENT_LIMIT: "POLICY_CONFLICT",
    DISPUTE_JURISDICTION: "POLICY_CONFLICT",
  },
  "engineering-service": {},

  // Wave 2 samples: the four legacy dimensions stay clean; their new-rule
  // findings are asserted in demo-agent.test.ts and wave2-rules.test.ts.
  "subcontract-back-to-back": {},
  "procurement-deposit-term": {},
  "custom-dev-ip": {},
};

test("every demo contract exposes the rule profile its risk class claims", () => {
  const mismatches = demoContracts.flatMap((contract) => {
    const expected = expectedProfiles[contract.id];
    if (expected === undefined) return [`${contract.id}: no expected profile declared`];
    const actual = profileOf(contract.text);
    const wanted = { ...COMPLIANT, ...expected };
    return RULE_CODES.filter((ruleCode) => actual[ruleCode] !== wanted[ruleCode]).map(
      (ruleCode) =>
        `${contract.id}.${ruleCode}: expected ${wanted[ruleCode]}, got ${actual[ruleCode]}`,
    );
  });

  expect(mismatches).toEqual([]);
});

test("every demo contract declares an expected profile", () => {
  const declared = new Set(Object.keys(expectedProfiles));
  const actual = demoContracts.map((contract) => contract.id);
  expect(actual.filter((id) => !declared.has(id))).toEqual([]);
  expect([...declared].filter((id) => !actual.includes(id))).toEqual([]);
});

test("demo contracts reach both a policy conflict and a fully compliant case", () => {
  const profiles = demoContracts.map((contract) => profileOf(contract.text));
  expect(profiles.some((profile) => profile.ADVANCE_PAYMENT_LIMIT === "POLICY_CONFLICT")).toBe(
    true,
  );
  expect(profiles.some((profile) => Object.values(profile).every((d) => d === "COMPLIANT"))).toBe(
    true,
  );
});

test("the first sample is the one the drawer and the E2E default path load", () => {
  // The default sample must violate the advance-payment limit, because the
  // acceptance suite's default audit asserts that exact finding text.
  expect(demoContracts[0].id).toBe("equipment-lease");
  expect(profileOf(demoContracts[0].text).ADVANCE_PAYMENT_LIMIT).toBe("POLICY_CONFLICT");
});
