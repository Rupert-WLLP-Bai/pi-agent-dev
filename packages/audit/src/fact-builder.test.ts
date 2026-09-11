import { expect, test } from "bun:test";
import { buildPaymentFacts } from "./fact-builder";
import { ContractNormalizationError } from "./model";
import { normalizeContractDocument } from "./plaintext-adapter";

const contractText = "乙方签订后支付合同金额的70%作为预付款。";

test("anchors the 70% payment term to a stable text span", () => {
  const document = normalizeContractDocument(contractText);
  const analysis = buildPaymentFacts({ sourceRecordId: "source-1", document, policyLimitRatio: 0.3 });

  expect(analysis.facts).toEqual({ advancePaymentRatio: 0.7, policyLimitRatio: 0.3 });
  expect(analysis.evidence[0]).toMatchObject({
    id: "contract-payment",
    blockId: "p-1",
    quotedText: "70%",
    contractDocumentHash: document.hash,
  });
});

test("exposes the policy limit as a citable evidence locator", () => {
  const document = normalizeContractDocument(contractText);
  const analysis = buildPaymentFacts({ sourceRecordId: "source-1", document, policyLimitRatio: 0.3 });

  expect(analysis.evidence[1]).toMatchObject({
    id: "policy-limit",
    blockId: "policy-limit",
    quotedText: "policyLimitRatio: 0.3",
  });
  expect(analysis.evidence.map((locator) => locator.id)).toEqual(["contract-payment", "policy-limit"]);
});

test("rejects text containing no percentage", () => {
  const document = normalizeContractDocument("没有任何比例条款的合同文本。");

  expect(() => buildPaymentFacts({ sourceRecordId: "source-1", document, policyLimitRatio: 0.3 })).toThrow(
    ContractNormalizationError,
  );
});
