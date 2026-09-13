import { clauseEvidence, findClause, findMoneyNear, numberParam } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment, RuleParamSet } from "./model";

export const LIABILITY_CAP_RULE_CODE = "LIABILITY_CAP_MISSING" as const;

export const DEFAULT_LIABILITY_CAP_THRESHOLD = 5_000_000;

const EVIDENCE_ID = "contract-liability-cap";
const CAP_CLAUSE = /赔偿上限|责任限额|赔偿限额|累计赔偿|赔偿金额以|赔偿责任(?:以|不超过)/u;
const UNEQUAL_CAP = /(?:不设|无)(?:赔偿)?(?:上?限|限额)/u;
const CONTRACT_AMOUNT = /合同总价|合同金额|合同价款/u;

export interface LiabilityCapFacts {
  hasCapClause: boolean;
  hasUnequalCap: boolean;
  contractAmount: number | null;
}

export interface LiabilityCapAnalysis {
  facts: LiabilityCapFacts;
  evidence: EvidenceLocator[];
}

export function buildLiabilityCapFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): LiabilityCapAnalysis {
  const hit = findClause(input.document, CAP_CLAUSE);
  const amount = findMoneyNear(input.document, CONTRACT_AMOUNT);
  const evidence =
    hit === null
      ? []
      : [
          clauseEvidence({
            id: EVIDENCE_ID,
            sourceRecordId: input.sourceRecordId,
            document: input.document,
            hit,
          }),
        ];
  return {
    facts: {
      hasCapClause: hit !== null,
      hasUnequalCap: hit !== null && UNEQUAL_CAP.test(hit.window),
      contractAmount: amount === null ? null : amount.amount,
    },
    evidence,
  };
}

export function evaluateLiabilityCapRule(
  facts: LiabilityCapFacts,
  params?: RuleParamSet,
): RuleAssessment {
  const threshold = numberParam(
    params,
    "highValueThreshold",
    DEFAULT_LIABILITY_CAP_THRESHOLD,
  );

  if (facts.hasUnequalCap) {
    return {
      id: "assessment-liability-cap",
      ruleCode: LIABILITY_CAP_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [EVIDENCE_ID],
      basis: "合同约定一方不设赔偿责任上限（或仅约束单方），赔偿责任不对等。",
    };
  }

  if (facts.hasCapClause) {
    return {
      id: "assessment-liability-cap",
      ruleCode: LIABILITY_CAP_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: "合同约定了赔偿责任限额。",
    };
  }

  if (facts.contractAmount !== null && facts.contractAmount >= threshold) {
    return {
      id: "assessment-liability-cap",
      ruleCode: LIABILITY_CAP_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [],
      basis: `合同金额达 ${facts.contractAmount} 元且未约定赔偿责任上限，赔偿范围不确定，需人工确认。`,
    };
  }

  return {
    id: "assessment-liability-cap",
    ruleCode: LIABILITY_CAP_RULE_CODE,
    disposition: "COMPLIANT",
    evidenceIds: [],
    basis: "合同未达高价值门槛或已另有责任安排，不涉及赔偿责任上限缺失。",
  };
}
