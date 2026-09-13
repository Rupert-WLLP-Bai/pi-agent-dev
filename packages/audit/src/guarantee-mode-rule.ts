import { clauseEvidence, findClause, hasKeyword } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const GUARANTEE_MODE_RULE_CODE = "GUARANTEE_MODE_AMBIGUOUS" as const;

const EVIDENCE_ID = "contract-guarantee";
const GUARANTEE_KEYWORD = /保证人|担保人|提供保证|承担保证责任|提供担保|担保责任|保证责任/u;
const JOINT_GUARANTEE = /连带责任保证|连带保证|连带责任/u;
const GENERAL_GUARANTEE = /一般保证/u;

export interface GuaranteeModeFacts {
  hasGuaranteeClause: boolean;
  hasJointGuarantee: boolean;
  hasGeneralGuarantee: boolean;
}

export interface GuaranteeModeAnalysis {
  facts: GuaranteeModeFacts;
  evidence: EvidenceLocator[];
}

/**
 * Flags a suretyship that names no mode. 《民法典》第六百八十六条第二款
 * presumes 一般保证 when the mode is silent, weakening the guarantee and
 * handing the guarantor a first-sue defence the parties likely did not intend.
 */
export function buildGuaranteeModeFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): GuaranteeModeAnalysis {
  const hit = findClause(input.document, GUARANTEE_KEYWORD);
  if (hit === null) {
    return {
      facts: { hasGuaranteeClause: false, hasJointGuarantee: false, hasGeneralGuarantee: false },
      evidence: [],
    };
  }
  return {
    facts: {
      hasGuaranteeClause: true,
      hasJointGuarantee: hasKeyword(input.document, JOINT_GUARANTEE),
      hasGeneralGuarantee: hasKeyword(input.document, GENERAL_GUARANTEE),
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

export function evaluateGuaranteeModeRule(facts: GuaranteeModeFacts): RuleAssessment {
  if (!facts.hasGuaranteeClause) {
    return {
      id: "assessment-guarantee-mode",
      ruleCode: GUARANTEE_MODE_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定保证担保，不涉及保证方式。",
    };
  }
  if (facts.hasJointGuarantee || facts.hasGeneralGuarantee) {
    return {
      id: "assessment-guarantee-mode",
      ruleCode: GUARANTEE_MODE_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: "合同已明确约定保证方式。",
    };
  }
  return {
    id: "assessment-guarantee-mode",
    ruleCode: GUARANTEE_MODE_RULE_CODE,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis:
      "合同约定了保证担保但未明确保证方式，依《民法典》第六百八十六条推定为一般保证，担保效力弱化。",
  };
}
