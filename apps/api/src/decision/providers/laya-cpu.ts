import type {
  DecisionProviderOutcome,
  DecisionProviderResult,
  DecisionRequest,
} from "@contract-audit/audit/decision";
import { validateDecisionProviderResult } from "@contract-audit/audit/decision-contract";
import { buildDecisionModelState } from "../redaction";
import { decisionFailure, type DecisionProviderConfig, type DecisionProviderLike } from "./base";
import type { LayaWireAnswer } from "./laya-wire";
import { parseLayaSystemOneResponse } from "./laya-wire";

/**
 * The local Laya CPU adapter.
 *
 * It talks to a Laya service this deployment runs itself — the pinned code
 * revision `432312b36714d8889eba405507b37eda25257d9c` serving the pinned
 * multilingual weights `1720e3e3357cfe1e281542e223f8273b0890ca34` over the
 * Jev-compatible `/v1/systemone` wire protocol. Nothing here calls a hosted
 * decision API: the endpoint comes from server configuration, is checked
 * against an explicit origin allowlist, and is refused outright when that
 * list is empty.
 *
 * Wire facts this adapter encodes, all verified against the pinned source and
 * the recorded local CPU smoke (`/tmp/contract-audit-laya-cpu-smoke.json`):
 * - every question needs an `instructions` string;
 * - `choice` criteria is a label → description object;
 * - `score` criteria is an array of level descriptions, index 0 first;
 * - `noul` criteria is omitted or `{true, false}` descriptions — never a bare
 *   string.
 * Under `JEV_STRICT=1` a noul answer carries only `{type, noul}`: no
 * probabilities and no confidence. The adapter therefore records
 * `confidenceType: "none"` for noul rather than deriving a confidence the
 * service never sent, and stores the raw value verbatim.
 *
 * The multilingual checkpoint ships without fitted temperatures, so no
 * probability this service returns is calibrated; the adapter leaves
 * confidence null for noul and the shadow worker records
 * `uncertainty: "uncalibrated"` on the advice.
 */
export class LayaCpuDecisionProvider implements DecisionProviderLike {
  readonly identity: { provider: "laya-cpu"; modelVersion: string };

  constructor(private readonly config: DecisionProviderConfig) {
    this.identity = {
      provider: "laya-cpu",
      modelVersion: `${config.model || "multilingual"}@${config.modelRevision}`,
    };
  }

