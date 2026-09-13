import type { RemediationStatus } from "./model";

/**
 * Remediation lifecycle: three forward columns, then a reviewer-confirmed close.
 *
 * The order is the contract. A card may sit in any column, but it can only be
 * advanced one step at a time, and `closed` is reachable only through the
 * dedicated close action — never by advancing. Keeping the machine here, in the
 * domain package, is what stops the API's guard and the web board's button
 * state from drifting into two different opinions about what comes next.
 */
export const remediationStatusOrder: readonly RemediationStatus[] = [
  "pending",
  "in_progress",
  "awaiting_review",
  "closed",
];

/** The single status a card may advance to, or null when it cannot advance. */
export function nextRemediationStatus(status: RemediationStatus): RemediationStatus | null {
  if (status === "pending") return "in_progress";
  if (status === "in_progress") return "awaiting_review";
  return null;
}

/** True when `to` is exactly the one legal next step from `from`. */
export function canAdvanceRemediation(from: RemediationStatus, to: RemediationStatus): boolean {
  return nextRemediationStatus(from) === to;
}
