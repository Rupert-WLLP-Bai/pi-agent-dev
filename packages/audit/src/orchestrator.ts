import { buildDisputeJurisdictionFacts, evaluateDisputeJurisdictionRule } from "./dispute-rule";
import { buildPaymentFacts } from "./fact-builder";
import type { AuditSnapshot, ContractDocument, RuleAssessment, RuleCode } from "./model";
import { extractContractParties } from "./party-extractor";
import { evaluateAdvancePaymentRule } from "./payment-rule";
import { buildPenaltyRatioFacts, evaluatePenaltyRatioRule } from "./penalty-rule";
import { buildTerminationClauseFacts, evaluateTerminationClauseRule } from "./termination-rule";

/**
 * Assembles the document-derived half of an Audit Snapshot from a Contract
 * Document IR: Fact extraction, Contract Party extraction, and the
 * deterministic rules that need nothing but the contract itself.
 *
 * The document arrives already normalized — whichever parser read the source
 * owns segmentation, so this function never sees a file format. The subject
 * dimension is deliberately absent: resolving parties against an external
 * provider is a network call, so the dispatcher runs it as its own Audit Stage
 * and records the result separately rather than making snapshot assembly depend
 * on a third party.
 */
export function createAuditSnapshot(input: {
  sourceRecordId: string;
  /** The Contract Document IR — built by whichever parser handled the source. */
  document: ContractDocument;
  /** Policy ceiling for the advance-payment ratio as a 0–1 ratio. Defaults to 0.3. */
  policyLimitRatio?: number;
  /** Policy ceiling for breach-of-contract penalty as a 0–1 ratio. Defaults to 0.3. */
  policyPenaltyLimit?: number;
  /** Our side's preferred dispute jurisdiction (e.g. "重庆"). Defaults to "重庆". */
  preferredJurisdiction?: string;
  /**
   * The published Rule Version each rule's parameters were read from, keyed by
   * rule code. A cited version travels into the matching assessment, so a
   * Finding built on it can name the exact parameter set it was judged under.
   */
  ruleVersions?: Partial<Record<RuleCode, number>>;
}): AuditSnapshot {
  const document = input.document;
  const policyLimitRatio = input.policyLimitRatio ?? 0.3;
  const { facts, hasAdvanceTerm, evidence } = buildPaymentFacts({
    sourceRecordId: input.sourceRecordId,
    document,
    policyLimitRatio,
  });
  const { parties, evidence: partyEvidence } = extractContractParties({
    sourceRecordId: input.sourceRecordId,
    document,
  });

  const penaltyLimit = input.policyPenaltyLimit ?? 0.3;
  const preferredJurisdiction = input.preferredJurisdiction ?? "重庆";

  const penaltyAnalysis = buildPenaltyRatioFacts({
    sourceRecordId: input.sourceRecordId,
    document,
    policyPenaltyLimit: penaltyLimit,
  });
  const terminationAnalysis = buildTerminationClauseFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const disputeAnalysis = buildDisputeJurisdictionFacts({
    sourceRecordId: input.sourceRecordId,
    document,
    preferredJurisdiction,
  });

  const ruleAssessments: RuleAssessment[] = [
    evaluateAdvancePaymentRule(facts, hasAdvanceTerm),
    evaluatePenaltyRatioRule(penaltyAnalysis.facts),
    evaluateTerminationClauseRule(terminationAnalysis.facts),
    evaluateDisputeJurisdictionRule(disputeAnalysis.facts, preferredJurisdiction),
  ].map((assessment) => ({
    ...assessment,
    ruleVersion: input.ruleVersions?.[assessment.ruleCode] ?? null,
  }));

  return {
    sourceRecordId: input.sourceRecordId,
    contractDocument: document,
    facts,
    parties,
    evidence: [
      ...evidence,
      ...partyEvidence,
      ...penaltyAnalysis.evidence,
      ...terminationAnalysis.evidence,
      ...disputeAnalysis.evidence,
    ],
    ruleAssessments,
    createdAt: new Date().toISOString(),
  };
}
