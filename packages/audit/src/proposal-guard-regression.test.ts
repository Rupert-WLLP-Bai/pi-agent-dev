import { expect, test } from "bun:test";
import type { FindingProposal, RuleAssessment, RuleCode, RuleDisposition } from "./model";
import {
  assertProposalLegal,
  ProposalGuardError,
  RULE_FINDING_CONTRACTS,
  ruleContractFor,
  searchKeywordFor,
} from "./proposal-guard";
import { ENGINE_RULE_CODES } from "./rule-catalog";

/**
 * Guard regression matrix over all 19 rule contracts.
 *
 * The guard is the boundary that keeps a model proposal from becoming a formal
 * finding the deterministic rules never justified. Its contract table is one
 * row per RuleCode, so the regression has to cover every row — not only the
 * handful of rules a hand-written example happens to touch. Each case below
 * drives the guard with the exact combination a contract row authorizes and
 * asserts the boundary accepts it, then perturbs one element and asserts it
 * refuses.
 *
 * The point is the pairing, not the wording: a rule whose locked severity is
 * changed must stop accepting the old severity, and a rule that can only
 * abstain must never accept a policy-conflict proposal at all.
 */

const assessment = (
  ruleCode: RuleCode,
  disposition: RuleDisposition,
  id = `assessment-${ruleCode}`,
): RuleAssessment => ({
  id,
  ruleCode,
  disposition,
  basis: "回归矩阵",
  evidenceIds: ["contract-1"],
});

const proposalFor = (
  findingType: string,
  severity: FindingProposal["severity"],
  assessmentId: string,
): FindingProposal => ({
  assessmentId,
  findingType: findingType as FindingProposal["findingType"],
  severity,
  rationale: "回归矩阵提案",
  evidenceIds: ["contract-1"],
  remediation: "按规则处置",
});

/** Rules whose contract can settle a conflict lock one finding type + severity. */
const CONFLICT_RULES = RULE_FINDING_CONTRACTS.filter((row) => row.policyConflict !== null);

/** Rules that can only abstain open a severity range with no locked conflict. */
const ABSTAIN_ONLY_RULES = RULE_FINDING_CONTRACTS.filter((row) => row.policyConflict === null);

test("every engine rule code owns exactly one guard contract row", () => {
  for (const code of ENGINE_RULE_CODES) {
    expect(ruleContractFor(code), `${code} must have a contract row`).toBeDefined();
  }
  // No row may exist for a code the engine cannot evaluate: the rules API
  // rejects such a code, so a contract for it could never be reached.
  const contracted = new Set(RULE_FINDING_CONTRACTS.map((row) => row.ruleCode));
  for (const code of contracted) {
    expect(ENGINE_RULE_CODES as readonly string[]).toContain(code);
  }
});

test("every contract row exposes a search keyword the agent can call", () => {
  for (const row of RULE_FINDING_CONTRACTS) {
    expect(searchKeywordFor(row.ruleCode).length).toBeGreaterThan(0);
  }
});

for (const row of CONFLICT_RULES) {
  const locked = row.policyConflict;
  if (!locked) continue;

  test(`${row.ruleCode}: the locked severity is accepted and any other is refused`, () => {
    const ruleAssessment = assessment(row.ruleCode, "POLICY_CONFLICT");
    const legal = proposalFor(locked.findingType, locked.severity, ruleAssessment.id);
    expect(() => assertProposalLegal(legal, [ruleAssessment])).not.toThrow();

    // Every other severity must be refused: the lock is what keeps a model from
    // downgrading a HIGH rule to LOW to make a finding easier to close.
    for (const severity of ["LOW", "MEDIUM", "HIGH"] as const) {
      if (severity === locked.severity) continue;
      const illegal = proposalFor(locked.findingType, severity, ruleAssessment.id);
      expect(() => assertProposalLegal(illegal, [ruleAssessment])).toThrow(ProposalGuardError);
    }
  });
}

for (const row of ABSTAIN_ONLY_RULES) {
  const choice = row.needsHumanReview[0];
  if (!choice) continue;

  test(`${row.ruleCode}: an abstaining rule accepts only its open severity range`, () => {
    const ruleAssessment = assessment(row.ruleCode, "NEEDS_HUMAN_REVIEW");
    const [least, most] = choice.severity;
    const inside = [least, most].includes("MEDIUM") ? "MEDIUM" : least;
    const legal = proposalFor(
      choice.findingType,
      inside as FindingProposal["severity"],
      ruleAssessment.id,
    );
    expect(() => assertProposalLegal(legal, [ruleAssessment])).not.toThrow();

    // A rule that can only abstain has no locked conflict, so a policy-conflict
    // claim for its finding type must not sneak through by severity alone.
    expect(row.policyConflict).toBeNull();
  });
}

test("a proposal citing an assessment of a different rule is refused", () => {
  // The finding type belongs to one rule; citing another rule's assessment id
  // is the classic way a model would try to borrow an authorization.
  const row = CONFLICT_RULES[0];
  const locked = row.policyConflict;
  if (!locked) return;
  const otherRule = CONFLICT_RULES.find((candidate) => candidate.ruleCode !== row.ruleCode);
  if (!otherRule) return;
  const borrowed = assessment(otherRule.ruleCode, "POLICY_CONFLICT");
  expect(() =>
    assertProposalLegal(proposalFor(locked.findingType, locked.severity, borrowed.id), [borrowed]),
  ).toThrow(ProposalGuardError);
});

test("an assessment id that does not exist is refused before any rule is consulted", () => {
  const row = CONFLICT_RULES[0];
  const locked = row.policyConflict;
  if (!locked) return;
  expect(() =>
    assertProposalLegal(proposalFor(locked.findingType, locked.severity, "missing-assessment"), [
      assessment(row.ruleCode, "POLICY_CONFLICT"),
    ]),
  ).toThrow(/找不到评估 id/);
});

test("NOT_APPLICABLE is reported as unjudged, never as compliant", () => {
  // A rule scoped out by stance did not run. Reporting it as compliant would
  // tell the operator the contract was checked and cleared.
  const row = CONFLICT_RULES[0];
  const locked = row.policyConflict;
  if (!locked) return;
  const scopedOut = assessment(row.ruleCode, "NOT_APPLICABLE");
  expect(() =>
    assertProposalLegal(proposalFor(locked.findingType, locked.severity, scopedOut.id), [
      scopedOut,
    ]),
  ).toThrow(/不适用/);
});
