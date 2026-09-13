import { expect, test } from "bun:test";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import type { FindingProposal, Severity } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { demoProposalsFor } from "./demo-agent";

/**
 * Acceptance runs and the competition demo both use the deterministic agent,
 * so its output is the risk picture a judge actually sees. Auditing every demo
 * contract here pins two things the per-rule tests cannot: that a contract
 * breaching several dimensions yields one finding per dimension, and that the
 * sample set really spans passed / single-gap / multi-gap / hard conflict.
 */

/** Runs the same pipeline the dispatcher runs, over one demo contract. */
async function auditDemo(id: string): Promise<FindingProposal[]> {
  const contract = demoContracts.find((item) => item.id === id);
  if (!contract) throw new Error(`unknown demo contract: ${id}`);
  const snapshot = createAuditSnapshot({
    sourceRecordId: `demo-${id}`,
    document: normalizeContractDocument(contract.text),
    policyLimitRatio: 0.3,
  });
  const verification = await runSubjectVerification({
    parties: snapshot.parties,
    port: createFixtureSubjectVerificationPort(),
  });
  return demoProposalsFor({
    ...snapshot,
    evidence: [...snapshot.evidence, ...verification.evidence],
    ruleAssessments: [...snapshot.ruleAssessments, verification.ruleAssessment],
  });
}

const findingTypesOf = async (id: string): Promise<string[]> =>
  (await auditDemo(id)).map((proposal) => proposal.findingType);

/** The severity a queue row would show: the worst proposal, or none at all. */
function caseSeverity(proposals: FindingProposal[]): Severity | "PASSED" {
  if (proposals.length === 0) return "PASSED";
  const ranks: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return proposals.reduce<Severity>(
    (worst, proposal) => (ranks[proposal.severity] > ranks[worst] ? proposal.severity : worst),
    "LOW",
  );
}

test("a contract breaching two dimensions yields a finding for each", async () => {
  // 50% advance payment AND a Chengdu jurisdiction: the reviewer must see both,
  // not just whichever one the precedence order happens to reach first.
  expect(await findingTypesOf("equipment-lease")).toEqual([
    "ADVANCE_PAYMENT_POLICY_CONFLICT",
    "DISPUTE_JURISDICTION_CONFLICT",
  ]);
});

test("a contract with several gaps reports every missing clause", async () => {
  expect((await findingTypesOf("it-outsourcing")).sort()).toEqual([
    "DISPUTE_CLAUSE_MISSING",
    "TERMINATION_CLAUSE_MISSING",
  ]);
});

test("a clean contract produces no finding at all", async () => {
  const clean: string[] = [];
  for (const contract of demoContracts) {
    if ((await auditDemo(contract.id)).length === 0) clean.push(contract.id);
  }

  // These samples have every rule COMPLIANT. They must not carry a token
  // low-severity finding: "no finding" and "low risk" are different states.
  expect(clean.sort()).toEqual(["consulting-service", "standard-equipment", "tech-license"]);
});

test("the demo set spans every risk level the queue can render", async () => {
  const distribution: Record<string, number> = {};
  for (const contract of demoContracts) {
    const key = caseSeverity(await auditDemo(contract.id));
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  // No LOW tier is reachable: every deterministic rule either settles a
  // conflict or asks for human review, so nothing is merely advisory. The
  // sample set reflects that rather than inventing a tier the rules cannot
  // justify — see demo-contracts.test.ts for the per-contract rule profiles.
  expect(distribution).toEqual({ HIGH: 5, MEDIUM: 7, PASSED: 3 });
});

test("the wave 2 samples report the expanded catalogue's findings", async () => {
  expect(await findingTypesOf("subcontract-back-to-back")).toEqual([
    "PERFORMANCE_BOND_RATIO_POLICY_CONFLICT",
    "BACK_TO_BACK_PAYMENT_CLAUSE",
    "DISPUTE_RESOLUTION_CONFLICT",
  ]);
  expect(await findingTypesOf("procurement-deposit-term")).toEqual([
    "PAYMENT_TERM_POLICY_CONFLICT",
    "DEPOSIT_RATIO_POLICY_CONFLICT",
  ]);
  expect(await findingTypesOf("custom-dev-ip")).toEqual([
    "IP_OWNERSHIP_MISSING",
    "CONFIDENTIALITY_PERIOD_MISSING",
  ]);
});

test("subject verification, not a clause rule, drives the counterparty findings", async () => {
  expect(await findingTypesOf("engineering-service")).toEqual(["SUBJECT_RED_LINE_RISK"]);
  expect(await findingTypesOf("spare-power-purchase")).toEqual(["NEEDS_HUMAN_REVIEW"]);
});
