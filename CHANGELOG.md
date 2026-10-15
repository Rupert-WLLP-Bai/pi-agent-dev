# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-10-15

### Added

- Shared-workspace API access with Bearer credentials or revocable HttpOnly sessions,
  protected original downloads/SSE/configuration, origin checks for writes, and
  access logs that omit request content and credentials. Demo/production require a token.
- Raw internal contract processing requires an explicitly authorized model origin;
  standard synthetic documents are identified from recomputed content hashes.
  Pi refuses HTTP redirects for both keyed and keyless model requests.
- Active session SSE streams close on logout/expiry and cancel their subscriptions.
  Synthetic model exemptions now require trusted subject-verification provenance,
  including failed checks without external evidence; upstream diagnostics stay out of model basis.
- Atomic model/OCR encryption-key rotation with database identity confirmation,
  a dry-run default, corrupt-row rollback and no credential logging. Startup seals
  legacy plaintext keys in both stores and requires an encryption secret for demo/production.
- Trace/cache failures omit raw errors that may contain document text or credentials.
  An unavailable optional Redis now disables caching promptly instead of blocking startup
  with unlimited reconnects; verification continues through the underlying provider.
- Versioned shadow-decision contracts for Disabled/Fake and local Laya, with distinct
  case, snapshot and run identities, typed failures, independent feedback and public
  detail envelopes. These contracts do not grant authority to change audit findings.
- TypeBox validation for controlled questions and provider answers: unsupported
  versions, invalid distributions, non-finite values and provider-supplied authority
  fields are rejected. S1 also freezes privacy, retention, access and migration
  responsibilities for the subsequent implementation.
- **Agent Trace tree**: the audit-case trace page now renders a deepseek-harness-style
  recursive tool-call tree with turn grouping instead of a flat list. Turns are
  `TURN_STARTED` / `TURN_COMPLETED` STAGE steps carrying the assistant message, tool
  results, and token usage (input/output/cacheRead/cacheWrite/total); Tool Calls render
  their Nested Tool Calls (a tool calling another via the session's `executeTool`,
  id `<parentId>/<n>`, linked by `parentRef`) beneath them. Legacy traces without turn
  stages still render under a synthetic root turn.
- Nested-call support in the trace pipeline: `AgentTraceStep` carries `parentRef`
  (parent toolCallId, null at top level); `get_rule_assessments` became an
  orchestrating tool issuing real nested `get_evidence` calls; the Pi trace reporter
  maps `parentToolCallId` from SDK events defensively. See ADRs 0004 and 0005.
- `GLOSSARY.md` at the repository root collects the full product vocabulary
  (Contract … Party History Run) in one place, adding Agent Turn, Tool Call,
  Nested Tool Call, and Trace Tree.
- **Scanned-document recognition settings** (`/settings/ocr`): one persisted OCR
  configuration row selecting 关闭 / 视觉模型 / MinerU, with the VLM endpoint, an
  optional key, model plus optional fallback, and page/quality/concurrency/timeout
  limits. The key is sealed at rest with the same crypto as LLM providers, responses
  carry presence plus a mask only, and an empty key on an edit keeps the stored one.
- A live `OcrPort` resolves the stored row per operation, so a save changes what the
  next PDF parse — audit or dossier — and `GET /api/health` report **without
  restarting**; one run captures a single recognizer, so a document is never half-read
  under two configurations. The `OCR_*` variables are the bootstrap until a row exists.
- `POST /api/ocr-settings/test` and `GET /api/ocr-settings/probe` for readiness; a
  recognizer that is off or unreachable reports why instead of pretending to work.
- A real MinerU adapter for the verified 4.x HTTP contract (`/v1/file_parse` with
  `output_formats` as repeated query parameters, `files` as the only form field,
  docvortex v2 `pages[].blocks[]` geometry, `409`/`202`/`status` handling,
  `error.message` surfaced as the parse reason, bounded result polling). Bounding
  boxes are deliberately dropped: `OcrBlock` has no box, and an unreliable one is
  worse than none.
