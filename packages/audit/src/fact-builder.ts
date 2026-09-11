import {
  ContractNormalizationError,
  type ContractDocument,
  type EvidenceLocator,
  type PaymentFacts,
} from "./model";

const PERCENTAGE_PATTERN = /([0-9]+(?:\.[0-9]+)?)%/u;

export interface PaymentTermAnalysis {
  facts: PaymentFacts;
  evidence: EvidenceLocator[];
}

/**
 * Extracts the payment Fact and its evidence locators from a normalized
 * Contract Document. The first percentage span is the advance payment ratio;
 * the policy limit is a request input and is anchored as its own locator so
 * that rule assessments and finding proposals can cite stable IDs.
 */
export function buildPaymentFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
  policyLimitRatio: number;
}): PaymentTermAnalysis {
  for (const block of input.document.blocks) {
    const match = PERCENTAGE_PATTERN.exec(block.text);
    if (!match) continue;

    const quotedText = match[0];
    const startOffset = Array.from(block.text.slice(0, match.index)).length;
    const policyQuotedText = `policyLimitRatio: ${input.policyLimitRatio}`;
    const advancePaymentRatio = Number(quotedText.slice(0, -1)) / 100;

    return {
      facts: {
        advancePaymentRatio,
        policyLimitRatio: input.policyLimitRatio,
      },
      evidence: [
        {
          id: "contract-payment",
          sourceRecordId: input.sourceRecordId,
          contractDocumentHash: input.document.hash,
          blockId: block.blockId,
          startOffset,
          endOffset: startOffset + Array.from(quotedText).length,
          quotedText,
        },
        {
          id: "policy-limit",
          sourceRecordId: input.sourceRecordId,
          contractDocumentHash: input.document.hash,
          blockId: "policy-limit",
          startOffset: 0,
          endOffset: Array.from(policyQuotedText).length,
          quotedText: policyQuotedText,
        },
      ],
    };
  }

  throw new ContractNormalizationError("No percentage found in contract text");
}
