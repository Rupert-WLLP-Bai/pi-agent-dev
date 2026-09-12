import { expect, test } from "bun:test";
import { normalizeContractDocument } from "./plaintext-adapter";
import { extractContractParties } from "./party-extractor";

const extract = (contractText: string) =>
  extractContractParties({ sourceRecordId: "source-1", document: normalizeContractDocument(contractText) });

test("drops a trailing qualifier but keeps the registered name", () => {
  const { parties } = extract("乙方：深圳精工科技有限公司（供货方）");

  expect(parties).toHaveLength(1);
  expect(parties[0]).toMatchObject({ label: "乙方", name: "深圳精工科技有限公司" });
});

test("keeps an internal parenthetical that belongs to the name", () => {
  const { parties } = extract("乙方：腾讯科技（深圳）有限公司");

  expect(parties[0].name).toBe("腾讯科技（深圳）有限公司");
});

test("does not read a payment clause as a party", () => {
  const { parties, evidence } = extract("甲方应在合同签订后七日内支付合同总价款");

  expect(parties).toEqual([]);
  expect(evidence).toEqual([]);
});

test("yields no parties from a document with no party lines", () => {
  const { parties } = extract("设备采购合同\n\n第一条 合同标的\n甲方向乙方采购数控机床一台。");

  expect(parties).toEqual([]);
});

test("anchors the name locator to the exact span inside its block", () => {
  const document = normalizeContractDocument("乙方：深圳精工科技有限公司（供货方）");
  const { parties, evidence } = extractContractParties({ sourceRecordId: "source-1", document });
  const [party] = parties;
  const locator = evidence.find((item) => item.id === party.evidenceId);

  expect(locator).toBeDefined();
  expect(locator?.sourceRecordId).toBe("source-1");
  expect(locator?.location).toMatchObject({
    kind: "DOCUMENT_SPAN",
    blockId: "p-1",
    quotedText: party.name,
  });
  if (locator?.location.kind !== "DOCUMENT_SPAN") throw new Error("expected a document span locator");
  const { startOffset, endOffset } = locator.location;
  expect(document.blocks[0].text.slice(startOffset, endOffset)).toBe(party.name);
});
