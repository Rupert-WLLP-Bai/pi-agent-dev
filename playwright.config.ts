import type { Config } from "@playwright/test";

// Reuse already-running dev servers unless CI asks for a clean environment.
// PLAYWRIGHT_REUSE_SERVERS=1 forces reuse even when CI is set.
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_SERVERS === "1" || process.env.CI !== "true";

// Ports are overridable so acceptance can run against worktrees/branches in
// parallel with a dev server occupying the defaults (3000/5173).
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3000);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5173);

/**
 * A scratch database, when one is named, keeps a run from reading or leaving
 * artifacts in the developer's demo data. The specs are not independent of what
 * the database already holds: the party-history rule reads earlier cases, so a
 * confirmed risk left behind by one run changes how many findings the next run's
 * audit raises, and a case that used to complete starts awaiting review. CI gets
 * this for free from a fresh service container; on a host, pass
 * PLAYWRIGHT_DATABASE_URL.
 *
 * The value is handed to the API web server as an explicit `DATABASE_URL`
 * through Playwright's structured `env` option — it is **never** interpolated
 * into the command string. Interpolating a connection string into a shell
 * command would (a) put the URL, credentials included, into the process table
 * where any `ps` can read it, (b) put it into the layer command recorded in the
 * QA report and summary.html, and (c) break on any URL containing a shell
 * metacharacter. Playwright merges `env` over the inherited environment, so the
 * URL wins over whatever DATABASE_URL the developer's shell happens to export.
 *
 * `.env` is deliberately **not** sourced here. Sourcing it would let root
 * secrets (LLM keys, QCC tokens, S3 credentials) reach every process this
 * config starts, and would override the explicitly provided DATABASE_URL. The
 * acceptance run forces AUDIT_AGENT_MODE=fake instead and needs no real
 * secrets; anything else the API reads from the root environment (REDIS_URL,
 * S3_ENDPOINT) is inherited unmodified from the invoking session.
 */
const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL?.trim();

const config: Config = {
  testDir: "./tests",
  // The web server is Vite in dev mode, which compiles routes on first request.
  // Line for console + HTML for artifact upload. The CLI `--reporter` flag
  // overrides this entirely, so CI must not pass one.
  reporter: [
    // Line for console + HTML for artifact upload. The CLI `--reporter` flag
    // overrides this entirely, so CI must not pass one.
    ["line"],
    ["html", { open: "never" }],
    // Machine-readable requirement coverage: one record per spec, so the
    // traceability matrix can be regenerated from a real run rather than
    // hand-maintained.
    ["json", { outputFile: "artifacts/qa/e2e/results.json" }],
  ],
  expect: { timeout: 15_000 },
  // One worker, because the specs share one database and one rule catalog. The
  // rule-disable spec switches ADVANCE_PAYMENT_LIMIT off for the length of its
  // test; anything auditing the demo contract in another worker during that
  // window loses the finding it asserts on. `test.describe.serial` orders tests
  // within a file and cannot express that constraint across files. The suite is
  // ~1 minute either way, so the parallelism is not worth an intermittent
  // failure that looks like a product bug.
  workers: 1,
  webServer: [
    {
      // Run the API directly, not via the `--watch` dev script: a file watcher
      // restarts the server whenever test artifacts are written, which makes
      // the browser intermittently see an unavailable API.
      command: `bun apps/api/src/app.ts`,
      port: apiPort,
      timeout: 60_000,
      reuseExistingServer,
      // Structured, not interpolated: the connection string travels as an
      // environment value, so it never appears in the command line, the process
      // table, or any log that records the command. `DATABASE_URL` here
      // overrides an inherited value with the same name.
      env: {
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        API_PORT: String(apiPort),
        AUDIT_AGENT_MODE: "fake",
      },
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
