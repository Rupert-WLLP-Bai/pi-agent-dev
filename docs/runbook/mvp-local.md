# Local Verification Runbook

## Prerequisites

- Bun 1.3.14
- Docker (OrbStack or Docker Desktop)
- Node.js 24+ (for Playwright)

## Steps

1. Copy environment template:
   ```bash
   cp .env.example .env
   # Fill in LLM config (XYG_ENDPOINT, XYG_API_KEY, XYG_MODEL) here, or leave it
   # empty and configure a provider on the 模型服务 page (/settings/providers).
   ```

2. Start local infrastructure:
   ```bash
   docker compose up -d postgres rustfs redis rustfs-init
   ```
   RustFS and Redis are optional: with `S3_ENDPOINT` / `REDIS_URL` left empty,
   contract originals go to the local `UPLOAD_DIR` directory and subject
   verification is uncached. That is the normal local state, not an error.

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

## Run the Stack

**development** — infrastructure in containers, application host-native (hot reload):

```bash
docker compose up -d postgres rustfs redis rustfs-init
bun --filter @contract-audit/api dev    # host-native API, :3000
bun --filter @contract-audit/web dev    # Vite :5173, proxies /api to :3000
```

**demo** — the whole stack built into containers:

```bash
docker compose up --build
# open http://localhost:8080
docker compose exec api bun run seed:demo   # demo seed is not run automatically
```

The API container applies migrations on boot, and `AUDIT_AGENT_MODE` defaults to
`fake` in the container, so the demo needs no LLM credentials.

Service ports:

| Service | Port |
| --- | --- |
| postgres | 5432 |
| rustfs | 9000 (S3 API) / 9001 (console) |
| redis | 6379 |
| api | 3000 |
| web | 8080 |

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

## Pages

Entry points in the workbench:

- `/dashboard` — audit cockpit (the `/` route redirects here)
- `/audit-cases`, `/audit-cases/:id` — audit queue and decision-first workbench
- `/reviews` — review center, `/remediations` — remediation board
- `/rules`, `/cases` — rule governance and case validation
- `/verification`, `/integrations` — external verification and integration health
- `/settings/providers` — 模型服务 (sidebar group 系统管理): manage OpenAI-compatible LLM providers
- `/api/openapi` — the API reference (Elysia OpenAPI/Scalar). It sits under the
  `/api` prefix so the same URL works directly on :3000, through the Vite proxy
  on :5173 and through the nginx proxy on :8080; `/api/openapi/json` is the raw
  specification. The Scalar renderer itself is loaded from a CDN, so the page
  needs network access — the JSON endpoint does not.

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

The `XYG_*` environment path holds its API key in process memory only; it is
never written to disk, logged, or returned by the API. A provider added through
the 模型服务 page (`/settings/providers`) does persist its key in the PostgreSQL
`llm_providers` table — that is the cost of adding and editing providers at
runtime. For both paths the key is never returned by any API response (the API
reports presence plus a masked hint only), never logged, and never reaches the
browser.
