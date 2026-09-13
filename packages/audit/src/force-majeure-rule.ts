import { clauseEvidence, findClause } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const FORCE_MAJEURE_RULE_CODE = "FORCE_MAJEURE_OVERBROAD" as const;

const EVIDENCE_ID = "contract-force-majeure";
const CLAUSE = /不可抗力/u;
/**
 * Events that are foreseeable business risk, not force majeure. Listing them
 * rewrites 《民法典》第一百八十条's three-element definition into a general
 * excuse.
 */
const BROADENERS =
  /市场价格波动|价格波动|政策调整|政府政策|政策变化|第三方原因|经营状况|资金不到位|汇率变动|市场变化/u;
const UNLIMITED_EXCUSE = /不承担任何责任|免除全部责任|概不负责|不承担任何赔偿/u;
const NOTICE_OR_PROOF = /通知|证明|告知/u;

export interface ForceMajeureFacts {
  hasClause: boolean;
  broadeners: boolean;
  unlimitedWithoutNotice: boolean;
}

export interface ForceMajeureAnalysis {
  facts: ForceMajeureFacts;
  evidence: EvidenceLocator[];
}

export function buildForceMajeureFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): ForceMajeureAnalysis {
  const hit = findClause(input.document, CLAUSE);
  if (hit === null) {
    return {
      facts: { hasClause: false, broadeners: false, unlimitedWithoutNotice: false },
      evidence: [],
    };
  }
  return {
    facts: {
      hasClause: true,
      broadeners: BROADENERS.test(hit.window),
      unlimitedWithoutNotice:
        UNLIMITED_EXCUSE.test(hit.window) && !NOTICE_OR_PROOF.test(hit.window),
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

export function evaluateForceMajeureRule(facts: ForceMajeureFacts): RuleAssessment {
  if (!facts.hasClause) {
    return {
      id: "assessment-force-majeure",
      ruleCode: FORCE_MAJEURE_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定不可抗力条款，不涉及范围过宽。",
    };
  }
  if (facts.broadeners) {
    return {
      id: "assessment-force-majeure",
      ruleCode: FORCE_MAJEURE_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [EVIDENCE_ID],
      basis: "不可抗力条款将市场价格波动、政策调整等可预见商业风险纳入免责范围，属范围过宽。",
    };
  }
  if (facts.unlimitedWithoutNotice) {
    return {
      id: "assessment-force-majeure",
      ruleCode: FORCE_MAJEURE_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [EVIDENCE_ID],
      basis: "不可抗力条款约定全部免责但未要求通知与证明义务，免责过度。",
    };
  }
  return {
    id: "assessment-force-majeure",
    ruleCode: FORCE_MAJEURE_RULE_CODE,
    disposition: "COMPLIANT",
    evidenceIds: [EVIDENCE_ID],
    basis: "不可抗力条款范围符合法律定义并约定了通知/证明义务。",
  };
}
