import type { Config } from "@playwright/test";

// Reuse already-running dev servers unless CI asks for a clean environment.
// PLAYWRIGHT_REUSE_SERVERS=1 forces reuse even when CI is set.
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_SERVERS === "1" || process.env.CI !== "true";

const config: Config = {
  testDir: "./tests",
  // The web server is Vite in dev mode, which compiles routes on first request.
  // Generous per-assertion timeouts keep parallel runs deterministic.
  expect: { timeout: 15_000 },
  workers: process.env.CI === "true" && process.env.PLAYWRIGHT_REUSE_SERVERS !== "1" ? 4 : undefined,
  webServer: [
    {
      // Run the API directly, not via the `--watch` dev script: a file watcher
      // restarts the server whenever test artifacts are written, which makes
      // the browser intermittently see an unavailable API.
      command:
        "set -a; [ -f .env ] && . ./.env; set +a; AUDIT_AGENT_MODE=fake bun apps/api/src/app.ts",
      port: 3000,
      timeout: 60_000,
      reuseExistingServer,
    },
    {
      command: "bun --filter @contract-audit/web dev",
      port: 5173,
      timeout: 60_000,
      reuseExistingServer,
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
    // Set PLAYWRIGHT_CHANNEL=chrome to use a system-installed browser instead of
    // the bundled download (useful when the Playwright CDN is unreachable).
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
};

export default config;
