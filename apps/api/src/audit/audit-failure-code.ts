/** Maps internal failures to stable SSE / client error codes without leaking details. */
export function auditFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "MODEL_DATA_OUTBOUND_FORBIDDEN") return "MODEL_DATA_OUTBOUND_FORBIDDEN";
  if (
    message === "MODEL_DATA_DESTINATION_INVALID" ||
    message === "LLM_INTERNAL_DATA_ORIGINS_INVALID"
  ) {
    return "MODEL_DATA_DESTINATION_INVALID";
  }
  if (message.includes("AGENT_TIMEOUT") || message.includes("abort")) return "AGENT_TIMEOUT";
  if (message.includes("AGENT_RUN_MISSING_RESULT")) return "AGENT_RUN_FAILED";
  if (message.includes("UNREACHABLE") || message.includes("fetch failed")) return "LLM_UNREACHABLE";
  if (message.includes("ProposalGuard")) return "FINDING_REJECTED";
  return "AUDIT_FAILED";
}
