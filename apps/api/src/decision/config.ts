import { clampInteger, parseNameList } from "../config";

/** Bounds the retention window: one day minimum, one year maximum. */
const parseRetentionDays = (value: string | undefined): number =>
  clampInteger(Number.parseInt(value ?? "", 10), 30, 1, 365);

const DECISION_MODEL_REVISION_DEFAULT = "1720e3e3357cfe1e281542e223f8273b0890ca34";
const DECISION_CODE_REVISION_DEFAULT = "432312b36714d8889eba405507b37eda25257d9c";

/** The shadow-decision settings, named so both config and callers cite one type. */
export interface DecisionConfig {
  decisionMode: "off" | "shadow";
  decisionProvider: "disabled" | "fake" | "laya-cpu";
  decisionEndpoint: string;
  decisionAllowedOrigins: readonly string[];
  decisionModel: string;
  decisionModelRevision: string;
  decisionCodeRevision: string;
  decisionTimeoutMs: number;
  decisionPollIntervalMs: number;
  decisionMaxRetries: number;
  decisionConcurrency: number;
  decisionLeaseMs: number;
  decisionRetentionDays: number;
}

/** Builds the shadow-decision settings from the environment. */
export const loadDecisionConfig = (): DecisionConfig => ({
  // Default off: a deployment that has not decided to run the shadow layer
  // never derives a job, never claims one and never calls a provider.
  decisionMode: process.env.DECISION_MODE === "shadow" ? "shadow" : "off",
  decisionProvider:
    process.env.DECISION_PROVIDER === "fake"
      ? "fake"
      : process.env.DECISION_PROVIDER === "laya-cpu"
        ? "laya-cpu"
        : "disabled",
  decisionEndpoint: process.env.DECISION_ENDPOINT ?? "",
  decisionAllowedOrigins: parseNameList(process.env.DECISION_ALLOWED_ORIGINS),
  decisionModel: process.env.DECISION_MODEL ?? "",
  decisionModelRevision:
    process.env.DECISION_MODEL_REVISION?.trim() || DECISION_MODEL_REVISION_DEFAULT,
  decisionCodeRevision:
    process.env.DECISION_CODE_REVISION?.trim() || DECISION_CODE_REVISION_DEFAULT,
  decisionTimeoutMs: clampInteger(
    Number.parseInt(process.env.DECISION_TIMEOUT_MS ?? "", 10),
    10_000,
    1,
  ),
  decisionPollIntervalMs: clampInteger(
    Number.parseInt(process.env.DECISION_POLL_INTERVAL_MS ?? "", 10),
    2_000,
    100,
  ),
  decisionMaxRetries: clampInteger(
    Number.parseInt(process.env.DECISION_MAX_RETRIES ?? "", 10),
    2,
    0,
    5,
  ),
  decisionConcurrency: clampInteger(
    Number.parseInt(process.env.DECISION_CONCURRENCY ?? "", 10),
    1,
    1,
    8,
  ),
  decisionLeaseMs: clampInteger(
    Number.parseInt(process.env.DECISION_LEASE_MS ?? "", 10),
    60_000,
    1_000,
  ),
  decisionRetentionDays: parseRetentionDays(process.env.DECISION_RETENTION_DAYS),
});
