export interface ApiConfig {
  databaseUrl: string;
  maxConcurrentAudits: number;
  apiPort: number;
  webOrigin: string;
  /** "pi" runs the real agent; "fake" runs FakeAuditAgent for tests without credentials. */
  agentMode: "pi" | "fake";
  /** "fixture" uses deterministic test data; "qcc" calls the real Qichacha API. */
  subjectVerificationMode: "fixture" | "qcc";
  /** QCC MCP endpoint for company entity resolution. */
  qccCompanyEndpoint: string;
  /** QCC MCP endpoint for risk scanning. */
  qccRiskEndpoint: string;
  /** Bearer token for QCC MCP endpoints. */
  qccToken: string;
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function loadApiConfig(): ApiConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit",
    maxConcurrentAudits: parseInteger(process.env.MAX_CONCURRENT_AUDITS, 1),
    apiPort: parseInteger(process.env.API_PORT, 3000),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    agentMode: process.env.AUDIT_AGENT_MODE === "fake" ? "fake" : "pi",
    subjectVerificationMode: process.env.SUBJECT_VERIFICATION_MODE === "qcc" ? "qcc" : "fixture",
    qccCompanyEndpoint: process.env.QCC_COMPANY_ENDPOINT ?? "https://agent.qcc.com/mcp/company/stream",
    qccRiskEndpoint: process.env.QCC_RISK_ENDPOINT ?? "https://agent.qcc.com/mcp/risk/stream",
    qccToken: process.env.QCC_TOKEN ?? "",
  };
}