- **重新审计 (Audit Rerun)**: `POST /api/audit-cases/:id/rerun` opens a new Audit Case
  over the same Source Record and the **same** Contract Revision, re-parses the
  original bytes under the current recognizer, rebuilds the snapshot under current
  rules, and runs the Agent again. The old case, its status, snapshots, findings,
  human reviews, remediation items and traces stay exactly as they were. Concurrent
  protection: `409 case_active` for a still-running source, `409 rerun_already_active`
  when another case on that revision is already queued or running.
- `POST /api/llm-providers/models` discovers models from an unsaved draft: only the
  endpoint is required, an empty key sends no `Authorization` header, and advertised
  capacities (`context_length`, `max_output_tokens`, …) fill the form while unknown
  limits leave the operator's manual values untouched.

### Fixed

- OCR settings repository imports now resolve from `document/ocr/`, allowing
  the API to start after the OCR module move.
- Docker build contexts exclude `node_modules` at every workspace depth, preventing
  dependency-link transfer failures when building from WSL through Docker Desktop.
- Tool durations now use Pi's monotonic execution timing, rounded to integer
  milliseconds for persistence, instead of wall-clock event delivery gaps.
- The model runtime no longer fails keyless local endpoints: an empty key is stored
  as empty (never encrypted into a non-empty ciphertext) so `apiKeyConfigured` stays
  honest, no `Authorization` header is sent when there is no credential, and
  `GET /api/health` follows endpoint + model rather than credential presence.
- Malformed and unknown ids on the rerun route answer `404 audit_case_not_found`
  instead of a driver cast error surfacing as `500`; a retry of an audited case
  (待复核 / 已完成) returns `409 case_not_retryable` — new findings for reviewed
  work must go through a rerun.
- `assertAllowedLlmEndpoint` tests no longer depend on the developer's ambient
  `LLM_ENDPOINT_ALLOWLIST`, and malformed/non-http endpoints are covered.

### Added

- Completed and awaiting-review audit cases now offer **重新审计** in
  both the audit queue and case detail: it opens a NEW case over the same
  Source Record and Contract Revision (see the 重新审计 entry above), while
  retry keeps its narrower un-reviewed-failure scope. Confirmation explains that
  the original case's findings, reviews and remediations are preserved unchanged.
- **Agent Run traces**: every Pi Agent run now leaves a persistent, ordered
  trace of what it did — stage boundaries, tool calls with arguments, tool
  results, assistant messages, and token counts — stored in a new
  `agent_trace_steps` table and streamed live via the existing SSE broker
  (`agent.trace` event). A new `/audit-cases/:id/trace` page renders the trace
  as a timeline (deepseek-harness style), and `/audit-runs` indexes every
  recent run across all cases. Both pages are reachable from the navigation
  menu and the case detail banner's 运行轨迹 button.
- `AgentTraceStep`, `AgentTraceObservation`, `AgentTraceTokens` domain types in
  `packages/audit/src/model.ts`; `AgentTraceSink` port and `AgentRunIdentity`
  in `packages/audit/src/ports.ts`; `createAgentTraceCollector` in
  `packages/audit/src/agent-trace.ts` (serial write queue, never blocks the
  agent, swallows write failures).
- `packages/pi-agent/src/trace.ts`: `createPiTraceReporter` maps SDK session
  events (`tool_execution_start/end`, `turn_start/end`, `message_end`,
  `agent_start`) to trace observations defensively — unknown events are
  skipped, never crash the audit.
- `apps/web/src/components/agent-trace-timeline.tsx`: timeline that pairs
  tool calls with their results by `ref`, shows payloads with truncation,
  error states, token counts, and per-turn durations.
