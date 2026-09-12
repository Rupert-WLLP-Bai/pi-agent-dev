import { buildContractDocument, type RawBlock } from "./document-ir";
import type { ContractDocument } from "./model";

/**
 * Normalizes pasted text into a Contract Document. Plain text has no styles or
 * pages, so the only inference is section headings: a paragraph opening with
 * 第X条/第X章 is a heading. This adapter owns segmentation only — it does not
 * create Facts or Rule Assessments (ADR-0001: adapters normalize, they do not
 * interpret).
 */
export function normalizeContractDocument(contractText: string): ContractDocument {
  const rawBlocks: RawBlock[] = contractText.split("\n\n").map((paragraph) => ({
    text: paragraph,
    kind: (/^第[一二三四五六七八九十百千零0-9]+[条章节]/u.test(paragraph.trim())
      ? "heading"
      : "paragraph") as RawBlock["kind"],
  }));

  return buildContractDocument(rawBlocks).document;
}
