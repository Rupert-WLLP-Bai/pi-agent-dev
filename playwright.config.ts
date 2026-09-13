import type { Config } from "@playwright/test";

// Reuse already-running dev servers unless CI asks for a clean environment.
// PLAYWRIGHT_REUSE_SERVERS=1 forces reuse even when CI is set.
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_SERVERS === "1" || process.env.CI !== "true";

// Ports are overridable so acceptance can run against worktrees/branches in
// parallel with a dev server occupying the defaults (3000/5173).
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3000);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5173);

const config: Config = {
  testDir: "./tests",
  // The web server is Vite in dev mode, which compiles routes on first request.
  // Line for console + HTML for artifact upload. The CLI `--reporter` flag
  // overrides this entirely, so CI must not pass one.
  reporter: [["line"], ["html", { open: "never" }]],
  expect: { timeout: 15_000 },
  workers:
    process.env.CI === "true" && process.env.PLAYWRIGHT_REUSE_SERVERS !== "1" ? 4 : undefined,
  webServer: [
    {
      // Run the API directly, not via the `--watch` dev script: a file watcher
      // restarts the server whenever test artifacts are written, which makes
      // the browser intermittently see an unavailable API.
      command: `set -a; [ -f .env ] && . ./.env; set +a; API_PORT=${apiPort} AUDIT_AGENT_MODE=fake bun apps/api/src/app.ts`,
      port: apiPort,
      timeout: 60_000,
      reuseExistingServer,
    },
    {
      command: `API_PROXY_TARGET=http://localhost:${apiPort} bun --filter @contract-audit/web dev --port ${webPort}`,
      port: webPort,
      timeout: 60_000,
      reuseExistingServer,
    },
  ],
  use: {
    baseURL: `http://localhost:${webPort}`,
    // Set PLAYWRIGHT_CHANNEL=chrome to use a system-installed browser instead of
    // the bundled download (useful when the Playwright CDN is unreachable).
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
};

export default config;
