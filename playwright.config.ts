import type { Config } from "playwright/test";

const config: Config = {
  testDir: "./tests",
  webServer: [
    {
      // FakeAuditAgent so acceptance tests pass without LLM credentials.
      command: "set -a; [ -f .env ] && . ./.env; set +a; AUDIT_AGENT_MODE=fake bun --filter @contract-audit/api dev",
      port: 3000,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "bun --filter @contract-audit/web dev",
      port: 5173,
      timeout: 30_000,
      reuseExistingServer: true,
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
  },
};

export default config;
