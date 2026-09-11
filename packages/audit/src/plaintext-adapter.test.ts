import { expect, test } from "bun:test";
import { normalizeContractDocument } from "./plaintext-adapter";

test("splits the contract text into paragraph blocks with stable IDs", () => {
  const document = normalizeContractDocument("第一段。70%\n\n第二段。");

  expect(document.blocks.map((block) => block.blockId)).toEqual(["p-1", "p-2"]);
  expect(document.blocks[0]).toMatchObject({ text: "第一段。70%", startOffset: 0 });
  expect(document.blocks[1]).toMatchObject({ text: "第二段。" });
});

test("hashes the contract text deterministically", () => {
  const first = normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。");
  const second = normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。");

  expect(first.hash).toBe(second.hash);
  expect(first.hash).toHaveLength(64);
});

test("does not extract facts — the adapter only normalizes", () => {
  const document = normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。");

  expect(Object.keys(document)).toEqual(["hash", "blocks"]);
});
