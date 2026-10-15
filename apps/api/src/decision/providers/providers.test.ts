import { describe, expect, test } from "bun:test";
import type { DecisionRequest } from "@contract-audit/audit/decision";
import { DisabledDecisionProvider } from "./disabled";
import { FakeDecisionProvider } from "./fake";

const request = (question: DecisionRequest["question"]): DecisionRequest => ({
  schemaVersion: 1,
  auditCaseId: "00000000-0000-4000-8000-000000000001",
  snapshotId: "00000000-0000-4000-8000-000000000002",
  agentRunId: "00000000-0000-4000-8000-000000000003",
  contractDocumentHash: "hash",
  taskType: "clause_category",
  questionKey: "clause-category",
  question,
  questionVersion: "v1",
  policyVersion: "p1",
  redactionVersion: "r1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: "甲方应在合同签订后十个工作日内支付预付款。",
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: "trace",
});

const signal = (): AbortSignal => new AbortController().signal;

describe("DisabledDecisionProvider", () => {
  test("never produces an answer", async () => {
    const outcome = await new DisabledDecisionProvider().decide(
      request({ type: "noul", criteria: "是否需要复核？" }),
      signal(),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("disabled");
  });
});

describe("FakeDecisionProvider", () => {
  const provider = new FakeDecisionProvider();

  test("identifies itself as fake, never as a real model", () => {
    expect(provider.identity.provider).toBe("fake");
    expect(provider.identity.modelVersion).toContain("fake");
  });

  test("answers a choice question with a catalogue option and a flat distribution", async () => {
    const outcome = await provider.decide(
      request({
        type: "choice",
        criteria: "条款类型？",
        options: ["payment", "dispute"],
      }),
      signal(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.answer.type).toBe("choice");
    if (outcome.result.answer.type !== "choice") return;
    expect(["payment", "dispute"]).toContain(outcome.result.answer.choice);
    const probabilities = outcome.result.rawProbabilities ?? {};
    expect(Object.keys(probabilities).sort()).toEqual(["dispute", "payment"]);
    for (const value of Object.values(probabilities)) expect(value).toBeCloseTo(0.5, 5);
  });

  test("answers a score question inside the option range", async () => {
    const outcome = await provider.decide(
      request({ type: "score", criteria: "复核级别？", options: [0, 1, 2] }),
      signal(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    if (outcome.result.answer.type !== "score") throw new Error("expected score");
    expect([0, 1, 2]).toContain(outcome.result.answer.score);
  });

  test("answers a noul question with no probabilities and no confidence", async () => {
    const outcome = await provider.decide(
      request({ type: "noul", criteria: "是否超过上限？" }),
      signal(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.answer).toEqual({ type: "noul", noul: 0.5 });
    expect(outcome.result.rawProbabilities).toBeNull();
    expect(outcome.result.confidence).toBeNull();
    expect(outcome.result.confidenceType).toBe("none");
  });

  test("is deterministic for the same input", async () => {
    const question = {
      type: "choice" as const,
      criteria: "条款类型？",
      options: ["payment", "dispute", "amount"],
    };
    const first = await provider.decide(request(question), signal());
    const second = await provider.decide(request(question), signal());
    expect(first).toEqual(second);
  });

  test("never claims a calibrated confidence", async () => {
    const outcome = await provider.decide(
      request({ type: "choice", criteria: "条款类型？", options: ["a", "b"] }),
      signal(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.confidence).toBeNull();
    expect(outcome.result.confidenceType).toBe("none");
  });
});
