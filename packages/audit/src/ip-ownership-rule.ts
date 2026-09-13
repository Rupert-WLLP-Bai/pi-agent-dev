import { clauseEvidence, findClause, hasKeyword } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const IP_OWNERSHIP_RULE_CODE = "IP_OWNERSHIP_MISSING" as const;

const EVIDENCE_ID = "contract-ip-deliverable";
/** Deliverables whose ownership the law assigns by default when unaddressed. */
const DELIVERABLE_KEYWORD = /开发|定制|源代码|系统集成|研发|软件/u;
/** Any of these settles ownership, whichever way it assigns it. */
const IP_CLAUSE = /知识产权|著作权|专利权|申请专利|成果归属|署名权/u;

export interface IpOwnershipFacts {
  hasDeliverable: boolean;
  hasIpClause: boolean;
}

export interface IpOwnershipAnalysis {
  facts: IpOwnershipFacts;
  evidence: EvidenceLocator[];
}

/**
 * Flags a development/delivery contract that never says who owns the result.
 * 《民法典》第八百五十九条 defaults commissioned inventions to the developer,
 * which is usually the opposite of what a procurer expects — the risk is the
 * silence, not any particular assignment.
 */
export function buildIpOwnershipFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): IpOwnershipAnalysis {
  const deliverable = findClause(input.document, DELIVERABLE_KEYWORD);
  if (deliverable === null) {
    return { facts: { hasDeliverable: false, hasIpClause: false }, evidence: [] };
  }
  return {
    facts: {
      hasDeliverable: true,
      hasIpClause: hasKeyword(input.document, IP_CLAUSE),
    },
    evidence: [
      clauseEvidence({
        id: EVIDENCE_ID,
        sourceRecordId: input.sourceRecordId,
        document: input.document,
        hit: deliverable,
      }),
    ],
  };
}

export function evaluateIpOwnershipRule(facts: IpOwnershipFacts): RuleAssessment {
  if (!facts.hasDeliverable) {
    return {
      id: "assessment-ip-ownership",
      ruleCode: IP_OWNERSHIP_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同不含开发/定制等产生新成果的交付物，不涉及知识产权归属。",
    };
  }
  if (facts.hasIpClause) {
    return {
      id: "assessment-ip-ownership",
      ruleCode: IP_OWNERSHIP_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: "合同包含开发/定制交付物，且已约定知识产权归属。",
    };
  }
  return {
    id: "assessment-ip-ownership",
    ruleCode: IP_OWNERSHIP_RULE_CODE,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis: "合同包含开发/定制交付物，但全文未约定知识产权归属；依《民法典》第八百五十九条，法定归属可能与采购预期相反。",
  };
}