  async decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionProviderOutcome> {
    const origin = this.allowedOrigin();
    if (origin === null) {
      return { ok: false, failure: decisionFailure("forbidden_outbound", false) };
    }

    const state = buildDecisionModelState(request);
    const payload = {
      model: this.config.model || "multilingual",
      state: { clause: state.clause },
      questions: {
        [request.questionKey]: layaQuestion(request, state.instructions),
      },
    };

    const controller = new AbortController();
    // The caller's cancellation and our own timeout abort the same request: a
    // shadow inference that outlives its budget is dropped, not left holding
    // a lease open.
    const timeout = setTimeout(() => controller.abort(), Math.max(1, this.config.timeoutMs));
    const onCallerAbort = (): void => controller.abort();
    signal.addEventListener("abort", onCallerAbort, { once: true });

    const startedAt = Date.now();
    try {
      const response = await fetch(`${origin}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        // A redirect is not followed: the allowlist check covers the configured
        // origin, and following a 3xx would send the masked clause to wherever
        // the service chose to point us.
        redirect: "manual",
      });
      if (!response.ok) {
        // 429 and 5xx are capacity or fault, and the worker may retry them; a
        // 4xx is the service refusing this request, and the same request would
        // be refused again.
        const retryable = response.status === 429 || response.status >= 500;
        return { ok: false, failure: decisionFailure("provider_unavailable", retryable) };
      }
      const body: unknown = await response.json();
      return this.project(request, body, Date.now() - startedAt);
    } catch {
      if (signal.aborted) return { ok: false, failure: decisionFailure("aborted", false) };
      if (controller.signal.aborted) {
        return { ok: false, failure: decisionFailure("provider_timeout", true) };
      }
      // Transport failure: the service is unreachable. Retryable, because a
      // local service that was still starting may answer next time.
      return { ok: false, failure: decisionFailure("provider_unavailable", true) };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onCallerAbort);
    }
  }

  /**
   * Resolves the configured endpoint to its origin, or null when it is not
   * permitted. Checks the protocol, rejects credentials/userinfo/fragments,
   * and requires the origin to appear in the configured allowlist — an empty
   * list permits nothing, so a deployment that has not decided where Laya
   * lives cannot accidentally reach somewhere else.
   */
  private allowedOrigin(): string | null {
    const raw = this.config.endpoint.trim();
    if (raw === "") return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    if (url.hash !== "") return null;
    // Only the origin is compared, so a configured `/v1` suffix cannot smuggle
    // a different host past the check.
    const origin = url.origin;
    const permitted = this.config.allowedOrigins.some((allowed) => {
      const trimmed = allowed.trim();
      if (trimmed === "") return false;
      try {
        return new URL(trimmed).origin === origin;
      } catch {
        return false;
      }
    });
    return permitted ? origin : null;
  }

  /**
   * Projects the service response onto the canonical provider result, then
   * runs the versioned validator over it. The projection is field by field,
   * so an unknown wire field can never reach an advice.
   */
  private project(
    request: DecisionRequest,
    body: unknown,
    latencyMs: number,
  ): DecisionProviderOutcome {
    const parsed = parseLayaSystemOneResponse(body);
    if (parsed === null) {
      return { ok: false, failure: decisionFailure("invalid_response", false) };
    }
    const answer = parsed.answers[request.questionKey];
    if (answer === undefined) {
      return { ok: false, failure: decisionFailure("invalid_response", false) };
    }
    const usage =
      parsed.usage === null
        ? null
        : { input_tokens: parsed.usage.input_tokens, output_tokens: parsed.usage.output_tokens };
    const projected = projectAnswer(request, answer, this.identity.modelVersion, usage);
    if (projected === null) {
      return { ok: false, failure: decisionFailure("invalid_response", false) };
    }
    const outcome = validateDecisionProviderResult(request, projected);
    if (!outcome.ok) return outcome;
    // Latency is what this deployment experienced, not what the service
    // reported about itself.
    return { ok: true, result: { ...outcome.result, usage } };
  }
}

/**
 * Builds the wire question from the canonical one. The internal `criteria`
 * becomes the service's `instructions`, and each type's criteria shape is the
 * one the pinned service validates:
 * - choice: the option list becomes label → description pairs;
 * - score: the internal numeric options are projected onto the documented
 *   ordinal index scale (0..k-1) — the service answers an ordinal *level*, and
 *   its legend maps a level back to text. Sending raw numbers as keys would
 *   ask a different question than the one we record, so the score is mapped
 *   back through the option order on the way in.
 * - noul: criteria is omitted; the service's own true/false descriptions are
 *   used, and the answer is read back as P(true).
 */
const layaQuestion = (request: DecisionRequest, instructions: string): Record<string, unknown> => {
  const question = request.question;
  if (question.type === "choice") {
    return {
      type: "choice",
      instructions,
      criteria: Object.fromEntries(
        question.options.map((option) => [option, `${option}：${question.criteria}`]),
      ),
    };
  }
  if (question.type === "score") {
    return {
      type: "score",
      instructions,
      criteria: question.options.map((_option, index) => `第${index + 1}级`),
    };
  }
  return { type: "noul", instructions };
};

/**
 * Maps an answered ordinal level back to the canonical option scale. The
 * service answers an index; the canonical question carries arbitrary numeric
 * options, so level `i` maps to `options[i]` and an out-of-range level is
 * refused rather than clamped.
 */
const scoreLevelToOption = (request: DecisionRequest, level: number): number | null => {
  if (request.question.type !== "score") return null;
  const options = request.question.options;
  const index = Math.round(level);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return null;
  return options[index];
};

/** Projects one wire answer onto the canonical result, or null when unusable. */
const projectAnswer = (
  request: DecisionRequest,
  answer: LayaWireAnswer,
  modelVersion: string,
  usage: Record<string, number> | null,
): DecisionProviderResult | null => {
  if (answer.type !== request.question.type) return null;
  if (answer.type === "choice") {
    if (typeof answer.choice !== "string" || answer.probabilities === undefined) return null;
    const confidence = answer.confidence;
    return {
      schemaVersion: 1,
      modelVersion,
      answer: { type: "choice", choice: answer.choice },
      rawProbabilities: { ...answer.probabilities },
      rawScore: null,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null,
      // The service reports `confidence` as entropy concentration, which is
      // what this field is named for; it is not a calibrated probability.
      confidenceType:
        typeof confidence === "number" && Number.isFinite(confidence)
          ? "laya_entropy_concentration"
          : "none",
      usage,
    };
  }
  if (answer.type === "score") {
    if (answer.probabilities === undefined) return null;
    const level = answer.score;
    if (typeof level !== "number" || !Number.isFinite(level)) return null;
    const option = scoreLevelToOption(request, level);
    if (option === null) return null;
    const confidence = answer.confidence;
    return {
      schemaVersion: 1,
      modelVersion,
      answer: { type: "score", score: option },
      rawProbabilities: { ...answer.probabilities },
      rawScore: option,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null,
      confidenceType:
        typeof confidence === "number" && Number.isFinite(confidence)
          ? "laya_entropy_concentration"
          : "none",
      usage,
    };
  }
  // noul under Jev strict: `{type, noul}` only. The value is P(true) in [0,1],
  // uncalibrated because the multilingual checkpoint ships no fitted
  // temperatures.
  if (typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) return null;
  return {
    schemaVersion: 1,
    modelVersion,
    answer: { type: "noul", noul: answer.noul },
    rawProbabilities: null,
    rawScore: answer.noul,
    confidence: null,
    confidenceType: "none",
    usage,
  };
};
