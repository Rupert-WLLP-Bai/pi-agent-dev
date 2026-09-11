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

### Added — Modern Audit Workbench

- Audit queue command center: summary strip (待复核 / 处理中 / 异常 / 今日完成),
  audit-ID search, localized lifecycle filters, last-updated timestamp with
  explicit refresh, localized status/stage, confirmed cancel/retry, loading,
  initial-error, empty, and filtered-empty states, and a 375 px mobile card
  list with no horizontal overflow.
- Decision-first review workbench: queue breadcrumb/back link, copyable short
  ID, localized state badge, five-step product progress, localized Finding
  type and severity, two-column Finding / rule-facts-and-evidence layout with
  explicit missing-evidence states, SSE connection state (正在连接 / 实时更新 /
  正在重连 / 已断开), accept/reject confirmation Drawer with a required
  rejection reason, HTTP 409 handling, and persisted terminal decisions.
- Guided audit creation Drawer: contract text with character count and helper
  copy, percentage policy threshold defaulting to 30%, inline blur/submit
  validation, and a non-submitting demo-contract loader.
- Shared `useMediaQuery` and `useAuditEvents` hooks, `AuditStateBadge`, and a
  pure `audit-presentation` module for lifecycle mapping, queue statistics,
  filtering/sorting, and step state.
- Ant Design v6 baseline (`antd@6.6.3`, `@ant-design/icons@6.3.4`) themed
  through one root `ConfigProvider` with project CSS variables and classes.

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
- Human review is terminal for both decisions: `ACCEPTED` and `REJECTED` both
  set the case to `COMPLETED` / `COMPLETED`.
- The web API base URL and the EventSource URL derive from one `VITE_API_URL`
  value; the detail stream no longer uses a relative path.
- Status and stage copy is Chinese across the workbench while wire values are
  unchanged.

### Fixed

- XYG gateway endpoint corrected from `221.178.103.69` (empty replies) to
  `221.178.103.68`.
- Rejected human reviews now complete the case; previously the decision was
  persisted but the case stayed awaiting review.
- `audit.completed` is published only after the case has reached its terminal
  state.
- The acceptance suite navigates to `/audit-cases` before asserting shell
  landmarks, and the detail route no longer nests a second `<main>` landmark
  inside the shell's `<main>`.
- The creation Drawer blocks Escape, mask close, and duplicate submission
  while submitting; the shell exposes a mobile menu trigger below 768 px.
- Removed the prohibited `.ant-btn` selector from project CSS.

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

### Verified — Modern Audit Workbench

- `bun run test` (`bun test packages apps`): 36 pass / 7 skip / 0 fail.
- `bun test apps/api/src/app.test.ts apps/web/src/audit-presentation.test.ts`:
  12 pass / 0 fail.
- `bun run typecheck`: clean.
- `antd lint apps/web/src --format json`: 0 deprecated/a11y/usage/performance
  findings.
- `bun --filter @contract-audit/web build`: success (1.27 MB JS chunk size
  warning only).
- Playwright acceptance (`tests/acceptance/audit-case.spec.ts` +
  `tests/acceptance/audit-queue.spec.ts`): 6 passed — create/accept,
  reject-with-reason, queue filter/search, confirmed cancel/retry, shell
  landmarks, and 375 px mobile overflow.
- Responsive sweep of the queue, the New Audit Drawer, and the review detail
  at 1440 / 1024 / 768 / 375 CSS pixels: no horizontal page overflow at any
  width.
- Keyboard sweep of the queue: every reachable control (brand, nav, refresh,
  create, search, filters, record link, actions) shows a visible focus
  outline.
