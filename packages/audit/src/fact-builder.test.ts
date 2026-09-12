import { expect, test } from "bun:test";
import { buildPaymentFacts } from "./fact-builder";
import { normalizeContractDocument } from "./plaintext-adapter";

const contractText = "乙方签订后支付合同金额的70%作为预付款。";

test("anchors the 70% payment term to a stable text span", () => {
  const document = normalizeContractDocument(contractText);
  const analysis = buildPaymentFacts({
    sourceRecordId: "source-1",
    document,
    policyLimitRatio: 0.3,
  });

  expect(analysis.facts).toEqual({ advancePaymentRatio: 0.7, policyLimitRatio: 0.3 });
  expect(analysis.evidence[0]).toMatchObject({
    id: "contract-payment",
    location: { blockId: "p-1", quotedText: "70%", contractDocumentHash: document.hash },
  });
});

test("exposes the policy limit as a citable evidence locator", () => {
  const document = normalizeContractDocument(contractText);
  const analysis = buildPaymentFacts({
    sourceRecordId: "source-1",
    document,
    policyLimitRatio: 0.3,
  });

  expect(analysis.evidence[1]).toMatchObject({
    id: "policy-limit",
    location: { blockId: "policy-limit", quotedText: "policyLimitRatio: 0.3" },
  });
  expect(analysis.evidence.map((locator) => locator.id)).toEqual([
    "contract-payment",
    "policy-limit",
  ]);
});

test("defaults to 0% advance when the contract has no percentage", () => {
  const document = normalizeContractDocument("没有任何比例条款的合同文本。");
  const analysis = buildPaymentFacts({
    sourceRecordId: "source-1",
    document,
    policyLimitRatio: 0.3,
  });

  // A contract with no advance payment clause is COMPLIANT — the ratio is 0,
  // which is below any positive policy limit. This is not an error condition.
  expect(analysis.facts.advancePaymentRatio).toBe(0);
  expect(analysis.facts.policyLimitRatio).toBe(0.3);
});

test("prefers a block mentioning 预付款 over the first percentage in the document", () => {
  const document = normalizeContractDocument(
    "第五条 违约金为合同总价的35%。\n\n第二条 甲方支付合同总价15%作为预付款。",
  );
  const analysis = buildPaymentFacts({
    sourceRecordId: "source-1",
    document,
    policyLimitRatio: 0.3,
  });

  // The fact builder must not confuse the penalty percentage with the advance
  // payment percentage — it targets the block that mentions 预付款.
  expect(analysis.facts.advancePaymentRatio).toBe(0.15);
});
