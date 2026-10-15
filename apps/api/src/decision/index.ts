/**
 * Public surface of the shadow decision layer, for the API composition root.
 *
 * Main wires this module into `apps/api/src/app.ts`; nothing here reaches into
 * formal audit state. The exports are deliberately few: a provider factory, a
 * worker factory, a repository, a derivation function and the route factory's
 * dependencies.
 */

export { type DecisionsRouteDeps, decisionsRoutes } from "../routes/decisions";
export { type DecisionConfig, loadDecisionConfig } from "./config";
export {
  classificationFor,
  deriveShadowJob,
  modelVersionFor,
  type ShadowDerivationInput,
  shadowQuestionFor,
} from "./derive";
export {
  DECISION_POLICY_VERSION,
  type DecisionProviderConfig,
  type DecisionProviderLike,
  decisionFailure,
  PROVIDER_DATA_CLASSIFICATION,
} from "./providers/base";
export { DisabledDecisionProvider } from "./providers/disabled";
export { FakeDecisionProvider } from "./providers/fake";
export { LayaCpuDecisionProvider } from "./providers/laya-cpu";
export {
  DECISION_QUESTION_CATALOGUE_VERSION,
  type DecisionQuestionEntry,
  decisionQuestionCatalogue,
  decisionQuestionFor,
} from "./questions";
export {
  adviceEvidenceRefs,
  buildDecisionModelState,
  type DecisionModelState,
  decisionInputHash,
  REDACTION_VERSION,
  redactClauseExcerpt,
} from "./redaction";
export {
  ruleConflictsFor,
  ShadowDecisionRepository,
  type ShadowFeedbackRecord,
  type ShadowJobClaim,
  type ShadowJobIdentity,
  type ShadowJobStore,
  toDecisionAdvice,
  toDecisionFeedback,
} from "./shadow-repository";
export {
  ShadowDecisionWorker,
  type ShadowJobOutcome,
  type ShadowWorkerDeps,
} from "./shadow-worker";

import type { DecisionProviderName } from "@contract-audit/audit/decision";
import type { DecisionConfig } from "./config";
import type { DecisionProviderLike } from "./providers/base";
import { DisabledDecisionProvider } from "./providers/disabled";
import { FakeDecisionProvider } from "./providers/fake";
import { LayaCpuDecisionProvider } from "./providers/laya-cpu";

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