- `submit_finding_proposal` tool now accepts every `FindingType` the domain
  defines (8 types), not just 3 — the agent can report penalty, termination,
  and dispute-clause findings in addition to the original three.
- Payment-terms-audit skill prompt rewritten: documents all five rule
  dimensions, the disposition-to-finding-type table, and instructs the agent
  to submit one proposal per violated dimension.
- E2E test `tests/acceptance/agent-trace.spec.ts`: full lifecycle
  (submit → process → verify trace with tool calls/args/results → human
  review → close → trace still accessible), plus nav-reachability and
  empty-state tests.

### Changed

- Embedded Pi SDK and Pi AI upgraded from 0.85.1 to pinned 1.2.0, with matching
  TypeBox 1.3.27 schemas. Audit sessions explicitly isolate resource discovery,
  use in-memory settings and history, declare thinking level `off`, and expose
  the six audit tools. New runs record version 1.2.0; historical identities remain
  intact. Release evidence and compatibility details are recorded in
  `docs/research/2026-10-14-pi-1.2-upgrade.md`.
- `AuditAgentPort.run` now takes an `AgentTraceSink` and exposes a readonly
  `identity: AgentRunIdentity`; `AgentRunResult.telemetry` replaced by
  `usage: Record<string, number> | null` (identity moved to the port).
- `agent_runs` is now opened with `beginAgentRun` before the agent starts and
  closed with `finishAgentRun` after, so trace steps can reference the run
  while it is still in flight.
- `PiAuditAgent` now accumulates proposals in a `Map` keyed by `findingType`
  (re-submission supersedes rather than duplicates); returns `proposals: []`
  for a clean contract only when at least one tool was called.
- `FakeAuditAgent` now emits the same trace shape as the Pi agent
  (RUN_STARTED → get_rule_assessments → get_evidence per finding →
  submit_finding_proposal per finding → RUN_COMPLETED), making the trace view
  testable without credentials.

### Verified — Quality gates on 2026-09-13

- `bun run lint`: clean (117 files).
- `bun run typecheck`: clean under TypeScript 7.0.2 (both passes).
- `bun test packages apps`: 154 pass / 0 fail (405 assertions, 27 files).
- `npx playwright test`: 19 pass / 0 fail, both with the local dev stack and
  under the CI parameter set (`CI=true`, four workers, servers auto-started).
- Real Pi Agent run (deepseek-v4-flash, `.env` credentials): 16 trace steps,
  4 findings (1 HIGH + 3 MEDIUM), 12392 input / 2146 output tokens, 39 s.
- Browser check at 1280×800: trace page shows 7 timeline items (RUN_STARTED,
  3 tool calls with args+results, RUN_COMPLETED), all tool names visible
  (get_rule_assessments, get_evidence, submit_finding_proposal), 9 payload
  blocks, stage labels in Chinese.

## [Unreleased] - 2026-09-12

### Added

- Repository-wide lint/format toolchain: `@biomejs/biome` 2.5.13 with
  `biome.json` (2-space indent, 100 columns, double quotes, trailing commas,
  `organizeImports`), plus `bun run lint` / `lint:fix` / `format` /
  `verify` scripts. `docs/design` mockups and `apps/web/src/styles.css`
  (deliberate antd override layer) carry scoped exemptions.
- `tsconfig.tests.json` extends typecheck to `tests/`, `playwright.config.ts`,
  `apps/web/vite.config.ts`, and `apps/api/drizzle.config.ts`, which were
  previously outside every compiler pass.
- `.github/workflows/ci.yml`: a `quality` job (lint, typecheck, unit tests)
  and an `acceptance` job (PostgreSQL 16 service, migrations, Playwright on
  Chromium) with report upload.
- `SourceProvenance` (`type` + `displayName`) in `packages/audit/src/model.ts`:
  one domain type for how a Contract Revision entered the system, stored on the
  Source Record's metadata and shared by the API projection, the fake
  repository, and the web queue.
