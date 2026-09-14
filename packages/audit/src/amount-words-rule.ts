import { CHINESE_AMOUNT_PATTERN, parseChineseAmount } from "./chinese-amount";
import { extractMoney, spanEvidence, toHalfwidth } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment } from "./model";

export const AMOUNT_WORDS_RULE_CODE = "AMOUNT_IN_WORDS_MISMATCH" as const;

const EVIDENCE_ID = "contract-amount-in-words";

/**
 * Labels that mark a block as stating a contract-level amount.
 *
 * 合计 / 价税合计 are included because a price table states its total that way
 * rather than as 合同总价 — which is where the real 中升智联 contract writes both
 * forms of its 510,374.80 total.
 */
const AMOUNT_LABEL =
  /合同(?:总价|金额|价款|总额)|总价款|价款总额|发生金额|服务费(?:总额|用)?|合价|合计|总计|价税合计/u;

/** Characters of context in which a figure must sit to be the same amount. */
const PAIR_WINDOW = 40;

/**
 * Brackets that decorate a stated amount, as the real contracts write it:
 * 人民币大写【壹佰玖拾捌万】元整，小写【1980000】元. The bracket sits between the
 * figure and its 元, which would otherwise hide the amount from the money
 * extractor entirely.
 */
const AMOUNT_BRACKETS = /[【】〔〕〖〗]/gu;

/**
 * Neutralizes those brackets without moving anything.
 *
 * Each bracket becomes one space, so the string keeps its length and every
 * index still refers to the same character of the original block. Evidence is
 * anchored by offset, so a substitution that shortened the text would quote the
 * wrong span.
 */
const unbracket = (text: string): string => text.replace(AMOUNT_BRACKETS, " ");

export interface AmountInWordsFacts {
  /** The amount stated in words, in yuan; null when none was readable. */
  words: number | null;
  /** The amount stated in figures near those words, in yuan. */
  figures: number | null;
  /** The written form as the contract spells it, for the basis sentence. */
  wordsRaw: string | null;
  /** The figure form as the contract writes it. */
  figuresRaw: string | null;
}

export interface AmountInWordsAnalysis {
  facts: AmountInWordsFacts;
  evidence: EvidenceLocator[];
}

/**
 * Finds the contract total stated both ways in one block, and reads both.
 *
 * The two forms have to sit near each other to be the same amount. A written
 * total in one clause and an unrelated figure two clauses away are two amounts,
 * and comparing them would manufacture a mismatch the contract does not have —
 * so the search is windowed rather than document-wide.
 */
export function buildAmountInWordsFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): AmountInWordsAnalysis {
  for (const block of input.document.blocks) {
    if (!AMOUNT_LABEL.test(block.text)) continue;

    const text = unbracket(toHalfwidth(block.text));
    CHINESE_AMOUNT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(CHINESE_AMOUNT_PATTERN)) {
      const words = parseChineseAmount(match[0]);
      if (words === null) continue;

      const at = match.index ?? 0;
      const after = text.slice(at + match[0].length, at + match[0].length + PAIR_WINDOW);
      const before = text.slice(Math.max(0, at - PAIR_WINDOW), at);
      const figures = extractMoney(after) ?? extractMoney(before);
      if (figures === null) continue;

      return {
        facts: {
          words,
          figures: figures.amount,
          wordsRaw: match[0],
          figuresRaw: figures.raw,
        },
        evidence: [
          spanEvidence({
            id: EVIDENCE_ID,
            sourceRecordId: input.sourceRecordId,
            document: input.document,
            blockId: block.blockId,
            index: Array.from(text.slice(0, at)).length,
            length: Array.from(match[0]).length,
          }),
        ],
      };
    }
  }

  return {
    facts: { words: null, figures: null, wordsRaw: null, figuresRaw: null },
    evidence: [],
  };
}

/**
 * Asserts the written total and the figure total agree.
 *
 * Under Chinese drafting convention the written form controls when the two
 * disagree, which is precisely why a mismatch is a live dispute rather than a
 * typo: the party that reads the figure and the party that reads the words each
 * have a defensible position on what was agreed.
 */
export function evaluateAmountInWordsRule(facts: AmountInWordsFacts): RuleAssessment {
  const base = { id: "assessment-amount-in-words", ruleCode: AMOUNT_WORDS_RULE_CODE } as const;

  if (facts.words === null || facts.figures === null) {
    return {
      ...base,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: "合同未在同一处同时以大写与小写载明金额，无可交叉校验的金额对。",
    };
  }

  // A hundredth of a yuan is below the precision either form expresses.
  if (Math.abs(facts.words - facts.figures) < 0.01) {
    return {
      ...base,
      disposition: "COMPLIANT",
      evidenceIds: [EVIDENCE_ID],
      basis: `大写金额「${facts.wordsRaw}」与小写金额「${facts.figuresRaw}」一致，均为 ${facts.words} 元。`,
    };
  }

  return {
    ...base,
    disposition: "POLICY_CONFLICT",
    evidenceIds: [EVIDENCE_ID],
    basis: `大写金额「${facts.wordsRaw}」为 ${facts.words} 元，小写金额「${facts.figuresRaw}」为 ${facts.figures} 元，二者不一致，差额 ${Math.round(Math.abs(facts.words - facts.figures) * 100) / 100} 元；按惯例大写为准，双方对合同价款可各持一说。`,
  };
}
