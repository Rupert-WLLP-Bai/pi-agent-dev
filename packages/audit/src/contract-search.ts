import type { ContractDocument } from "./model";

/** Characters of context a search snippet keeps on each side of a match. */
export const SEARCH_SNIPPET_CONTEXT = 40;

/** Default number of matches `searchContract` returns when no limit is given. */
export const SEARCH_DEFAULT_LIMIT = 5;

/**
 * Character budget for `readContractDocument`. Typical MVP samples are ~2KB;
 * above this the tool returns an outline instead of every block's full text.
 */
export const DOCUMENT_CHAR_BUDGET = 16_000;

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

/**
 * Tool-facing search result. `truncated` is true when more unique blocks
 * matched than `limit`, so a caller can fall through to the full document
 * instead of treating the cap as "that's all there is".
 */
export interface ContractSearchReport {
  matches: ContractSearchMatch[];
  truncated: boolean;
}

/** One block's text plus the blocks that neighbour it in document order. */
export interface ContractBlockView {
  blockId: string;
  text: string;
  previous: { blockId: string; text: string } | null;
  next: { blockId: string; text: string } | null;
}

/** One heading line used when a full-document read will not fit the budget. */
export interface ContractDocumentOutlineEntry {
  blockId: string;
  heading: string;
}

/** Full-document view the agent reads instead of surveying with search. */
export interface ContractDocumentView {
  blocks: Array<{ blockId: string; text: string }>;
  truncated: boolean;
  outline?: ContractDocumentOutlineEntry[];
}

/** Raised when a requested block id is not in the document. */
export class UnknownContractBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownContractBlockError";
  }
}

const snippetAround = (text: string, start: number, end: number): string =>
  text.slice(
    Math.max(0, start - SEARCH_SNIPPET_CONTEXT),
    Math.min(text.length, end + SEARCH_SNIPPET_CONTEXT),
  );

const headingOf = (text: string): string => {
  const firstLine = text.split(/\n/, 1)[0] ?? "";
  return firstLine.slice(0, 80);
};

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
        snippet: snippetAround(block.text, at, end),
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
 * Literal OR-search that reports at most one hit per block. Empty queries,
 * and queries that miss, return `{ matches: [], truncated: false }` — that
 * means these tokens are absent, not that the clause is absent.
 */
export function searchContractReport(
  document: ContractDocument,
  query: string | string[],
  limit: number = SEARCH_DEFAULT_LIMIT,
): ContractSearchReport {
  const needles = (Array.isArray(query) ? query : [query])
    .map((item) => item.toLowerCase().trim())
    .filter((item) => item.length > 0);
  if (needles.length === 0 || limit <= 0) return { matches: [], truncated: false };

  const matches: ContractSearchMatch[] = [];
  let truncated = false;
  for (const block of document.blocks) {
    const haystack = block.text.toLowerCase();
    let best: ContractSearchMatch | null = null;
    for (const needle of needles) {
      const at = haystack.indexOf(needle);
      if (at === -1) continue;
      if (best === null || at < best.startOffset) {
        const end = at + needle.length;
        best = {
          blockId: block.blockId,
          snippet: snippetAround(block.text, at, end),
          startOffset: at,
          endOffset: end,
        };
      }
    }
    if (best === null) continue;
    if (matches.length < limit) matches.push(best);
    else truncated = true;
  }
  return { matches, truncated };
}

/**
 * Reads the whole contract for the agent. Under the character budget every
 * block's full text is returned; over it, only an outline of first lines, so
 * a long document still has a cheap way in.
 */
export function readContractDocument(
  document: ContractDocument,
  budget: number = DOCUMENT_CHAR_BUDGET,
): ContractDocumentView {
  const totalChars = document.blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (totalChars <= budget) {
    return {
      blocks: document.blocks.map((block) => ({ blockId: block.blockId, text: block.text })),
      truncated: false,
    };
  }
  return {
    blocks: [],
    truncated: true,
    outline: document.blocks.map((block) => ({
      blockId: block.blockId,
      heading: headingOf(block.text),
    })),
  };
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
