import type { ContractDocument, EvidenceLocator, PaymentFacts } from "./model";

const PERCENTAGE_PATTERN = /([0-9]+(?:\.[0-9]+)?)%/u;

/** Blocks whose text mentions an advance payment in Chinese. */
const ADVANCE_PAYMENT_HINTS = /预付|预缴|定金|首付/u;

export interface PaymentTermAnalysis {
  facts: PaymentFacts;
  /**
   * Whether the contract actually states an advance-payment term. When false,
   * the ratio is 0 because nothing was promised — not because 0% was written —
   * and no contract-span evidence is minted for it.
   */
  hasAdvanceTerm: boolean;
  evidence: EvidenceLocator[];
}

/**
 * Extracts the payment Fact and its evidence locators from a normalized
 * Contract Document. The advance payment ratio is the first percentage found
 * inside a block that mentions 预付/定金/首付; when no such block exists, the
 * first percentage in the document is used (backward compatibility). When no
 * percentage appears at all, the ratio defaults to 0 — the contract simply
 * does not specify an advance payment, which is COMPLIANT by definition.
 */
export function buildPaymentFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
  policyLimitRatio: number;
}): PaymentTermAnalysis {
  const blocks = input.document.blocks;

  // Pass 1: prefer a block that explicitly mentions advance payment.
  let targetBlock = blocks.find((block) => ADVANCE_PAYMENT_HINTS.test(block.text));

  // Pass 2: fall back to the first block with any percentage.
  if (!targetBlock) {
    targetBlock = blocks.find((block) => PERCENTAGE_PATTERN.test(block.text));
  }

  const match = targetBlock ? PERCENTAGE_PATTERN.exec(targetBlock.text) : null;
  const policyQuotedText = `policyLimitRatio: ${input.policyLimitRatio}`;

  const policyEvidence: EvidenceLocator = {
    id: "policy-limit",
    sourceRecordId: input.sourceRecordId,
    location: {
      kind: "DOCUMENT_SPAN",
      contractDocumentHash: input.document.hash,
      blockId: "policy-limit",
      startOffset: 0,
      endOffset: Array.from(policyQuotedText).length,
      quotedText: policyQuotedText,
    },
  };

  // No percentage anywhere → the contract does not state an advance term.
  // Minting a span here would cite an anchor that does not exist, so only the
  // policy input is recorded as evidence.
  if (!match || !targetBlock) {
    return {
      facts: {
        advancePaymentRatio: 0,
        policyLimitRatio: input.policyLimitRatio,
      },
      hasAdvanceTerm: false,
      evidence: [policyEvidence],
    };
  }

  const quotedText = match[0];
  const startOffset = Array.from(targetBlock.text.slice(0, match.index)).length;
  const advancePaymentRatio = Number(quotedText.slice(0, -1)) / 100;

  return {
    facts: {
      advancePaymentRatio,
      policyLimitRatio: input.policyLimitRatio,
    },
    hasAdvanceTerm: true,
    evidence: [
      {
        id: "contract-payment",
        sourceRecordId: input.sourceRecordId,
        location: {
          kind: "DOCUMENT_SPAN",
          contractDocumentHash: input.document.hash,
          blockId: targetBlock.blockId,
          startOffset,
          endOffset: startOffset + Array.from(quotedText).length,
          quotedText,
        },
      },
      policyEvidence,
    ],
  };
}
