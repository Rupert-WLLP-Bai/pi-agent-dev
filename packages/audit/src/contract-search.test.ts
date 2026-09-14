import { expect, test } from "bun:test";
import {
  DOCUMENT_CHAR_BUDGET,
  readContractBlock,
  readContractDocument,
  SEARCH_SNIPPET_CONTEXT,
  searchContract,
  searchContractReport,
  UnknownContractBlockError,
} from "./contract-search";
import type { ContractDocument } from "./model";

const document: ContractDocument = {
  hash: "hash-1",
  blocks: [
    { blockId: "b1", text: "第一条 甲方应支付预付款 30%。", startOffset: 0, endOffset: 15 },
    {
      blockId: "b2",
      text: "预付款比例为30%，其余预付款于验收后支付。",
      startOffset: 15,
      endOffset: 40,
    },
    { blockId: "b3", text: "第八条 争议由重庆市法院管辖。", startOffset: 40, endOffset: 56 },
  ],
};

test("reports every match in document order with offsets into the block text", () => {
  const matches = searchContract(document, "预付款");
  expect(matches.map((match) => match.blockId)).toEqual(["b1", "b2", "b2"]);
  for (const match of matches) {
    const block = document.blocks.find((item) => item.blockId === match.blockId);
    if (!block) throw new Error(`unknown block ${match.blockId}`);
    expect(block.text.slice(match.startOffset, match.endOffset)).toBe("预付款");
    expect(match.snippet).toContain("预付款");
    expect(match.snippet.length).toBeLessThanOrEqual("预付款".length + 2 * SEARCH_SNIPPET_CONTEXT);
  }
});

test("matches case-insensitively", () => {
  const latin: ContractDocument = {
    hash: "hash-2",
    blocks: [{ blockId: "b1", text: "The ADVANCE payment is due.", startOffset: 0, endOffset: 25 }],
  };
  expect(searchContract(latin, "advance")).toHaveLength(1);
  expect(searchContract(latin, "Advance")[0].startOffset).toBe(4);
});

test("returns an empty list when nothing matches", () => {
  expect(searchContract(document, "不存在")).toEqual([]);
});

test("honours the result limit", () => {
  expect(searchContract(document, "预付款", 1)).toHaveLength(1);
  expect(searchContract(document, "预付款", 1)[0].blockId).toBe("b1");
});

test("reads a block with its neighbours and nulls at the document edges", () => {
  const middle = readContractBlock(document, "b2");
  expect(middle.text).toBe(document.blocks[1].text);
  expect(middle.previous).toEqual({ blockId: "b1", text: document.blocks[0].text });
  expect(middle.next).toEqual({ blockId: "b3", text: document.blocks[2].text });

  const first = readContractBlock(document, "b1");
  expect(first.previous).toBeNull();
  expect(first.next?.blockId).toBe("b2");

  const last = readContractBlock(document, "b3");
  expect(last.previous?.blockId).toBe("b2");
  expect(last.next).toBeNull();
});

test("searchContractReport keeps one hit per block and flags a truncated cap", () => {
  const report = searchContractReport(document, "预付款", 1);
  expect(report.matches.map((match) => match.blockId)).toEqual(["b1"]);
  expect(report.truncated).toBe(true);

  const uncut = searchContractReport(document, "预付款");
  expect(uncut.matches.map((match) => match.blockId)).toEqual(["b1", "b2"]);
  expect(uncut.truncated).toBe(false);
});

test("searchContractReport ORs several queries in document order", () => {
  const report = searchContractReport(document, ["管辖", "预付款"]);
  expect(report.matches.map((match) => match.blockId)).toEqual(["b1", "b2", "b3"]);
  expect(report.matches[0]?.startOffset).toBe(document.blocks[0].text.indexOf("预付款"));
  expect(report.truncated).toBe(false);
});

test("readContractDocument returns every block until the character budget", () => {
  const view = readContractDocument(document);
  expect(view.truncated).toBe(false);
  expect(view.outline).toBeUndefined();
  expect(view.blocks).toEqual(
    document.blocks.map((block) => ({ blockId: block.blockId, text: block.text })),
  );
});

test("readContractDocument falls back to an outline when the budget is exceeded", () => {
  const long: ContractDocument = {
    hash: "hash-long",
    blocks: [
      { blockId: "h1", text: `第一条 ${"甲".repeat(80)}`, startOffset: 0, endOffset: 90 },
      { blockId: "h2", text: `第二条\n其余条款。`, startOffset: 90, endOffset: 110 },
    ],
  };
  const view = readContractDocument(long, 20);
  expect(view.truncated).toBe(true);
  expect(view.blocks).toEqual([]);
  expect(view.outline).toEqual([
    { blockId: "h1", heading: `第一条 ${"甲".repeat(80)}`.slice(0, 80) },
    { blockId: "h2", heading: "第二条" },
  ]);
});

test("DOCUMENT_CHAR_BUDGET is the default cut-off for a full-document read", () => {
  expect(DOCUMENT_CHAR_BUDGET).toBe(16_000);
});

test("an unknown block id errors with the available ids hinted", () => {
  let error: unknown;
  try {
    readContractBlock(document, "nope");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UnknownContractBlockError);
  expect((error as Error).message).toContain("nope");
  expect((error as Error).message).toContain("b1");
});
