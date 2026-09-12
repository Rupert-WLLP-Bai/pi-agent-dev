import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const PENALTY_RATIO_RULE_CODE = "PENALTY_RATIO_LIMIT" as const;

export interface PenaltyRatioFacts {
  /** Extracted penalty as a fraction of contract value (e.g. 0.3 = 30%). Null when not found. */
  penaltyRatio: number | null;
  /** Policy ceiling for penalty as a fraction (e.g. 0.3). */
  policyPenaltyLimit: number;
}

export interface PenaltyRatioAnalysis {
  facts: PenaltyRatioFacts;
  evidence: EvidenceLocator[];
}

const PENALTY_SECTION_PATTERNS = [
  /(?:第\s*[一二三四五六七八九十百\d]+\s*条\s*.*?(?:违约|违约责任|违约金))/u,
  /(?:违约金|违约责任|逾期违约)/u,
];

/**
 * Extracts the penalty ratio from blocks that mention breach of contract.
 * Looks for patterns like "违约金为合同总价的20%" or "支付合同金额30%的违约金"
 * within the breach-of-contract section. When no penalty clause exists, the
 * rule reports NEEDS_HUMAN_REVIEW rather than COMPLIANT — a contract with no
 * penalty clause at all is itself a risk.
 */
export function buildPenaltyRatioFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
  policyPenaltyLimit: number;
}): PenaltyRatioAnalysis {
  const PERCENTAGE_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*%/u;

  for (const block of input.document.blocks) {
    const isPenaltySection = PENALTY_SECTION_PATTERNS.some((pattern) => pattern.test(block.text));
    if (!isPenaltySection) continue;

    const match = PERCENTAGE_PATTERN.exec(block.text);
    if (!match) continue;

    const quotedText = match[0];
    const startOffset = Array.from(block.text.slice(0, match.index)).length;
    const penaltyRatio = Number(match[1]) / 100;

    return {
      facts: {
        penaltyRatio,
        policyPenaltyLimit: input.policyPenaltyLimit,
      },
      evidence: [
        {
          id: "contract-penalty",
          sourceRecordId: input.sourceRecordId,
          location: {
            kind: "DOCUMENT_SPAN",
            contractDocumentHash: input.document.hash,
            blockId: block.blockId,
            startOffset,
            endOffset: startOffset + Array.from(quotedText).length,
            quotedText,
          },
        },
        {
          id: "policy-penalty-limit",
          sourceRecordId: input.sourceRecordId,
          location: {
            kind: "DOCUMENT_SPAN",
            contractDocumentHash: input.document.hash,
            blockId: "policy-penalty-limit",
            startOffset: 0,
            endOffset: Array.from(`policyPenaltyLimit: ${input.policyPenaltyLimit}`).length,
            quotedText: `policyPenaltyLimit: ${input.policyPenaltyLimit}`,
          },
        },
      ],
    };
  }

  return {
    facts: { penaltyRatio: null, policyPenaltyLimit: input.policyPenaltyLimit },
    evidence: [],
  };
}

export function evaluatePenaltyRatioRule(facts: PenaltyRatioFacts): RuleAssessment {
  if (facts.penaltyRatio === null) {
    return {
      id: "assessment-penalty",
      ruleCode: PENALTY_RATIO_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [],
      basis: "合同文本中未检出违约金条款，存在违约责任约定缺失风险，需人工确认。",
    };
  }

  const conflict = facts.penaltyRatio > facts.policyPenaltyLimit;
  const actual = Math.round(facts.penaltyRatio * 100);
  const limit = Math.round(facts.policyPenaltyLimit * 100);

  return {
    id: "assessment-penalty",
    ruleCode: PENALTY_RATIO_RULE_CODE,
    disposition: conflict ? "POLICY_CONFLICT" : "COMPLIANT",
    evidenceIds: ["contract-penalty", "policy-penalty-limit"],
    basis: conflict
      ? `违约金比例 ${actual}% 高于制度上限 ${limit}%（超出 ${actual - limit} 个百分点）。`
      : `违约金比例 ${actual}% 未超过制度上限 ${limit}%。`,
  };
}
