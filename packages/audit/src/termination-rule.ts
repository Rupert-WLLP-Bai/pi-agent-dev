import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const TERMINATION_CLAUSE_RULE_CODE = "TERMINATION_CLAUSE_PRESENT" as const;

export interface TerminationClauseFacts {
  /** True when at least one block establishes a termination/rescission clause. */
  hasTerminationClause: boolean;
  evidenceBlockId: string | null;
}

export interface TerminationClauseAnalysis {
  facts: TerminationClauseFacts;
  evidence: EvidenceLocator[];
}

/**
 * A section heading that names the clause: "第七条 合同解除", "第十二条 终止".
 * Heading evidence comes from the IR's structural classification, so a body
 * paragraph merely containing the word 解除 never satisfies this.
 */
const HEADING_CLAUSE = /第[一二三四五六七八九十百千零0-9]+\s*条.*?(解除|终止)/u;

/**
 * Affirmative body phrasing: the verb must act on the contract itself
 * ("解除本合同", "终止合同"). Mentions like "终止供货" or "不得解除保密义务"
 * name a different object and must not count as a termination clause.
 */
const BODY_CLAUSE = /(?:解除|终止)(?:本|该)?(?:合同|协议)/u;

/**
 * Detects whether the contract contains a termination or rescission clause.
 *
 * Two signals, in priority order:
 *
 * 1. A heading block whose 第X条 title names 解除/终止 — the IR classified it
 *    as a heading, so it IS the clause.
 * 2. A paragraph with an affirmative act on the contract — "守约方有权解除
 *    本合同". Requiring the 合同/协议 object filters out "终止供货" (stopping
 *    deliveries) and "不得解除保密义务" (a covenant that cannot be waived),
 *    both of which are not termination clauses.
 */
export function buildTerminationClauseFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): TerminationClauseAnalysis {
  const blocks = input.document.blocks;

  // Pass 1: a heading that names the clause.
  const heading = blocks.find(
    (block) => block.kind === "heading" && HEADING_CLAUSE.test(block.text),
  );
  if (heading !== undefined) {
    return {
      facts: { hasTerminationClause: true, evidenceBlockId: heading.blockId },
      evidence: [evidenceFor(input, heading.blockId)],
    };
  }

  // Pass 2: an affirmative act on the contract in any block.
  const body = blocks.find((block) => BODY_CLAUSE.test(block.text));
  if (body !== undefined) {
    return {
      facts: { hasTerminationClause: true, evidenceBlockId: body.blockId },
      evidence: [evidenceFor(input, body.blockId)],
    };
  }

  return {
    facts: { hasTerminationClause: false, evidenceBlockId: null },
    evidence: [],
  };
}

function evidenceFor(
  input: { sourceRecordId: string; document: ContractDocument },
  blockId: string,
): EvidenceLocator {
  const block = input.document.blocks.find((item) => item.blockId === blockId);
  const text = block?.text ?? "";
  const quotedText = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return {
    id: "contract-termination",
    sourceRecordId: input.sourceRecordId,
    location: {
      kind: "DOCUMENT_SPAN",
      contractDocumentHash: input.document.hash,
      blockId,
      startOffset: 0,
      endOffset: Array.from(quotedText).length,
      quotedText,
    },
  };
}

export function evaluateTerminationClauseRule(facts: TerminationClauseFacts): RuleAssessment {
  if (facts.hasTerminationClause) {
    return {
      id: "assessment-termination",
      ruleCode: TERMINATION_CLAUSE_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: ["contract-termination"],
      basis: "合同文本中包含终止/解除条款。",
    };
  }

  return {
    id: "assessment-termination",
    ruleCode: TERMINATION_CLAUSE_RULE_CODE,
    disposition: "NEEDS_HUMAN_REVIEW",
    evidenceIds: [],
    basis: "合同文本中未检出终止或解除条款，存在合同终止条件缺失风险，需人工确认。",
  };
}
