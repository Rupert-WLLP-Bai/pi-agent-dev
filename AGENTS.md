# Repository Guidelines

## Project Overview

Contract Audit is a traceable contract-audit workbench: deterministic rules evaluate contract facts, an embedded Pi agent proposes evidence-backed findings, and people review findings and track remediation. The competition topic is **合同智能审计工作台——基于五域协同与证据驱动的合同审查**, targeting legal, policy, financial, relationship, and external review. Treat contract generation, full archival workflows, and quantified business outcomes as goals to verify against implementation, not established capabilities. Continue the TypeScript prototype; Golang/Eino in the proposal describes a future stack, not this repository's runtime.

Read `CONTEXT.md` when changing domain concepts: Audit Case ≠ Agent Run, Fact ≠ Finding Proposal, Contract Stance ≠ Negotiation Stance. Use the current implementation to resolve conflicts with historical plans.

## Agent skills

### Issue tracker

Track work in GitHub Issues for `Rupert-WLLP-Bai/pi-agent-dev`.
Before reading or publishing tickets/specs, follow `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels.
Before classifying or relabelling issues, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context: shared root glossary and `docs/adr/`.
Before exploring domain code or proposing domain changes, read `docs/agents/domain.md`.

### Task management

Before adding a work package, changing task status, or rebuilding OMP TODO, read [TASK-BOARD](docs/project/TASK-BOARD.md), [task management](docs/project/task-management.md), and the current [HANDOFF](docs/project/HANDOFF.md). Persist every task and work-package mapping before switching the OMP execution view; the repository roadmap retains the full project scope.

## Architecture & Data Flow

Bun modular monolith: `packages/audit` owns transport-independent domain logic and ports; `packages/pi-agent` implements the agent port; `apps/api` composes HTTP, persistence, integrations, and execution; `apps/web` consumes the typed API.

Submission → persisted Source Record / Contract Revision / pending Audit Case → PostgreSQL queue claim → document parsing and immutable Audit Snapshot → deterministic assessments plus subject verification and party history → bounded Pi tools → validated Finding Proposals → append-only Finding Revisions → Human Review and remediation. REST carries reads/actions; SSE invalidates frontend query caches. Dossier amount-chain review is a separate stateless operation.

PostgreSQL queue claims use transactional `SKIP LOCKED`; dispatcher concurrency, cancellation, Pi sessions, and the SSE broker remain process-local. Multi-replica operation needs architectural changes. Retry reuses the snapshot and is limited to un-reviewed failures; reassessment captures current policy in a new snapshot on the same case; Audit Rerun opens a new case over the same Source Record and Contract Revision so a re-audit never rewrites reviewed work.

## Key Directories

- `packages/audit/src/`: models, ports, document IR, deterministic rules, proposal guard, golden validation cases.
- `packages/pi-agent/src/`: Pi runtime, bounded tools, trace collection, fake agent, and `payment-terms-audit.skill.md` agent instructions.
- `apps/api/src/`: `routes/` HTTP factories, `db/` Drizzle repositories, `audit/` snapshot assembly, `document/` parsing/storage/OCR, `qcc/` verification, `llm/` provider management, `testing/` reusable fakes.
- `apps/web/src/`: route screens, shared components, presentation helpers, typed API client, and SSE hooks.
- `apps/api/drizzle/`: committed SQL migrations and generated metadata; `tests/acceptance/`: browser workflows.
- `docs/adr/`, `docs/architecture/`, `docs/runbook/`: decisions and operations. `docs/superpowers/plans/`, `docs/research/`, and `scripts/research/` are historical/exploratory material, not proof of shipped behavior.

## Development Commands

Run from the repository root unless shown otherwise:

```bash
cp .env.example .env                    # Configure DATABASE_URL; use AUDIT_AGENT_MODE=fake without LLM credentials
bun install --frozen-lockfile
docker compose up -d postgres
(cd apps/api && bun run migrate)        # Apply committed migrations before host startup
bun run dev                            # API only, default :3000
bun --filter @contract-audit/web dev    # Separate terminal, default :5173
bun --filter @contract-audit/web build  # Vite production build; API executes TypeScript directly
bun run lint                           # Biome; lint:fix and format write changes
bun run typecheck                      # Application + test/config TypeScript passes
bun run test                           # Bun tests under packages/ and apps/
bun run verify                         # lint + typecheck + test
bun run acceptance                     # Playwright, separately from verify
bun run seed:demo
```

For schema changes: edit `apps/api/src/db/schema.ts`, then run `bun run generate`, `bun run check:migrations`, and `bun run migrate` from `apps/api`; commit SQL and metadata together. Exported `DATABASE_URL` takes precedence over root `.env` in Drizzle configuration. `docker compose up --build` serves the container UI on `:8080`. `scripts/dev-up.sh` targets fixed ports and terminates existing listeners on `3000/5173`.

## Code Conventions & Common Patterns

- Strict TypeScript/ES modules; Biome uses two spaces, 100 columns, double quotes, semicolons, trailing commas, and organized imports. Use kebab-case files, PascalCase components/classes, camelCase functions, and UPPER_SNAKE_CASE domain codes.
- Use relative imports inside a package and declared `@contract-audit/*` exports across packages. Add new shared modules to package exports. Prefer `import type`; frontend API types derive from `AuditApp` rather than duplicated DTOs.
- Inject dependencies through `createApp(deps)`, route factories, domain ports, and dispatcher construction. Reuse `apps/api/src/testing/fakes.ts` in isolated tests.
- Expected HTTP failures set explicit status and return `{ error }`; unexpected errors use the global handler. Preserve stable audit failure codes and client `ApiRequestError.status` handling.
- Propagate cancellation via `AbortSignal`, preserve timeout handling and session disposal, and flush serialized trace writes before completing a run.
- TanStack Query owns server state; SSE and mutations invalidate query keys. Use local React state for transient UI and validated router search parameters for URL state.
- Parsers emit raw blocks; `document-ir.ts` constructs stable IDs, hashes, and evidence offsets. Offsets count Unicode code points, not UTF-16 units.
- Deterministic assessments are authoritative. Extend `proposal-guard.ts` contracts, tool schemas, and golden cases together when adding rules/findings; preserve assessment ordering and `NOT_APPLICABLE` stance semantics. Prompts cannot authorize invalid proposals.
- Recognizer configuration (`apps/api/src/document/ocr/`) is persisted in one `ocr_settings` row, sealed with the same key crypto as LLM providers. A live `OcrPort` resolves the row per operation, so a settings save reaches the next parse and the health probe without a restart; parse one run under `capture()` so a document is never half-read under two different recognizers. The `OCR_*` environment variables are bootstrap only until a row exists.
- Preserve immutable snapshots/published rule parameters and append-only finding history. Human acceptance creates remediation transactionally. Evidence must identify a source and bounded location; model prose and confidence are not evidence.

## Important Files

- `apps/api/src/app.ts`: composition/startup; `dispatcher.ts` and `sse.ts`: execution and business events.
- `packages/audit/src/ports.ts`, `orchestrator.ts`, `proposal-guard.ts`, `document-ir.ts`: domain contracts and invariants.
- `packages/pi-agent/src/runtime.ts`, `tools.ts`: session lifecycle and controlled agent capabilities.
- `apps/web/src/main.tsx`, `app.tsx`, `api.ts`, `hooks/use-audit-events.ts`: browser entry, routing, typed client, and live updates.
- `package.json`, `bun.lock`, `biome.json`, `tsconfig.base.json`, `tsconfig.tests.json`, `playwright.config.ts`, `compose.yaml`, `.env.example`, `.github/workflows/ci.yml`: tooling/configuration authorities.
- Read `docs/adr/0001-bun-modular-monolith-with-embedded-pi.md` for module boundaries, ADR 0002 for evidence anchors, ADR 0003 for rule parameter governance, and `docs/runbook/mvp-local.md` for operational setup.

## Runtime/Tooling Preferences

Use Bun and `bun.lock`; CI and Docker pin Bun 1.4.0. Workspaces export TypeScript source directly; there is no root/API build script. PostgreSQL 18 is the persistent store and queue. RustFS/S3 originals and Redis verification caching are optional: originals fall back to `UPLOAD_DIR`, and cache failures fall back to direct verification.

Use `.env.example` as the configuration starting point and keep credentials out of API responses/logs. Startup can seed `XYG_*` credentials into provider storage; consult `apps/api/src/llm/seed-from-env.ts` and `api-key-crypto.ts` before changing persistence/encryption. Compose forwards an explicit variable list, so new host settings need corresponding container wiring. Current manifests/configuration take precedence over older runbook runtime versions.

## Testing & QA

Colocate `bun:test` tests as `*.test.ts`/`*.test.tsx`; browser specs use `@playwright/test` in `tests/acceptance/*.spec.ts`. Focused examples: `bun --env-file=.env test packages/audit` or `bunx playwright test tests/acceptance/upload.spec.ts`. API unit tests call `app.handle(new Request(...))` with injected fakes; DB tests use rollback isolation; web unit tests cover presentation helpers/static rendering.

Run `bun run verify` before delivery and acceptance for UI changes. CI additionally checks/applies migrations. Reachable, migrated PostgreSQL is needed for persistence coverage: some DB tests skip when unreachable. No numeric code-coverage gate is configured; maintain golden rule disposition checks and behavior-focused tests.

Acceptance needs installed Chromium (`bunx playwright install chromium`) and a disposable migrated database. Keep root `.env`'s `DATABASE_URL` aligned with `PLAYWRIGHT_DATABASE_URL`: cleanup in `rules.spec.ts`, `review-center.spec.ts`, and `remediations.spec.ts` reads `.env` directly. Keep the configured single worker because cases share database/rule state. Override `PLAYWRIGHT_API_PORT` and `PLAYWRIGHT_WEB_PORT` with unused ports; default server reuse may exercise stale code/configuration. `CI=true` disables reuse unless `PLAYWRIGHT_REUSE_SERVERS=1`. Use a fresh database for repeat runs; dropping only `public` leaves Drizzle's separate migration journal intact.
