import { describe, expect, test } from "bun:test";
import type { DecisionRequest } from "@contract-audit/audit/decision";
import { LayaCpuDecisionProvider } from "./laya-cpu";

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

const providerFor = (overrides: {
  endpoint: string;
  allowedOrigins: readonly string[];
  timeoutMs?: number;
}): LayaCpuDecisionProvider =>
  new LayaCpuDecisionProvider({
    endpoint: overrides.endpoint,
    allowedOrigins: overrides.allowedOrigins,
    model: "multilingual",
    timeoutMs: overrides.timeoutMs ?? 5_000,
    modelRevision: "1720e3e3357cfe1e281542e223f8273b0890ca34",
    codeRevision: "432312b36714d8889eba405507b37eda25257d9c",
  });

const choiceQuestion: DecisionRequest["question"] = {
  type: "choice",
  criteria: "条款类型？",
  options: ["payment", "dispute"],
};

describe("LayaCpuDecisionProvider origin policy", () => {
  test("refuses an unconfigured endpoint", async () => {
    const outcome = await providerFor({ endpoint: "", allowedOrigins: [] }).decide(
      request(choiceQuestion),
      new AbortController().signal,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("forbidden_outbound");
  });

  test("refuses an endpoint absent from the allowlist", async () => {
    const outcome = await providerFor({
      endpoint: "http://127.0.0.1:3847",
      allowedOrigins: ["http://localhost:9999"],
    }).decide(request(choiceQuestion), new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("forbidden_outbound");
  });

  test("refuses credentials in the endpoint", async () => {
    const outcome = await providerFor({
      endpoint: "http://user:pass@127.0.0.1:3847",
      allowedOrigins: ["http://127.0.0.1:3847"],
    }).decide(request(choiceQuestion), new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("forbidden_outbound");
  });

  test("refuses a fragment in the endpoint", async () => {
    const outcome = await providerFor({
      endpoint: "http://127.0.0.1:3847#fragment",
      allowedOrigins: ["http://127.0.0.1:3847"],
    }).decide(request(choiceQuestion), new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("forbidden_outbound");
  });

  test("refuses a non-http protocol", async () => {
    const outcome = await providerFor({
      endpoint: "ftp://127.0.0.1:3847",
      allowedOrigins: ["ftp://127.0.0.1:3847"],
    }).decide(request(choiceQuestion), new AbortController().signal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("forbidden_outbound");
  });

  test("permits a configured loopback origin", async () => {
    // The request is refused by the stubbed transport, not by the policy: that
    // is the proof the origin itself was accepted.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "server busy" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const outcome = await providerFor({
        endpoint: "http://127.0.0.1:3847/v1",
        allowedOrigins: ["http://127.0.0.1:3847"],
        timeoutMs: 2_000,
      }).decide(request(choiceQuestion), new AbortController().signal);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.failure.error).not.toBe("forbidden_outbound");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("LayaCpuDecisionProvider response projection", () => {
  /** Drives the private projection through a real loopback fetch. */
  const decideOverFetch = async (
    question: DecisionRequest["question"],
    responseBody: unknown,
    init?: { status?: number },
  ): Promise<
    | { ok: true; result: import("@contract-audit/audit/decision").DecisionProviderResult }
    | { ok: false; failure: { error: string; retryable: boolean } }
  > => {
    const originalFetch = globalThis.fetch;
    // A stand-in fetch, cast through `unknown` because the stub only implements
    // the call signature the adapter uses.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(responseBody), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      return await providerFor({
        endpoint: "http://127.0.0.1:3847",
        allowedOrigins: ["http://127.0.0.1:3847"],
      }).decide(request(question), new AbortController().signal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  test("projects a choice answer and drops unknown wire fields", async () => {
    const outcome = await decideOverFetch(choiceQuestion, {
      model: "laya-rl-agent",
      answers: {
        "clause-category": {
          type: "choice",
          choice: "payment",
          confidence: 0.9754,
          probabilities: { payment: 0.9976, dispute: 0.0024 },
          // Fields the strict protocol does not carry; they must not survive.
          answer_confidence: 0.5,
          action: { act_probability: 0.9 },
          routing: { model: "multilingual" },
        },
      },
      usage: { input_tokens: 247, output_tokens: 0 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.answer).toEqual({ type: "choice", choice: "payment" });
    expect(outcome.result.rawProbabilities).toEqual({ payment: 0.9976, dispute: 0.0024 });
    expect(outcome.result.confidenceType).toBe("laya_entropy_concentration");
    expect(outcome.result.usage).toEqual({ input_tokens: 247, output_tokens: 0 });
    expect(Object.keys(outcome.result)).not.toContain("routing");
  });

  test("projects a noul answer with no probabilities and no confidence", async () => {
    const outcome = await decideOverFetch({ type: "noul", criteria: "是否超过上限？" }, {
      model: "laya-rl-agent",
      answers: { "clause-category": { type: "noul", noul: 0.8963 } },
      usage: { input_tokens: 247, output_tokens: 0 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.answer).toEqual({ type: "noul", noul: 0.8963 });
    expect(outcome.result.rawProbabilities).toBeNull();
    expect(outcome.result.confidence).toBeNull();
    expect(outcome.result.confidenceType).toBe("none");
  });

  test("maps an ordinal score level back onto the canonical option scale", async () => {
    const outcome = await decideOverFetch({ type: "score", criteria: "复核级别？", options: [0, 1, 2] }, {
      model: "laya-rl-agent",
      answers: {
        "clause-category": {
          type: "score",
          score: 0.975,
          confidence: 0.482,
          probabilities: { "0": 0.0969, "1": 0.8312, "2": 0.0719 },
          legend: { "0": "无需复核", "1": "建议复核", "2": "优先复核" },
        },
      },
      usage: { input_tokens: 247, output_tokens: 0 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Level 1 (the argmax of the distribution) maps to option 1.
    expect(outcome.result.answer).toEqual({ type: "score", score: 1 });
  });

  test("refuses an answer whose type does not match the question", async () => {
    const outcome = await decideOverFetch(choiceQuestion, {
      model: "laya-rl-agent",
      answers: { "clause-category": { type: "noul", noul: 0.5 } },
      usage: null,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("invalid_response");
  });

  test("refuses a malformed distribution", async () => {
    const outcome = await decideOverFetch(choiceQuestion, {
      model: "laya-rl-agent",
      answers: {
        "clause-category": {
          type: "choice",
          choice: "payment",
          confidence: 0.5,
          probabilities: { payment: 0.5 },
        },
      },
      usage: null,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("invalid_response");
  });

  test("refuses a response that does not match the wire schema", async () => {
    const outcome = await decideOverFetch(choiceQuestion, { unexpected: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.error).toBe("invalid_response");
  });

  test("treats a 422 as a non-retryable refusal", async () => {
    const outcome = await decideOverFetch(
      choiceQuestion,
      { detail: "instructions missing" },
      { status: 422 },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.retryable).toBe(false);
  });

  test("treats a 503 as a retryable unavailability", async () => {
    const outcome = await decideOverFetch(
      choiceQuestion,
      { detail: "server busy" },
      { status: 503 },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.retryable).toBe(true);
  });
});
