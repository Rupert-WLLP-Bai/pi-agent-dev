import { clauseEvidence, extractDuration, findClause, numberParam } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment, RuleParamSet } from "./model";

export const CONFIDENTIALITY_PERIOD_RULE_CODE = "CONFIDENTIALITY_PERIOD_MISSING" as const;

export const DEFAULT_CONFIDENTIALITY_MAX_YEARS = 5;

const EVIDENCE_ID = "contract-confidentiality";
const CLAUSE = /保密|商业秘密/u;
/** Open-ended wording that leaves the obligation running forever. */
const INDEFINITE = /长期有效|永久|无期限/u;
/** An event-bound end is a real term: "至相关信息公开之日止". */
const OPEN_ENDED = /至[^。；]{0,12}(?:公开|解密|丧失秘密性)/u;

export interface ConfidentialityFacts {
  hasClause: boolean;
  /** Stated confidentiality period in years; null when none is stated. */
  periodYears: number | null;
  indefinite: boolean;
  openEnded: boolean;
}

export interface ConfidentialityAnalysis {
  facts: ConfidentialityFacts;
  evidence: EvidenceLocator[];
}

/**
 * Flags a confidentiality clause with no term. Silence makes the duty run until
 * the information loses its secret character — effectively forever — which is
 * broader than an operator expects from a fixed-term contract.
 */
export function buildConfidentialityFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): ConfidentialityAnalysis {
  const hit = findClause(input.document, CLAUSE);
  if (hit === null) {
    return {
      facts: { hasClause: false, periodYears: null, indefinite: false, openEnded: false },
      evidence: [],
    };
  }
  const duration = extractDuration(hit.window);
  return {
    facts: {
      hasClause: true,
      periodYears: duration === null ? null : duration.years,
      indefinite: INDEFINITE.test(hit.window),
      openEnded: OPEN_ENDED.test(hit.window),
    },
    evidence: [
      clauseEvidence({
        id: EVIDENCE_ID,
        sourceRecordId: input.sourceRecordId,
        document: input.document,
        hit,
      }),
    ],
  };
}

export function evaluateConfidentialityPeriodRule(
  facts: ConfidentialityFacts,
  params?: RuleParamSet,
): RuleAssessment {
  const maxYears = numberParam(params, "expectedMaxYears", DEFAULT_CONFIDENTIALITY_MAX_YEARS);

  if (!facts.hasClause) {
    return {
      id: "assessment-confidentiality",
      ruleCode: CONFIDENTIALITY_PERIOD_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定保密条款，不涉及保密期限。",
    };
  }

  if (facts.indefinite) {
    return {
      id: "assessment-confidentiality",
      ruleCode: CONFIDENTIALITY_PERIOD_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [EVIDENCE_ID],
      basis: "保密期限约定为长期/永久，义务无确定终点，存在过度约束风险。",
    };
  }

  if (facts.periodYears !== null) {
    const conflict = facts.periodYears > maxYears;
    return {
      id: "assessment-confidentiality",
      ruleCode: CONFIDENTIALITY_PERIOD_RULE_CODE,
      disposition: conflict ? "POLICY_CONFLICT" : "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: conflict
        ? `保密期限 ${Math.round(facts.periodYears * 10) / 10} 年超过建议上限 ${maxYears} 年。`
        : `保密期限 ${Math.round(facts.periodYears * 10) / 10} 年未超过建议上限 ${maxYears} 年。`,
    };
  }

  if (facts.openEnded) {
    return {
      id: "assessment-confidentiality",
      ruleCode: CONFIDENTIALITY_PERIOD_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: "保密期限以信息公开/解密为终点，属可接受的期限约定。",
    };
  }

  return {
    id: "assessment-confidentiality",
    ruleCode: CONFIDENTIALITY_PERIOD_RULE_CODE,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis: "存在保密条款但未约定保密期限，保密义务将持续至信息丧失秘密性为止，需明确约定期限。",
  };
}
