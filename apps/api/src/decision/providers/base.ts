import type {
  DecisionDataClassification,
  DecisionFailure,
  DecisionProviderName,
  DecisionProviderOutcome,
  DecisionRequest,
} from "@contract-audit/audit/decision";

/**
 * The configuration a provider is built from. Everything here comes from the
 * server's own environment, never from a request: an endpoint, an allowed
 * origin list or a model revision is a deployment decision, and a caller must
 * not be able to redirect inference anywhere.
 */
export interface DecisionProviderConfig {
  /** Base URL of the local decision service; empty when unconfigured. */
  endpoint: string;
  /** Origins permitted for the endpoint; empty permits none. */
  allowedOrigins: readonly string[];
  /** Model name the service should run; the catalogue's default when empty. */
  model: string;
  /** Wall-clock budget per inference, in milliseconds. */
  timeoutMs: number;
  /** Pinned model revision, recorded on every advice. */
  modelRevision: string;
  /** Pinned service code revision, recorded on every advice. */
  codeRevision: string;
}

/** The seam the shadow worker depends on, so tests can substitute a provider. */
export interface DecisionProviderLike {
  readonly identity: { provider: DecisionProviderName; modelVersion: string };
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionProviderOutcome>;
}

/** The version recorded by every provider that does not run a model. */
export const DECISION_POLICY_VERSION = "decision-policy-v1";

/** Builds a typed failure with the schema version already attached. */
export const decisionFailure = (
  error: DecisionFailure["error"],
  retryable: boolean,
): DecisionFailure => ({ schemaVersion: 1, error, retryable });

/** A classification no provider ever derives from the request it was handed. */
export const PROVIDER_DATA_CLASSIFICATION: DecisionDataClassification = "SYNTHETIC";
