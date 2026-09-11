# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-09-11

### Added

- Initial Contract Audit MVP as a Bun/TypeScript modular monolith:
  - `packages/audit`: domain model, deterministic advance-payment rule
    (`ADVANCE_PAYMENT_LIMIT`), plaintext contract normalization, fact
    extraction, and audit-snapshot orchestration (split per ADR 0001:
    adapters normalize only; facts are built by the fact builder).
  - `packages/pi-agent`: embedded Pi agent (`@earendil-works/pi-coding-agent`
    0.85.1) with an allowlisted tool surface only
    (`get_rule_assessment`, `get_evidence`, `submit_finding_proposal`).
    No built-in coding tools, SQL, shell, or file-write access. Prompt is
    loaded from `payment-terms-audit.skill.md`.
  - `apps/api`: Elysia REST + SSE API, case dispatcher, Drizzle ORM
    repositories over PostgreSQL (5 tables), OpenAPI docs.
  - `apps/web`: React audit workbench (TanStack Router, TanStack Query,
    Eden Treaty client typing, Ant Design).
  - `apps/web` acceptance suite (Playwright) driven by
    `AUDIT_AGENT_MODE=fake` so it runs without LLM credentials.
- `EvidenceLocator.id` stable identity; rule assessments and finding
  proposals cite `contract-payment` / `policy-limit` locators that
  `get_evidence` can actually resolve.
- Agent telemetry: `AgentRunResult` carries provider/model/version and real
  token usage from `session.getSessionStats()`, persisted in `agent_runs`.
- Manual credential smoke entrypoint: `cd packages/pi-agent && bun run smoke`.

### Changed

- Dispatcher processes the exact enqueued audit case (atomic claim-by-id)
  and restores leftover `PENDING` cases on startup; previously it claimed
  the oldest pending case while attributing events/findings to the
  enqueued id.
- Cancellation is detected via an explicit abort state and marks the case
  `CANCELLED` (was misclassified as `FAILED` via string matching).
- Human review is append-only: reviewing a finding appends a new
  `finding_revisions` row that supersedes the previous one (was an
  in-place overwrite); duplicate review returns 409; case listings show
  the revision chain head only.
- XYG provider registered in memory (models + API key) at runtime; no
  credentials are written to `.pi/`, and `.pi` / `.env` are excluded via
  `.gitignore` and `.dockerignore`.
- Playwright `webServer` command loads the root `.env` before starting the
  API so acceptance tests reach the configured PostgreSQL.

### Fixed

- XYG gateway endpoint corrected from `221.178.103.69` (empty replies) to
  `221.178.103.68`.

### Verified

- `bunx tsc --noEmit`: clean.
- `bun test packages apps`: 38 pass / 0 fail (includes repositories
  integration tests against real PostgreSQL).
- Real-LLM Pi agent smoke against `http://221.178.103.68`
  (`deepseek-v4-flash`): produced
  `ADVANCE_PAYMENT_POLICY_CONFLICT` / `HIGH` finding citing
  `contract-payment` + `policy-limit`, with token usage
  (input 6932, output 980, total 7912).
- Playwright acceptance: 1 passed (create → review → reload → retain).
- `docker build -f apps/api/Dockerfile .` succeeds; build context excludes
  `.env` and `.pi`.
- No API key material present in any tracked file; local `.pi/` credential
  cache deleted (test key, intentionally not rotated).
