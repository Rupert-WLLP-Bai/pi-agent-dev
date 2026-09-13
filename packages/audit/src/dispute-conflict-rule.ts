import { clauseEvidence } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const DISPUTE_RESOLUTION_CONFLICT_RULE_CODE = "DISPUTE_RESOLUTION_CONFLICT" as const;

const EVIDENCE_ID = "contract-dispute-conflict";
/** A parallel choice: arbitration on one branch, litigation on the other. */
const PARALLEL_PATTERNS: RegExp[] = [
  /仲裁[^。；]{0,24}(?:或|或者|也可以|亦可|任选)[^。；]{0,24}(?:诉讼|起诉|人民法院|法院)/u,
  /(?:诉讼|起诉|人民法院|法院)[^。；]{0,24}(?:或|或者|也可以|亦可|任选)[^。；]{0,24}仲裁/u,
];
/** "仲裁不成的，可向人民法院起诉" is a valid fallback, not a conflict. */
const POST_ARBITRATION = /仲裁[^。；]{0,12}(?:不成|不服|未果|失败|不能解决)/u;

export interface DisputeResolutionFacts {
  hasConflict: boolean;
}

export interface DisputeResolutionAnalysis {
  facts: DisputeResolutionFacts;
  evidence: EvidenceLocator[];
}

/**
 * Detects a clause that lets a party choose arbitration *or* litigation. The
 * parallel connector is required, so a pure arbitration clause, a pure
 * litigation clause, and the valid "仲裁不成可诉" fallback all stay clean.
 */
export function buildDisputeResolutionFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): DisputeResolutionAnalysis {
  for (const block of input.document.blocks) {
    if (!/争议|纠纷|仲裁|诉讼|管辖|法院/u.test(block.text)) continue;
    if (POST_ARBITRATION.test(block.text)) continue;
    for (const pattern of PARALLEL_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(block.text);
      if (match === null) continue;
      return {
        facts: { hasConflict: true },
        evidence: [
          clauseEvidence({
            id: EVIDENCE_ID,
            sourceRecordId: input.sourceRecordId,
            document: input.document,
            hit: {
              blockId: block.blockId,
              text: block.text,
              window: "",
              keyword: match[0],
              keywordStart: Array.from(block.text.slice(0, match.index)).length,
              keywordLength: Array.from(match[0]).length,
            },
          }),
        ],
      };
    }
  }
  return { facts: { hasConflict: false }, evidence: [] };
}

export function evaluateDisputeResolutionConflictRule(
  facts: DisputeResolutionFacts,
): RuleAssessment {
  if (!facts.hasConflict) {
    return {
      id: "assessment-dispute-conflict",
      ruleCode: DISPUTE_RESOLUTION_CONFLICT_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未约定可同时选择仲裁或诉讼的争议解决方式。",
    };
  }
  return {
    id: "assessment-dispute-conflict",
    ruleCode: DISPUTE_RESOLUTION_CONFLICT_RULE_CODE,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis:
      "合同约定争议可申请仲裁也可向法院起诉（或裁或诉），依《仲裁法司法解释》第七条该仲裁协议无效。",
  };
}
