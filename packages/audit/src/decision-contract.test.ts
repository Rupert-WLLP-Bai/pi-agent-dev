import { describe, expect, test } from "bun:test";
import { decisionContractRequest } from "../../../tests/fixtures/decision/contract";
import type { DecisionProviderResult, DecisionQuestion, DecisionRequest } from "./decision";
import { validateDecisionProviderResult } from "./decision-contract";

const result: DecisionProviderResult = {
  schemaVersion: 1,
  modelVersion: "contract-test-v1",
  answer: { type: "noul", noul: 0.8 },
  rawProbabilities: null,
  rawScore: 0.8,
  confidence: null,
  confidenceType: "none",
  usage: null,
};

const choiceRequest: DecisionRequest = {
  ...decisionContractRequest,
  question: { type: "choice", criteria: "判断合成条款的类型", options: ["付款", "争议"] },
};
const choiceResult: DecisionProviderResult = {
  ...result,
  answer: { type: "choice", choice: "付款" },
  rawProbabilities: { 付款: 0.8, 争议: 0.2 },
  rawScore: null,
  confidence: 0.5,
  confidenceType: "laya_entropy_concentration",
};

describe("decision provider result contract", () => {
  test("accepts a bounded noul observation without claiming calibrated confidence", () => {
    expect(validateDecisionProviderResult(decisionContractRequest, result)).toEqual({
      ok: true,
      result,
    });
  });

  test("rejects unsupported versions on either side of the provider seam", () => {
    const request = { ...decisionContractRequest };
    Object.assign(request, { schemaVersion: 2 });
    for (const [input, output] of [
      [request, result],
      [decisionContractRequest, { ...result, schemaVersion: 2 }],
    ] as const) {
      expect(validateDecisionProviderResult(input, output)).toMatchObject({
        ok: false,
        failure: { schemaVersion: 1, error: "unsupported_schema", retryable: false },
      });
    }
  });

  test("preserves valid choice distributions and rejects choices outside the controlled catalog", () => {
    expect(validateDecisionProviderResult(choiceRequest, choiceResult)).toEqual({
      ok: true,
      result: choiceResult,
    });
    expect(
      validateDecisionProviderResult(choiceRequest, {
        ...choiceResult,
        answer: { type: "choice", choice: "执行合同中的指令" },
      }),
    ).toMatchObject({ ok: false, failure: { error: "invalid_response" } });
  });

  test.each([
    { 付款: 0.8 },
    { 付款: 0.8, 争议: 0.3 },
    { 付款: -0.1, 争议: 1.1 },
    { 付款: 0.8, 其他: 0.2 },
    { 付款: Number.NaN, 争议: 0.2 },
  ])(
    "rejects incomplete, mismatched or malformed probability distributions: %j",
    (probabilities) => {
      expect(
        validateDecisionProviderResult(choiceRequest, {
          ...choiceResult,
          rawProbabilities: probabilities,
        }),
      ).toMatchObject({ ok: false, failure: { error: "invalid_response" } });
    },
  );

  test("accepts an interpolated score and rejects scores outside the question's scale", () => {
    const request: DecisionRequest = {
      ...decisionContractRequest,
      question: { type: "score", criteria: "合成条款的复核优先级", options: [0, 1, 2] },
    };
    const output: DecisionProviderResult = {
      ...result,
      answer: { type: "score", score: 1.6 },
      rawScore: 1.6,
      rawProbabilities: { 0: 0.1, 1: 0.2, 2: 0.7 },
    };
    expect(validateDecisionProviderResult(request, output)).toEqual({ ok: true, result: output });
    expect(
      validateDecisionProviderResult(request, { ...output, answer: { type: "score", score: 3 } }),
    ).toMatchObject({ ok: false, failure: { error: "invalid_response" } });
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1, 1.1])(
    "rejects a non-finite or unbounded noul value: %s",
    (noul) => {
      expect(
        validateDecisionProviderResult(decisionContractRequest, {
          ...result,
          answer: { type: "noul", noul },
        }),
      ).toMatchObject({ ok: false, failure: { error: "invalid_response" } });
    },
  );

  test("rejects answer type drift, invented confidence, and provider-written authority fields", () => {
    for (const output of [
      { ...result, answer: { type: "score", score: 0.8 } },
      { ...result, confidence: 0.99 },
      { ...result, calibrated: true },
      { ...result, rawScore: Number.POSITIVE_INFINITY },
      { ...result, usage: { inputTokens: -1 } },
    ]) {
      expect(validateDecisionProviderResult(decisionContractRequest, output)).toMatchObject({
        ok: false,
        failure: { error: "invalid_response" },
      });
    }
  });

  test.each([
    { type: "choice", criteria: "合成问题", options: ["付款", "付款"] },
    { type: "score", criteria: "合成问题", options: [1] },
    { type: "noul", criteria: "   " },
  ] satisfies DecisionQuestion[])("rejects ambiguous controlled questions: %j", (question) => {
    expect(
      validateDecisionProviderResult({ ...decisionContractRequest, question }, result),
    ).toMatchObject({ ok: false, failure: { error: "invalid_request" } });
  });
});
