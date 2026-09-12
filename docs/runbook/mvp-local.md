# MVP Local Verification Runbook

## Prerequisites

- Bun 1.3.14
- Docker (OrbStack or Docker Desktop)
- Node.js 24+ (for Playwright)

## Steps

1. Copy environment template:
   ```bash
   cp .env.example .env
   # Edit .env to add XYG_ENDPOINT, XYG_API_KEY, XYG_MODEL
   ```

2. Start PostgreSQL:
   ```bash
   docker compose up -d postgres
   ```

3. Install dependencies:
   ```bash
   bun install
   ```

4. Apply database migration:
   ```bash
   cd apps/api && bunx drizzle-kit generate && bunx drizzle-kit migrate && cd ../..
   ```

5. Lint and format check:
   ```bash
   bun run lint
   ```

6. Type check (application code, then tests and build scripts):
   ```bash
   bun run typecheck
   ```

7. Run unit tests:
   ```bash
   bun test
   ```

8. Install Playwright browsers (first time only):
   ```bash
   bunx playwright install
   ```

9. Run acceptance tests (uses `FakeAuditAgent`, no LLM credentials needed):
   ```bash
   bunx playwright test
   ```

10. Build API Docker image (verifies `.env` and `.pi` are excluded):
    ```bash
    docker build -f apps/api/Dockerfile -t contract-audit-api .
    ```

## Manual Verification

Start the API and web dev servers in separate terminals:

```bash
# Terminal 1 — API (AUDIT_AGENT_MODE=pi by default; set "fake" to skip LLM credentials)
bun --filter @contract-audit/api dev

# Terminal 2 — Web
bun --filter @contract-audit/web dev
```

Or start both in the background with the helper script:

```bash
./scripts/dev-up.sh          # start API + web, wait until both ports answer
./scripts/dev-up.sh --status # show running PIDs
./scripts/dev-up.sh --stop   # stop both process groups
```

Logs land in `.dev/api.log` and `.dev/web.log`. The script refuses to start if
PostgreSQL is not reachable on `127.0.0.1:5432`.

Open http://localhost:5173/audit-cases to use the workbench.

## Acceptance Tests

`bun run acceptance` runs the Playwright suite. It starts the API in
`fake` agent mode, so no LLM credentials are needed.

- Already-running dev servers are reused; set `CI=true` (or
  `PLAYWRIGHT_REUSE_SERVERS=0`) to force a clean start.
- If the Playwright browser download is unreachable, install a system Chrome
  and run with `PLAYWRIGHT_CHANNEL=chrome`.

## Real Pi Agent Smoke Test

With reachable LLM credentials in `.env`, run one constrained agent turn end
to end (prints telemetry only — never the API key):

```bash
bun --filter @contract-audit/pi-agent run smoke
```

The API key is held in process memory only; it is never written to disk,
logged, or returned by the API.