- `packages/audit/src/demo-contracts.ts`: the built-in sample catalog moved out
  of `apps/web` so the API can resolve a submitted `demoId` against it. The
  catalog — not the submitting client — decides what counts as a DEMO source.
- `apps/api/src/demo-agent.ts`: the deterministic demo agent extracted from
  `app.ts`, now returning one Finding Proposal per violated dimension instead of
  only the highest-precedence one.
- Queue 来源 column labels its channel from `audit-presentation.ts`
  (`文件上传` / `内置演示` / `文本粘贴`), shows the filename or sample title as
  the primary line, and renders `—` when provenance was never recorded.
- `summarizeRuleCoverage` and the completed-no-findings workbench state: a
  passed case now shows rule coverage and evidence completeness instead of a
  bare success message, per the no-risk-state design requirement.

### Changed

- `AgentRunResult.proposal` became `proposals: FindingProposal[]`. A contract
  can breach several dimensions at once, so the dispatcher persists and
  publishes every proposal and the case's risk is the worst of them.
- `getFindingsByCase` orders findings worst-first (severity, then recency), so
  the workbench opens on the finding that matters rather than on whichever
  dimension happened to be written last.
- The dispatcher persists a terminal case status before publishing
  `audit.completed` / `audit.awaiting_review`, matching the review route: the
  SSE handler refetches on those events, and publishing first could leave the
  detail view stuck on “审计进行中” with no later event to correct it.
- Demo sample set: cross-clause references added (质保期, 保密存续, 关联方,
  penalty cross-references), and the file's risk classes now match what the
  deterministic rules actually produce — 2 HIGH, 7 MEDIUM, 3 passed, with no
  LOW tier, because every rule either settles a conflict or asks for human
  review.

### Fixed

- Real defects surfaced by the new gates, no behaviour changes:
  non-null assertions replaced with narrowing (`repositories`,
  `dispatcher`, `testing/fakes`, `main.tsx`, `new-audit-drawer`), a typed
  `let snapshot: AuditSnapshot` in the upload route, unused imports,
  variables, and function parameters removed, an implicit-any `let` typed,
  `AuditQueue`'s dead `refreshedAt` prop dropped, and the review-workspace
  click targets (`finding-item`, `back-link`) converted from `div`/`span` to
  real `button` elements with matching CSS resets.
- `demoContracts` is now a non-empty tuple, so the drawer's sample fallback
  needs no assertion.
- Source provenance is no longer invented: `COALESCE(... 'TEXT_PASTE')` used to
  label every pre-provenance record — including every file uploaded before the
  column existed — as pasted text. Unknown provenance now projects as null and
  renders as `—`.
- The queue's “xx 条/页” size selector was not selectable; pagination is now
  controlled, offers 10/20/50 rows, shows the total, and returns to page 1 when
  the page size, filter, or search changes.
- The detail page's three-pane workspace could overflow vertically: the
  flex/grid height chain from `.app-shell` down to `.review-workspace` now
  carries `min-height: 0` and `grid-template-rows: minmax(0, 1fr)`, so the
  panes scroll internally and the page never grows.
- A clean contract used to carry a token LOW finding, conflating “no finding”
  with “low risk”. The demo agent now returns no proposal for a fully
  compliant contract, and the case completes without entering review.

### Verified — Quality gates on 2026-09-12

- `bun run lint`: clean (106 files).
- `bun run typecheck`: clean under TypeScript 7.0.2 (application pass and
  tests pass).
- `bun test packages apps`: 132 pass / 0 fail (329 assertions, 23 files),
  including the DB-backed provenance round trip and the per-contract rule
  profile / proposal-distribution assertions.
- `npx playwright test`: 16 pass / 0 fail, both with the local dev stack and
  under the CI parameter set (`CI=true`, no `.env`, four workers, servers
  auto-started).
