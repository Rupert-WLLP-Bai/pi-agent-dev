import { expect, test } from "bun:test";
import { buildContractDocument } from "./document-ir";
import { normalizeContractDocument } from "./plaintext-adapter";

test("assigns stable ids and contiguous code-point offsets", () => {
  const { document, text } = buildContractDocument([
    { text: "第一段。", kind: "paragraph" },
    { text: "第二段。", kind: "paragraph" },
  ]);

  expect(document.blocks.map((b) => b.blockId)).toEqual(["p-1", "p-2"]);
  expect(document.blocks[0]).toMatchObject({ startOffset: 0, endOffset: 4 });
  // Blocks are joined by "\n\n" (2 code points), so the second block starts at 6.
  expect(document.blocks[1].startOffset).toBe(6);
  expect(text).toBe("第一段。\n\n第二段。");
});

test("hashes the canonical text, not the source bytes", () => {
  // Same content via two different RawBlock lists (one with trailing whitespace)
  // must produce the same hash — the IR is format-independent.
  const clean = buildContractDocument([{ text: "合同正文", kind: "paragraph" }]);
  const dirty = buildContractDocument([{ text: "合同正文   ", kind: "paragraph" }]);

  expect(clean.document.hash).toBe(dirty.document.hash);
});

test("preserves heading kind and tracks the section path", () => {
  const { document } = buildContractDocument([
    { text: "第一条 支付方式", kind: "heading" },
    { text: "甲方支付30%预付款。", kind: "paragraph" },
    { text: "第二条 交付", kind: "heading" },
    { text: "乙方按期交付。", kind: "paragraph" },
  ]);

  expect(document.blocks[0].kind).toBe("heading");
  expect(document.blocks[1].sectionPath).toEqual(["第一条 支付方式"]);
  expect(document.blocks[3].sectionPath).toEqual(["第二条 交付"]);
});

test("drops empty blocks so they never become evidence anchors", () => {
  const { document } = buildContractDocument([
    { text: "有效段落", kind: "paragraph" },
    { text: "   ", kind: "paragraph" },
    { text: "", kind: "paragraph" },
  ]);

  expect(document.blocks).toHaveLength(1);
  expect(document.blocks[0].text).toBe("有效段落");
});

test("plaintext adapter delegates to the IR builder and infers headings", () => {
  const document = normalizeContractDocument("第一条 支付\n\n甲方支付70%预付款。");

  expect(document.blocks[0].kind).toBe("heading");
  expect(document.blocks[1].kind).toBe("paragraph");
  expect(document.blocks[1].sectionPath).toEqual(["第一条 支付"]);
});

test("round-trips the same hash for equivalent text and IR input", () => {
  const text = "第一条 支付\n\n甲方支付30%预付款。";
  const fromPlaintext = normalizeContractDocument(text);
  const fromRaw = buildContractDocument([
    { text: "第一条 支付", kind: "heading" },
    { text: "甲方支付30%预付款。", kind: "paragraph" },
  ]).document;

  // Both join blocks with "\n\n" and hash the canonical text, so the hash
  // is identical — the format-agnostic identity property.
  expect(fromPlaintext.hash).toBe(fromRaw.hash);
});
