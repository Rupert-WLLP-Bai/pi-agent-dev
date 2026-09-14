import type { RuleDisposition } from "./model";

export type RemediationClosureHint = "implemented" | "open" | "unknown";

/**
 * Maps a later Rule Assessment disposition to a remediation closure hint.
 * Hints are advisory only — closing still requires a non-owner reviewer.
 */
export function closureHintFromDisposition(disposition: RuleDisposition): RemediationClosureHint {
  if (disposition === "COMPLIANT") return "implemented";
  if (disposition === "POLICY_CONFLICT") return "open";
  // A rule that no longer applies did not verify the remediation; only a
  // re-assessment that actually ran can say whether the fix landed.
  return "unknown";
}
