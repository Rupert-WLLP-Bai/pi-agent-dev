import { buildAmountInWordsFacts, evaluateAmountInWordsRule } from "./amount-words-rule";
import { buildBackToBackFacts, evaluateBackToBackRule } from "./back-to-back-rule";
import { buildBidBondFacts, evaluateBidBondRule } from "./bid-bond-rule";
import {
  buildConfidentialityFacts,
  evaluateConfidentialityPeriodRule,
} from "./confidentiality-period-rule";
import {
  type ContractStance,
  inferContractStance,
  isRuleApplicableInStance,
  RULE_STANCE_APPLICABILITY,
} from "./contract-stance";
import { buildDepositFacts, evaluateDepositRule } from "./deposit-rule";
import {
  buildDisputeResolutionFacts,
  evaluateDisputeResolutionConflictRule,
} from "./dispute-conflict-rule";
import { buildDisputeJurisdictionFacts, evaluateDisputeJurisdictionRule } from "./dispute-rule";
import { buildPaymentFacts } from "./fact-builder";
import { buildForceMajeureFacts, evaluateForceMajeureRule } from "./force-majeure-rule";
import { buildGuaranteeModeFacts, evaluateGuaranteeModeRule } from "./guarantee-mode-rule";
import { buildIpOwnershipFacts, evaluateIpOwnershipRule } from "./ip-ownership-rule";
import { buildLiabilityCapFacts, evaluateLiabilityCapRule } from "./liability-cap-rule";
import type {
  AuditSnapshot,
  ContractDocument,
  ContractParty,
  ContractStanceRecord,
  RuleAssessment,
  RuleCode,
  RuleParamSet,
} from "./model";
import { extractContractParties } from "./party-extractor";
import { evaluateAdvancePaymentRule } from "./payment-rule";
import { buildPaymentTermFacts, evaluatePaymentTermRule } from "./payment-term-rule";
import { buildPenaltyRatioFacts, evaluatePenaltyRatioRule } from "./penalty-rule";
import { buildPerformanceBondFacts, evaluatePerformanceBondRule } from "./performance-bond-rule";
import { buildTerminationClauseFacts, evaluateTerminationClauseRule } from "./termination-rule";
import {
  buildWarrantyRetentionFacts,
  evaluateWarrantyRetentionRule,
} from "./warranty-retention-rule";

