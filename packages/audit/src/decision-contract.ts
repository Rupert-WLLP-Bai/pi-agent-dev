import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  DECISION_SCHEMA_VERSION,
  type DecisionErrorCode,
  type DecisionProviderOutcome,
  type DecisionRequest,
} from "./decision";

export const DecisionSchemaVersion = Type.Object({ schemaVersion: Type.Literal(1) });

export const DecisionQuestionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("choice"),
    criteria: Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" }),
    options: Type.Array(Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }), {
      minItems: 2,
      maxItems: 16,
      uniqueItems: true,
    }),
  }),
  Type.Object({
    type: Type.Literal("score"),
    criteria: Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" }),
    options: Type.Array(Type.Number(), { minItems: 2, maxItems: 16, uniqueItems: true }),
  }),
  Type.Object({
    type: Type.Literal("noul"),
    criteria: Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" }),
  }),
]);

export const DecisionProviderResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(DECISION_SCHEMA_VERSION),
    modelVersion: Type.String({ minLength: 1, maxLength: 256, pattern: "\\S" }),
    answer: Type.Union([
      Type.Object({ type: Type.Literal("choice"), choice: Type.String() }),
      Type.Object({ type: Type.Literal("score"), score: Type.Number() }),
      Type.Object({
        type: Type.Literal("noul"),
        noul: Type.Number({ minimum: 0, maximum: 1 }),
      }),
    ]),
    rawProbabilities: Type.Union([
      Type.Null(),
      Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 })),
    ]),
    rawScore: Type.Union([Type.Null(), Type.Number()]),
    confidence: Type.Union([Type.Null(), Type.Number({ minimum: 0, maximum: 1 })]),
    confidenceType: Type.Union([
      Type.Literal("none"),
      Type.Literal("laya_entropy_concentration"),
      Type.Literal("answer_confidence"),
    ]),
    usage: Type.Union([Type.Null(), Type.Record(Type.String(), Type.Number({ minimum: 0 }))]),
  },
  { additionalProperties: false },
);

const failure = (error: DecisionErrorCode): DecisionProviderOutcome => ({
  ok: false,
  failure: { schemaVersion: DECISION_SCHEMA_VERSION, error, retryable: false },
});

/** Parse the named boundary schema once, then enforce question/answer invariants. */
export function validateDecisionProviderResult(
  request: DecisionRequest,
  candidate: unknown,
): DecisionProviderOutcome {
  if (
    !Value.Check(DecisionSchemaVersion, request) ||
    !Value.Check(DecisionSchemaVersion, candidate)
  ) {
    return failure("unsupported_schema");
  }
  if (!Value.Check(DecisionQuestionSchema, request.question)) return failure("invalid_request");
  if (!Value.Check(DecisionProviderResultSchema, candidate)) return failure("invalid_response");

  const question = request.question;
  const answer = candidate.answer;
  if (answer.type !== question.type) return failure("invalid_response");
  if (question.type === "choice" && answer.type === "choice") {
    if (!question.options.includes(answer.choice)) return failure("invalid_response");
  }
  if (question.type === "score" && answer.type === "score") {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const option of question.options) {
      minimum = Math.min(minimum, option);
      maximum = Math.max(maximum, option);
    }
    // A score can be an expected value between options, not just an option's value.
    if (answer.score < minimum || answer.score > maximum) return failure("invalid_response");
  }

  const probabilities = candidate.rawProbabilities;
  if (question.type === "noul") {
    if (probabilities !== null) return failure("invalid_response");
  } else {
    if (probabilities === null) return failure("invalid_response");
    const keys = Object.keys(probabilities);
    if (
      keys.length !== question.options.length ||
      !question.options.every((option) => Object.hasOwn(probabilities, String(option)))
    ) {
      return failure("invalid_response");
    }
    let sum = 0;
    for (const key of keys) sum += probabilities[key];
    // Accommodate provider rounding without normalizing malformed distributions.
    if (Math.abs(sum - 1) > 0.001) return failure("invalid_response");
  }
  if (
    (candidate.confidenceType === "none" && candidate.confidence !== null) ||
    (candidate.confidenceType !== "none" && candidate.confidence === null)
  ) {
    return failure("invalid_response");
  }
  return { ok: true, result: candidate };
}
