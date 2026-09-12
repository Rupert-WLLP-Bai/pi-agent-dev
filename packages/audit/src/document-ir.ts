import type { BlockKind, ContractBlock, ContractDocument } from "./model";

export type { BlockKind, ContractDocument } from "./model";

/**
 * Format-neutral unit a document parser emits. Parsing frontends (plain text,
 * docx, pdf) only decide WHAT the blocks are; this module alone decides how
 * blocks become the Contract Document IR — ids, offsets, section paths, hash.
 * One construction point keeps every ingestion format anchored identically.
 */
export interface RawBlock {
  text: string;
  /** Defaults to "paragraph"; furniture never participates in audits. */
  kind?: BlockKind;
  /** 1-based source page; defaults to null for pageless sources. */
  page?: number | null;
}

/** Heading labels like 第三条 / 第12章 open a new section for later blocks. */
const SECTION_HEADING_PATTERN = /^第[一二三四五六七八九十百千零0-9]+[条章节][\s　]*(.*)$/;

const isSectionHeading = (text: string): boolean => SECTION_HEADING_PATTERN.test(text);

const toKind = (raw: RawBlock): BlockKind => raw.kind ?? "paragraph";

/**
 * Builds the Contract Document IR from parsed blocks.
 *
 * Offsets are code-point based and index into the canonical text — the blocks
 * joined by a blank line — so a Finding's span means the same thing whether the
 * contract arrived as pasted text, a docx, or a pdf. The hash is taken over the
 * canonical text, not the source bytes: the same content under different
 * formats yields the same identity.
 */
export function buildContractDocument(rawBlocks: RawBlock[]): {
  document: ContractDocument;
  text: string;
} {
  const meaningful = rawBlocks.filter((block) => block.text.trim().length > 0);

  const blocks: ContractBlock[] = [];
  const sectionPath: string[] = [];
  let offset = 0;

  for (const [index, raw] of meaningful.entries()) {
    const text = raw.text.replace(/\s+$/u, "");
    const kind = toKind(raw);

    if (kind === "heading" && isSectionHeading(text)) {
      sectionPath.length = 0;
      sectionPath.push(text);
    }

    const length = Array.from(text).length;
    blocks.push({
      blockId: `p-${index + 1}`,
      text,
      startOffset: offset,
      endOffset: offset + length,
      kind,
      page: raw.page ?? null,
      ...(sectionPath.length > 0 ? { sectionPath: [...sectionPath] } : {}),
    });

    offset += length;
    if (index < meaningful.length - 1) {
      offset += 2;
    }
  }

  const text = blocks.map((block) => block.text).join("\n\n");
  const digest = new Bun.CryptoHasher("sha256");
  digest.update(text);
  return { document: { hash: digest.digest("hex"), blocks }, text };
}