/** Prefers a stated stance over a read one, and records which it was. */
function resolveStance(input: {
  declared: ContractStance | null | undefined;
  parties: ContractParty[];
  ownOrganizationNames: readonly string[];
}): ContractStanceRecord {
  if (input.declared !== undefined && input.declared !== null) {
    return {
      stance: input.declared,
      basis: "立场由调用方声明（卷宗归档或人工指定）",
      source: "declared",
    };
  }
  const inferred = inferContractStance({
    parties: input.parties,
    ownOrganizationNames: input.ownOrganizationNames,
  });
  return { stance: inferred.stance, basis: inferred.basis, source: "inferred" };
}

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
 *
 * Assessments are appended in a stable order: the original four first, then the
 * catalogue expansion. Adding a rule must never renumber or reorder what an
 * earlier audit recorded, so the new dimensions follow rather than interleave.
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
  /**
   * The published Rule Version identity per rule code, parallel to
   * `ruleVersions`. Cited on each assessment so a Finding can pin the exact
   * version row behind a past decision.
   */
  ruleVersionIds?: Partial<Record<RuleCode, string>>;
  /**
   * Published parameter sets keyed by rule code, for the rules that read
   * parameters. A rule absent here runs on its catalogue defaults.
   */
  ruleParams?: Partial<Record<RuleCode, RuleParamSet>>;
  /**
   * The deterministic rules to run, by rule code. When omitted, every rule
   * runs. When provided, the returned assessments are narrowed to these codes;
   * fact extraction still runs in full so the snapshot's Evidence is complete.
   */
  enabledRuleCodes?: readonly RuleCode[];
  /**
   * The stance, when the caller already knows it — a filename marked
   * 【收入合同】, or an operator's choice. Overrides inference.
   */
  declaredStance?: ContractStance | null;
  /**
   * Name fragments identifying our own organization, used to read the stance
   * off the party list. Omitted leaves the stance unjudged, which applies every
   * rule rather than silently narrowing the audit.
   */
  ownOrganizationNames?: readonly string[];
}): AuditSnapshot {
  const document = input.document;
  const ruleParams = input.ruleParams ?? {};
  const policyLimitRatio = input.policyLimitRatio ?? 0.3;
  const { facts, hasAdvanceTerm, evidence } = buildPaymentFacts({
    sourceRecordId: input.sourceRecordId,
    document,
    policyLimitRatio,
    policyRuleVersionId: input.ruleVersionIds?.ADVANCE_PAYMENT_LIMIT ?? null,
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

  const performanceBond = buildPerformanceBondFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const paymentTerm = buildPaymentTermFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const backToBack = buildBackToBackFacts({ sourceRecordId: input.sourceRecordId, document });
  const deposit = buildDepositFacts({ sourceRecordId: input.sourceRecordId, document });
  const warrantyRetention = buildWarrantyRetentionFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const disputeConflict = buildDisputeResolutionFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const bidBond = buildBidBondFacts({ sourceRecordId: input.sourceRecordId, document });
  const ipOwnership = buildIpOwnershipFacts({ sourceRecordId: input.sourceRecordId, document });
  const guaranteeMode = buildGuaranteeModeFacts({ sourceRecordId: input.sourceRecordId, document });
  const confidentiality = buildConfidentialityFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });
  const forceMajeure = buildForceMajeureFacts({ sourceRecordId: input.sourceRecordId, document });
  const liabilityCap = buildLiabilityCapFacts({ sourceRecordId: input.sourceRecordId, document });
  const amountInWords = buildAmountInWordsFacts({
    sourceRecordId: input.sourceRecordId,
    document,
  });

  const ruleAssessments: RuleAssessment[] = [
    evaluateAdvancePaymentRule(facts, hasAdvanceTerm),
    evaluatePenaltyRatioRule(penaltyAnalysis.facts),
    evaluateTerminationClauseRule(terminationAnalysis.facts),
    evaluateDisputeJurisdictionRule(disputeAnalysis.facts, preferredJurisdiction),
    evaluatePerformanceBondRule(performanceBond.facts, ruleParams.PERFORMANCE_BOND_RATIO_LIMIT),
    evaluatePaymentTermRule(paymentTerm.facts, ruleParams.PAYMENT_TERM_LIMIT),
    evaluateBackToBackRule(backToBack.facts),
    evaluateDepositRule(deposit.facts, ruleParams.DEPOSIT_RATIO_LIMIT),
    evaluateWarrantyRetentionRule(
      warrantyRetention.facts,
      ruleParams.WARRANTY_RETENTION_RATIO_LIMIT,
    ),
    evaluateDisputeResolutionConflictRule(disputeConflict.facts),
    evaluateBidBondRule(bidBond.facts, ruleParams.BID_BOND_RATIO_LIMIT),
    evaluateIpOwnershipRule(ipOwnership.facts),
    evaluateGuaranteeModeRule(guaranteeMode.facts),
    evaluateConfidentialityPeriodRule(
      confidentiality.facts,
      ruleParams.CONFIDENTIALITY_PERIOD_MISSING,
    ),
    evaluateForceMajeureRule(forceMajeure.facts),
    evaluateLiabilityCapRule(liabilityCap.facts, ruleParams.LIABILITY_CAP_MISSING),
    evaluateAmountInWordsRule(amountInWords.facts),
  ].map((assessment) => ({
    ...assessment,
    ruleVersion: input.ruleVersions?.[assessment.ruleCode] ?? null,
    ruleVersionId: input.ruleVersionIds?.[assessment.ruleCode] ?? null,
  }));

  // The stance decides which rules have a premise here at all. A rule whose
  // premise is false is rewritten to NOT_APPLICABLE rather than dropped: a
  // reviewer has to be able to see that it was considered and why it was
  // skipped, and the rationale is what they would argue with.
  const stance = resolveStance({
    declared: input.declaredStance,
    parties,
    ownOrganizationNames: input.ownOrganizationNames ?? [],
  });
  const stanceScoped = ruleAssessments.map((assessment) =>
    isRuleApplicableInStance(assessment.ruleCode, stance.stance)
      ? assessment
      : {
          ...assessment,
          disposition: "NOT_APPLICABLE" as const,
          evidenceIds: [],
          basis: `${stance.basis}；本规则在该立场下不成立：${RULE_STANCE_APPLICABILITY[assessment.ruleCode].rationale}`,
        },
  );

  const enabledRuleCodes = input.enabledRuleCodes;
  const filteredAssessments = enabledRuleCodes
    ? stanceScoped.filter((assessment) =>
        (enabledRuleCodes as readonly string[]).includes(assessment.ruleCode),
      )
    : stanceScoped;

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
      ...performanceBond.evidence,
      ...paymentTerm.evidence,
      ...backToBack.evidence,
      ...deposit.evidence,
      ...warrantyRetention.evidence,
      ...disputeConflict.evidence,
      ...bidBond.evidence,
      ...ipOwnership.evidence,
      ...guaranteeMode.evidence,
      ...confidentiality.evidence,
      ...forceMajeure.evidence,
      ...liabilityCap.evidence,
      ...amountInWords.evidence,
    ],
    ruleAssessments: filteredAssessments,
    stance,
    policy: enabledRuleCodes
      ? {
          enabledRuleCodes: [...enabledRuleCodes],
          ruleVersionIds: input.ruleVersionIds ?? {},
          policyLimitRatio,
        }
      : undefined,
    createdAt: new Date().toISOString(),
  };
}
