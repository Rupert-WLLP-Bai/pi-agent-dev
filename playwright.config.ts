import type { Config } from "@playwright/test";

// Reuse already-running dev servers unless CI asks for a clean environment.
// PLAYWRIGHT_REUSE_SERVERS=1 forces reuse even when CI is set.
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_SERVERS === "1" || process.env.CI !== "true";

// Ports are overridable so acceptance can run against worktrees/branches in
// parallel with a dev server occupying the defaults (3000/5173).
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3000);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5173);

// A scratch database, when one is named, keeps a run from reading or leaving
// artifacts in the developer's demo data. The specs are not independent of what
// the database already holds: the party-history rule reads earlier cases, so a
// confirmed risk left behind by one run changes how many findings the next run's
// audit raises, and a case that used to complete starts awaiting review. CI gets
// this for free from a fresh service container; on a host, pass
// PLAYWRIGHT_DATABASE_URL. It is applied after .env is sourced, or .env would
// win.
const databaseOverride =
  process.env.PLAYWRIGHT_DATABASE_URL === undefined
    ? ""
    : `DATABASE_URL=${process.env.PLAYWRIGHT_DATABASE_URL} `;

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
      command: `set -a; [ -f .env ] && . ./.env; set +a; ${databaseOverride}API_PORT=${apiPort} AUDIT_AGENT_MODE=fake bun apps/api/src/app.ts`,
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
