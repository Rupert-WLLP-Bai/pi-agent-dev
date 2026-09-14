import { expect, test } from "bun:test";
import type { FindingProposal, RuleAssessment, RuleCode, RuleDisposition } from "./model";
import {
  assertProposalLegal,
  ProposalGuardError,
  RULE_CONTRACT_TABLE_IS_COMPLETE,
  RULE_FINDING_CONTRACTS,
  ruleContractFor,
} from "./proposal-guard";

/** Builds the minimal assessment a guard case needs. */
function assessment(ruleCode: RuleCode, disposition: RuleDisposition): RuleAssessment {
  return {
    id: `assessment-${ruleCode}`,
    disposition,
    ruleCode,
    evidenceIds: [],
    basis: "测试用评估",
  };
}

function proposal(
  findingType: FindingProposal["findingType"],
  severity: FindingProposal["severity"],
  assessmentId: string,
): FindingProposal {
  return {
    assessmentId,
    findingType,
    severity,
    rationale: "理由",
    evidenceIds: [],
    remediation: "处理",
  };
}

test("the contract table covers every rule code", () => {
  expect(RULE_CONTRACT_TABLE_IS_COMPLETE).toBe(true);
  expect(RULE_FINDING_CONTRACTS).toHaveLength(18);
  for (const contract of RULE_FINDING_CONTRACTS) {
    expect(ruleContractFor(contract.ruleCode)).toBe(contract);
    // A rule that can settle a conflict names at least one legal finding.
    expect(contract.policyConflict !== null || contract.needsHumanReview.length > 0).toBe(true);
  }
});

test("a settled conflict accepts exactly its locked severity", () => {
  const assessments = [assessment("ADVANCE_PAYMENT_LIMIT", "POLICY_CONFLICT")];
  expect(() =>
    assertProposalLegal(
      proposal("ADVANCE_PAYMENT_POLICY_CONFLICT", "HIGH", "assessment-ADVANCE_PAYMENT_LIMIT"),
      assessments,
    ),
  ).not.toThrow();
  expect(() =>
    assertProposalLegal(
      proposal("ADVANCE_PAYMENT_POLICY_CONFLICT", "MEDIUM", "assessment-ADVANCE_PAYMENT_LIMIT"),
      assessments,
    ),
  ).toThrow(ProposalGuardError);
});

test("a proposal against a compliant dimension is rejected, not crashed", () => {
  const assessments = [assessment("ADVANCE_PAYMENT_LIMIT", "COMPLIANT")];
  let error: unknown;
  try {
    assertProposalLegal(
      proposal("ADVANCE_PAYMENT_POLICY_CONFLICT", "HIGH", "assessment-ADVANCE_PAYMENT_LIMIT"),
      assessments,
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ProposalGuardError);
  expect((error as Error).message).toContain("合规");
});

test("a needs-review dimension accepts severities inside the preset range inclusive", () => {
  const assessments = [assessment("PERFORMANCE_BOND_RATIO_LIMIT", "NEEDS_HUMAN_REVIEW")];
  // The table opens LOW..MEDIUM for this rule; both bounds are legal.
  expect(() =>
    assertProposalLegal(
      proposal("NEEDS_HUMAN_REVIEW", "LOW", "assessment-PERFORMANCE_BOND_RATIO_LIMIT"),
      assessments,
    ),
  ).not.toThrow();
  expect(() =>
    assertProposalLegal(
      proposal("NEEDS_HUMAN_REVIEW", "MEDIUM", "assessment-PERFORMANCE_BOND_RATIO_LIMIT"),
      assessments,
    ),
  ).not.toThrow();
  let error: unknown;
  try {
    assertProposalLegal(
      proposal("NEEDS_HUMAN_REVIEW", "HIGH", "assessment-PERFORMANCE_BOND_RATIO_LIMIT"),
      assessments,
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ProposalGuardError);
  expect((error as Error).message).toContain("LOW–MEDIUM");
});

test("a finding type no rule names is rejected", () => {
  const assessments = [assessment("ADVANCE_PAYMENT_LIMIT", "POLICY_CONFLICT")];
  expect(() =>
    assertProposalLegal(
      proposal(
        "MADE_UP_RISK" as FindingProposal["findingType"],
        "HIGH",
        "assessment-ADVANCE_PAYMENT_LIMIT",
      ),
      assessments,
    ),
  ).toThrow(ProposalGuardError);
});

test("a settled conflict is not legal for a finding its rule does not open", () => {
  // PENALTY_CLAUSE_MISSING belongs to the review disposition, never the
  // conflict one, so a conflict assessment must not authorize it.
  const assessments = [assessment("PENALTY_RATIO_LIMIT", "POLICY_CONFLICT")];
  expect(() =>
    assertProposalLegal(
      proposal("PENALTY_CLAUSE_MISSING", "MEDIUM", "assessment-PENALTY_RATIO_LIMIT"),
      assessments,
    ),
  ).toThrow(ProposalGuardError);
});
