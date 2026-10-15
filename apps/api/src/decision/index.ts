/**
 * Public surface of the shadow decision layer, for the API composition root.
 *
 * Main wires this module into `apps/api/src/app.ts`; nothing here reaches into
 * formal audit state. The exports are deliberately few: a provider factory, a
 * worker factory, a repository, a derivation function and the route factory's
 * dependencies.
 */

export { loadDecisionConfig, type DecisionConfig } from "./config";
export {
  DECISION_QUESTION_CATALOGUE_VERSION,
  decisionQuestionCatalogue,
  decisionQuestionFor,
  type DecisionQuestionEntry,
} from "./questions";
export {
  adviceEvidenceRefs,
  buildDecisionModelState,
  decisionInputHash,
  redactClauseExcerpt,
  REDACTION_VERSION,
  type DecisionModelState,
} from "./redaction";
export {
  classificationFor,
  deriveShadowJob,
  modelVersionFor,
  shadowQuestionFor,
  type ShadowDerivationInput,
} from "./derive";
export {
  DECISION_POLICY_VERSION,
  decisionFailure,
  PROVIDER_DATA_CLASSIFICATION,
  type DecisionProviderConfig,
  type DecisionProviderLike,
} from "./providers/base";
export { DisabledDecisionProvider } from "./providers/disabled";
export { FakeDecisionProvider } from "./providers/fake";
export { LayaCpuDecisionProvider } from "./providers/laya-cpu";
export {
  ShadowDecisionRepository,
  ruleConflictsFor,
  toDecisionAdvice,
  toDecisionFeedback,
  type ShadowFeedbackRecord,
  type ShadowJobClaim,
  type ShadowJobIdentity,
  type ShadowJobStore,
} from "./shadow-repository";
export { ShadowDecisionWorker, type ShadowJobOutcome, type ShadowWorkerDeps } from "./shadow-worker";
export { decisionsRoutes, type DecisionsRouteDeps } from "../routes/decisions";

import type { DecisionProviderName } from "@contract-audit/audit/decision";
import { FakeDecisionProvider } from "./providers/fake";
import { LayaCpuDecisionProvider } from "./providers/laya-cpu";
import { DisabledDecisionProvider } from "./providers/disabled";
import type { DecisionConfig } from "./config";
import type { DecisionProviderLike } from "./providers/base";

/**
 * Resolves the configured provider. An unconfigured or unknown provider is
 * the disabled one, so a misconfiguration degrades to "answers nothing"
 * rather than to a provider nobody asked for.
 */
export const createDecisionProvider = (config: DecisionConfig): DecisionProviderLike => {
  const name: DecisionProviderName = config.decisionProvider;
  if (name === "fake") return new FakeDecisionProvider();
  if (name === "laya-cpu") {
    return new LayaCpuDecisionProvider({
      endpoint: config.decisionEndpoint,
      allowedOrigins: config.decisionAllowedOrigins,
      model: config.decisionModel,
      timeoutMs: config.decisionTimeoutMs,
      modelRevision: config.decisionModelRevision,
      codeRevision: config.decisionCodeRevision,
    });
  }
  return new DisabledDecisionProvider();
};
