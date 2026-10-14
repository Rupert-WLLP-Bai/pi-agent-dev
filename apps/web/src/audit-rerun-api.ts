import { ApiRequestError, api } from "./api";

/**
 * What the server answers when a rerun is accepted. `sourceCaseId` names the
 * case the operator acted on; `id` is the fresh case the agent is about to run
 * on, and the client navigates there so the operator lands on the new audit
 * rather than watching the old one.
 */
export interface RerunAuditCaseResult {
  id: string;
  status: "PENDING";
  sourceCaseId: string;
}

/**
 * Re-audits a stopped case as a new case: same Source Record, same Contract
 * Revision, fresh snapshot and a fresh Agent Run under the current rules and
 * settings. The old case keeps its status, findings, reviews and remediations
 * untouched.
 *
 * Distinct from `retryAuditCase` (reuses the case, so its new findings would
 * land in already-reviewed work) and from `reassessAuditCase` (rebuilds the
 * snapshot in place on the same case).
 */
export async function rerunAuditCase(id: string): Promise<RerunAuditCaseResult> {
  const { data, error } = await api.api["audit-cases"]({ id }).rerun.post();
  if (error) {
    // A refused rerun is a business answer, not a transport failure: carry the
    // status so the caller can tell "still running" from "already active".
    throw new ApiRequestError("重新审计失败", error.status);
  }
  return data as RerunAuditCaseResult;
}
