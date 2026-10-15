import type { DecisionProviderOutcome, DecisionRequest } from "@contract-audit/audit/decision";
import { decisionFailure, type DecisionProviderLike } from "./base";

/**
 * The provider used when the decision layer is switched off, and the one a
 * misconfiguration degrades to. It answers nothing, ever: there is no code
 * path here that could produce an advice, so "off" cannot silently become
 * "Fake".
 */
export class DisabledDecisionProvider implements DecisionProviderLike {
  readonly identity = { provider: "disabled" as const, modelVersion: "none" };

  async decide(
    _request: DecisionRequest,
    _signal: AbortSignal,
  ): Promise<DecisionProviderOutcome> {
    return { ok: false, failure: decisionFailure("disabled", false) };
  }
}
