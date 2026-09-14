/** Maps internal failures to stable SSE / client error codes without leaking details. */
export function auditFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AGENT_TIMEOUT") || message.includes("abort")) return "AGENT_TIMEOUT";
  if (message.includes("AGENT_RUN_MISSING_RESULT")) return "AGENT_RUN_FAILED";
  if (message.includes("UNREACHABLE") || message.includes("fetch failed")) return "LLM_UNREACHABLE";
  if (message.includes("ProposalGuard")) return "FINDING_REJECTED";
  return "AUDIT_FAILED";
}
