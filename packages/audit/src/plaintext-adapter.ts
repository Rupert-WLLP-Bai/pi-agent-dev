import type { ContractBlock, ContractDocument } from "./model";

const hasher = (): { update(text: string): void; digest(): string } => {
  const instance = new Bun.CryptoHasher("sha256");
  return { update: (text) => instance.update(text), digest: () => instance.digest("hex") };
};

/**
 * Normalizes pasted text into a Contract Document. This adapter owns block
 * segmentation and hashing only — it does not create Facts or Rule
 * Assessments (ADR-0001: adapters normalize, they do not interpret).
 */
export function normalizeContractDocument(contractText: string): ContractDocument {
  const paragraphs = contractText.split("\n\n");
  const blocks: ContractBlock[] = [];
  let offset = 0;

  for (const [index, paragraph] of paragraphs.entries()) {
    const paragraphLength = Array.from(paragraph).length;
    blocks.push({
      blockId: `p-${index + 1}`,
      text: paragraph,
      startOffset: offset,
      endOffset: offset + paragraphLength,
    });

    offset += paragraphLength;
    if (index < paragraphs.length - 1) {
      offset += 2;
    }
  }

  const digest = hasher();
  digest.update(contractText);
  return { hash: digest.digest(), blocks };
}
