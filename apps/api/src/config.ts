export interface ApiConfig {
  databaseUrl: string;
  /** Maximum wall-clock time for a single agent run, in milliseconds. 0 = no timeout. */
  agentTimeoutMs: number;
  maxConcurrentAudits: number;
  apiPort: number;
  webOrigin: string;
  /** "pi" runs the real agent; "fake" runs FakeAuditAgent for tests without credentials. */
  agentMode: "pi" | "fake";
  /** "fixture" uses deterministic test data; "qcc" calls the real Qichacha API. */
  subjectVerificationMode: "fixture" | "qcc";
  /** Hours from case creation before its review queue item is overdue. */
  reviewSlaHours: number;
  /** QCC MCP endpoint for company entity resolution. */
  qccCompanyEndpoint: string;
  /** QCC MCP endpoint for risk scanning. */
  qccRiskEndpoint: string;
  /** Bearer token for QCC MCP endpoints. */
  qccToken: string;
  /**
   * Whether the real agent's LLM credential is present. Only presence is
   * captured — the value stays in the pi-agent runtime, so no secret enters
   * the config object and `GET /api/health` can report it safely.
   */
  llmConfigured: boolean;
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Maximum accepted size for one uploaded contract file, in bytes. Large
 * uploads are rejected with 413 before the document is parsed.
 */
export const maxUploadBytes = parseInteger(process.env.MAX_UPLOAD_BYTES, 10_485_760);

export function loadApiConfig(): ApiConfig {
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit",
    // 15 min: a thinking-on dsv4 turn can burn the whole max_tokens budget
    // before the first tool call. Thinking-off is ~seconds per turn; keep a
    // generous ceiling so a slow gateway cannot fail a healthy 20-call audit.
    agentTimeoutMs: parseInteger(process.env.AGENT_TIMEOUT_MS, 900_000),
    maxConcurrentAudits: parseInteger(process.env.MAX_CONCURRENT_AUDITS, 1),
    apiPort: parseInteger(process.env.API_PORT, 3000),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    agentMode: process.env.AUDIT_AGENT_MODE === "fake" ? "fake" : "pi",
    subjectVerificationMode: process.env.SUBJECT_VERIFICATION_MODE === "qcc" ? "qcc" : "fixture",
    reviewSlaHours: parseInteger(process.env.REVIEW_SLA_HOURS, 24),
    qccCompanyEndpoint:
      process.env.QCC_COMPANY_ENDPOINT ?? "https://agent.qcc.com/mcp/company/stream",
    qccRiskEndpoint: process.env.QCC_RISK_ENDPOINT ?? "https://agent.qcc.com/mcp/risk/stream",
    qccToken: process.env.QCC_TOKEN ?? "",
    // The key is the credential; endpoint and model are non-secret settings.
    llmConfigured: Boolean(process.env.XYG_API_KEY),
  };
}
