import type { ContractDocument } from "./model";

/** Characters of context a search snippet keeps on each side of a match. */
export const SEARCH_SNIPPET_CONTEXT = 40;

/** Default number of matches `searchContract` returns when no limit is given. */
export const SEARCH_DEFAULT_LIMIT = 5;

/** One keyword hit inside a block, with a bounded window of its surroundings. */
export interface ContractSearchMatch {
  blockId: string;
  /** Bounded window of the block text around the match. */
  snippet: string;
  /** Match start offset within the block text. */
  startOffset: number;
  /** Match end offset within the block text, exclusive. */
  endOffset: number;
}

/** One block's text plus the blocks that neighbour it in document order. */
export interface ContractBlockView {
  blockId: string;
  text: string;
  previous: { blockId: string; text: string } | null;
  next: { blockId: string; text: string } | null;
}

/** Raised when a requested block id is not in the document. */
export class UnknownContractBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownContractBlockError";
  }
}

/**
 * Case-insensitive substring search over the Contract Document's blocks.
 *
 * Deliberately literal: no regex, no tokenizer, so the same document and query
 * always yield the same matches. Every hit in a block is reported, in document
 * order and then by offset, and the whole result is capped by `limit`. A query
 * with no hits — or an empty one — returns `[]`, never an error.
 */
export function searchContract(
  document: ContractDocument,
  query: string,
  limit: number = SEARCH_DEFAULT_LIMIT,
): ContractSearchMatch[] {
  const needle = query.toLowerCase();
  if (needle.length === 0 || limit <= 0) return [];

  const matches: ContractSearchMatch[] = [];
  for (const block of document.blocks) {
    const haystack = block.text.toLowerCase();
    let from = 0;
    while (matches.length < limit) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      matches.push({
        blockId: block.blockId,
        snippet: block.text.slice(
          Math.max(0, at - SEARCH_SNIPPET_CONTEXT),
          Math.min(block.text.length, end + SEARCH_SNIPPET_CONTEXT),
        ),
        startOffset: at,
        endOffset: end,
      });
      // Advance past this match so a hit cannot be counted twice and a
      // zero-length needle (already excluded) cannot loop forever.
      from = end;
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

/**
 * Reads one block in context: its full text, plus its previous and next block.
 * A neighbour is null at a document edge. An unknown id throws with a bounded
 * list of ids the caller could have meant.
 */
export function readContractBlock(document: ContractDocument, blockId: string): ContractBlockView {
  const index = document.blocks.findIndex((block) => block.blockId === blockId);
  if (index === -1) {
    const available = document.blocks.slice(0, 5).map((block) => block.blockId);
    throw new UnknownContractBlockError(
      `UNKNOWN_BLOCK: ${blockId}; 可用块 ID 示例: ${available.length > 0 ? available.join(", ") : "（无）"}`,
    );
  }

  const block = document.blocks[index];
  const before = index > 0 ? document.blocks[index - 1] : null;
  const after = index < document.blocks.length - 1 ? document.blocks[index + 1] : null;
  return {
    blockId: block.blockId,
    text: block.text,
    previous: before ? { blockId: before.blockId, text: before.text } : null,
    next: after ? { blockId: after.blockId, text: after.text } : null,
  };
}
