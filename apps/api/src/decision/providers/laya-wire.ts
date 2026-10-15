/**
 * The `/v1/systemone` wire response, as the pinned Laya service emits it.
 *
 * This module is a projection boundary, not a second contract: the parsed
 * shape here carries only the fields the canonical provider result needs, and
 * the authoritative validation still happens in
 * `validateDecisionProviderResult` (TypeBox, in `@contract-audit/audit`).
 * Fields the service adds beyond these (`routing`, `action`,
 * `answer_confidence`, `x_jev_confidence`) are never read, so they cannot
 * reach an advice — an unknown wire field is dropped by construction rather
 * than filtered later.
 *
 * `typebox` is a dependency of the audit package, not of the API app, so this
 * boundary is narrowed by hand and the canonical validator does the strict
 * checking.
 */

/** A wire answer as the Jev-compatible protocol carries it. */
export interface LayaWireAnswer {
  type: "choice" | "score" | "noul";
  /** choice only. */
  choice?: string;
  /** score and noul only. */
  score?: number;
  noul?: number;
  /** choice and score only; absent on a strict noul answer. */
  confidence?: number;
  /** choice and score only. */
  probabilities?: Record<string, number>;
}

export interface LayaWireResponse {
  model: string;
  answers: Record<string, LayaWireAnswer>;
  usage: { input_tokens: number; output_tokens: number } | null;
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const numberRecord = (value: unknown): value is Record<string, number> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  for (const entry of Object.values(value)) {
    if (!finiteNumber(entry)) return false;
  }
  return true;
};

/** Narrows one wire answer, or null when it does not carry a usable shape. */
const parseAnswer = (value: unknown): LayaWireAnswer | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("type" in value)) return null;
  const { type } = value;
  if (type !== "choice" && type !== "score" && type !== "noul") return null;
  const answer: LayaWireAnswer = { type };
  if ("choice" in value && typeof value.choice === "string") answer.choice = value.choice;
  if ("score" in value && finiteNumber(value.score)) answer.score = value.score;
  if ("noul" in value && finiteNumber(value.noul)) answer.noul = value.noul;
  if ("confidence" in value && finiteNumber(value.confidence)) answer.confidence = value.confidence;
  if ("probabilities" in value && numberRecord(value.probabilities)) {
    answer.probabilities = value.probabilities;
  }
  return answer;
};

/**
 * Parses a service response, or null when it does not match the wire shape.
 * A malformed distribution, a missing `answers` map or a non-string model are
 * all refusals here, so the adapter answers `invalid_response` rather than
 * passing something unvalidated downstream.
 */
export const parseLayaSystemOneResponse = (body: unknown): LayaWireResponse | null => {
  if (typeof body !== "object" || body === null) return null;
  if (!("model" in body) || typeof body.model !== "string" || body.model === "") return null;
  if (!("answers" in body) || typeof body.answers !== "object" || body.answers === null) return null;
  if (Array.isArray(body.answers)) return null;

  const answers: Record<string, LayaWireAnswer> = {};
  for (const [key, value] of Object.entries(body.answers)) {
    const answer = parseAnswer(value);
    if (answer === null) return null;
    answers[key] = answer;
  }

  let usage: LayaWireResponse["usage"] = null;
  if ("usage" in body && typeof body.usage === "object" && body.usage !== null) {
    if (
      "input_tokens" in body.usage &&
      finiteNumber(body.usage.input_tokens) &&
      "output_tokens" in body.usage &&
      finiteNumber(body.usage.output_tokens)
    ) {
      usage = { input_tokens: body.usage.input_tokens, output_tokens: body.usage.output_tokens };
    }
  }

  return { model: body.model, answers, usage };
};
