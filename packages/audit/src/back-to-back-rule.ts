import { clauseEvidence, findClause } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const BACK_TO_BACK_RULE_CODE = "BACK_TO_BACK_PAYMENT_CLAUSE" as const;

const EVIDENCE_ID = "contract-back-to-back";
/**
 * 背靠背 phrasing. 法释〔2024〕11 号 holds these clauses void, so this is a
 * high-precision existence check: a bare "收到业主款后支付", a payment
 * conditioned on a third party, or a same-proportion settlement mirror all
 * count. "不以任何第三方付款为前提" is explicitly excluded by the lookbehind.
 */
const CLAUSE =
  /收到[^。；]{0,16}(?:第三方|业主|建设单位|发包人|总承包)[^。；]{0,16}(?:工程款|款项|付款|回款)[^。；]{0,12}(?:后|再)[^。；]{0,12}(?:支付|付款)|(?<![不非无])以[^。；]{0,10}(?:第三方|业主|建设单位|发包人)[^。；]{0,6}(?:付款|支付|拨款)[^。；]{0,4}(?:为|作为)(?:前提|条件)|按[^。；]{0,10}(?:业主|第三方|建设单位|发包人|总包)[^。；]{0,8}(?:付款|结算|回款)进度[^。；]{0,10}(?:同?比例)?(?:支付|付款)|(?:款项|资金)到位后[^。；]{0,6}(?:支付|付款)|待[^。；]{0,10}(?:业主|第三方|发包人)[^。；]{0,10}(?:付款|拨款|回款)[^。；]{0,6}后[^。；]{0,6}(?:支付|付款)/u;

export interface BackToBackFacts {
  hasClause: boolean;
}

export interface BackToBackAnalysis {
  facts: BackToBackFacts;
  evidence: EvidenceLocator[];
}

export function buildBackToBackFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): BackToBackAnalysis {
  const hit = findClause(input.document, CLAUSE);
  if (hit === null) {
    return { facts: { hasClause: false }, evidence: [] };
  }
  return {
    facts: { hasClause: true },
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

export function evaluateBackToBackRule(facts: BackToBackFacts): RuleAssessment {
  if (!facts.hasClause) {
    return {
      id: "assessment-back-to-back",
      ruleCode: BACK_TO_BACK_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定以第三方付款为付款前提的背靠背条款。",
    };
  }
  return {
    id: "assessment-back-to-back",
    ruleCode: BACK_TO_BACK_RULE_CODE,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis:
      "合同约定以收到第三方（业主/发包人）付款为付款前提，依《最高人民法院批复》（法释〔2024〕11 号）该类背靠背条款无效。",
  };
}
