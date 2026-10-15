import type {
  DecisionProviderOutcome,
  DecisionProviderResult,
  DecisionRequest,
} from "@contract-audit/audit/decision";
import { validateDecisionProviderResult } from "@contract-audit/audit/decision-contract";
import { decisionFailure, type DecisionProviderLike } from "./base";

/**
 * The explicitly-labelled offline demonstration provider.
 *
 * It exists so the whole shadow path — persistence, worker, lease recovery,
 * feedback, retention, detail API — can be exercised without a model service,
 * and it is honest about what it is: the advice it returns carries
 * `provider: "fake"` and a deterministic model version, so no viewer, report
 * or evaluation can mistake it for a real inference. It never claims to be
 * Laya, and it never fabricates probabilities for a real model.
 *
 * The answer is derived from the question's own options by position, which
 * makes it deterministic and therefore testable: the same question and the
 * same masked excerpt always produce the same answer.
 */
export class FakeDecisionProvider implements DecisionProviderLike {
  readonly identity = { provider: "fake" as const, modelVersion: "fake-deterministic-v1" };

  async decide(
    request: DecisionRequest,
    _signal: AbortSignal,
  ): Promise<DecisionProviderOutcome> {
    const candidate = this.answerFor(request);
    const outcome = validateDecisionProviderResult(request, candidate);
    // A catalogue bug surfaces as a typed failure, never as an exception that
    // could take the shadow worker down with it.
    return outcome.ok
      ? outcome
      : { ok: false, failure: decisionFailure("invalid_response", false) };
  }

  private answerFor(request: DecisionRequest): DecisionProviderResult {
    const question = request.question;
    if (question.type === "choice") {
      const index = this.stableIndex(request, question.options.length);
      const choice = question.options[index];
      return {
        schemaVersion: 1,
        modelVersion: this.identity.modelVersion,
        answer: { type: "choice", choice },
        // Uniform: a demonstration provider has no information to concentrate,
        // so it reports a flat distribution rather than a confident-looking one.
        rawProbabilities: Object.fromEntries(
          question.options.map((option) => [option, 1 / question.options.length]),
        ),
        rawScore: null,
        // Confidence semantics are "none": the flat distribution above is not
        // a calibrated probability, and calling it one would be a lie.
        confidence: null,
        confidenceType: "none",
        usage: null,
      };
    }
    if (question.type === "score") {
      const index = this.stableIndex(request, question.options.length);
      return {
        schemaVersion: 1,
        modelVersion: this.identity.modelVersion,
        answer: { type: "score", score: question.options[index] },
        rawProbabilities: Object.fromEntries(
          question.options.map((option) => [String(option), 1 / question.options.length]),
        ),
        rawScore: question.options[index],
        confidence: null,
        confidenceType: "none",
        usage: null,
      };
    }
    // noul: the middle of the range, reported with no confidence at all.
    return {
      schemaVersion: 1,
      modelVersion: this.identity.modelVersion,
      answer: { type: "noul", noul: 0.5 },
      rawProbabilities: null,
      rawScore: 0.5,
      confidence: null,
      confidenceType: "none",
      usage: null,
    };
  }

  /**
   * A deterministic index derived from the frozen request, so the same input
   * always lands on the same option. This is a demonstration value, not a
   * judgement about the clause.
   */
  private stableIndex(request: DecisionRequest, optionCount: number): number {
    let hash = 0;
    const seed = `${request.questionKey}\u0000${request.maskedClauseExcerpt ?? ""}`;
    for (let position = 0; position < seed.length; position += 1) {
      hash = (hash * 31 + seed.charCodeAt(position)) | 0;
    }
    return Math.abs(hash) % optionCount;
  }
}
