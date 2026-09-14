import type { RuleDisposition } from "./model";

export type RemediationClosureHint = "implemented" | "open" | "unknown";

/**
 * Maps a later Rule Assessment disposition to a remediation closure hint.
 * Hints are advisory only — closing still requires a non-owner reviewer.
 */
export function closureHintFromDisposition(disposition: RuleDisposition): RemediationClosureHint {
  if (disposition === "COMPLIANT") return "implemented";
  if (disposition === "POLICY_CONFLICT") return "open";
  return "unknown";
}