- Browser check at 1280×800: queue 来源 column shows filename/title/channel and
  `—` for unrecorded provenance; the passed case shows 规则覆盖 5 / 5 and
  证据完整度 5 / 5; a two-finding case lists 高风险 before 中风险 and opens on
  the high one; `.review-workspace` resolves to a 609 px row with no page
  overflow.

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
- Example contract inputs (`apps/web/src/demo-contracts.ts`) following the
  `../agent-comp` evaluation-fixture clause structure (甲方/乙方, 第一条…第八条,
  签订日期), selectable in the New Audit Drawer: 设备采购 70%、原材料 30%、
  电子元件 50%. The fixtures express the advance ratio as Chinese numerals
  (`百分之三十`), which the deterministic extractor cannot read, so the samples
  put the advance ratio in Arabic digits in 第三条 with no earlier `%`.

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
- The payment-terms audit skill prompt now requires Simplified Chinese
  `rationale` and `remediation`; a real-LLM run previously wrote English copy
  into the Chinese-only workbench.
- Local PostgreSQL upgraded from 16 to 18 (`postgres:18`). The 18+ Docker
  images changed the data directory convention, so the compose volume now
  mounts `/var/lib/postgresql` instead of `/var/lib/postgresql/data`.

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
- The web dev server bound only to IPv6 loopback (`[::1]:5173`), so the
  workbench was unreachable from the Windows host under WSL2. It now binds all
  interfaces. Reachability is required for the documented
  `http://localhost:5173/audit-cases` entry point.
- The documented API dev command failed with `LLM_NOT_CONFIGURED`: Bun reads
  `.env` from the process working directory, and `bun --filter` runs the
  package script inside `apps/api`, so the root `.env` was never loaded. The
  API `dev` script and the Pi `smoke` script now load it explicitly with
  `--env-file=../../.env`.

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
- Real LLM endpoint (`AUDIT_AGENT_MODE=pi`, XYG `deepseek-v4-flash`): the 70%
  sample reached `AWAITING_REVIEW` in 30–45 s with `advancePaymentRatio` 0.7
  vs `policyLimitRatio` 0.3 and disposition `POLICY_CONFLICT`; the finding
  cited `contract-payment` + `policy-limit` and rendered in the workbench
  (待复核, evidence `70%`), then persisted through 接受建议 to `COMPLETED`
  (`已断开`), with no 375 px overflow. `agent_runs` recorded provider `pi`,
  model `deepseek-v4-flash`, duration 45031 ms, usage input 7281 / output
  1200 / total 8481.
- Note: the dispatcher has no agent-run timeout; one real-LLM request stalled
  indefinitely (445 s, then cancelled) and held the single concurrency slot.
  Adding a bounded agent timeout is a recommended follow-up, not done here.

### Verified — Local stack on PostgreSQL 18

- `docker compose exec postgres psql -c "select version()"`:
  `PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)`.
- `bun --filter @contract-audit/api migrate`: migrations applied successfully
  against the fresh 18 volume; all five tables present.
- `bun run typecheck`: clean.
- `bun test packages apps`: 45 pass / 0 fail (99 assertions, 12 files),
  including the repository integration tests against PostgreSQL 18.
- Real LLM run through the workbench (`AUDIT_AGENT_MODE=pi`, XYG
  `deepseek-v4-flash`): the 70% demo contract reached `AWAITING_REVIEW` in
  30.6 s with `POLICY_CONFLICT`, `agent_runs` recording provider `pi`, model
  `deepseek-v4-flash`, version `0.85.1`, duration 30610 ms, usage input 7264 /
  output 1337 / total 8601, and no error.
- Queue and detail rendered the persisted record after a full reload
  (待复核 count 1, record `59437df9…`, stage 人工复核).
- Second real-LLM run started with the documented
  `bun --filter @contract-audit/api dev` command reached `AWAITING_REVIEW` in
  80.1 s with the same `POLICY_CONFLICT` finding and no `LLM_NOT_CONFIGURED`.
