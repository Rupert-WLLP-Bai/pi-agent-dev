# Contract Audit MVP Architecture

## Goal

交付一个单用户、单实例的审计工作台，证明受控 Agent 能在不拥有业务裁决权的前提下，围绕确定性付款规则形成可复核的风险建议。

## Technical Selection

| Area | Choice | MVP responsibility |
| --- | --- | --- |
| Web | React, Vite, Ant Design, TanStack Router/Query | 审计创建、进度、Finding 与人工复核 |
| API | Bun 1.3.14, Elysia, TypeBox/Elysia `t` | REST、SSE、DTO 校验、OpenAPI/Scalar |
| Client typing | Eden Treaty | Monorepo 内前后端类型推导 |
| Core | TypeScript | Contract Document、Facts、Rule Assessment、编排端口 |
| Agent | `@earendil-works/pi-coding-agent@0.85.1` | 一个内存 Session 对应一个 Agent Run |
| Data | PostgreSQL, Drizzle | 审计快照、运行记录、Finding revisions |
| Dev infrastructure | Docker Compose | 仅启动 PostgreSQL |
| Later adapter | MinerU Python service | 将 PDF/OCR 输出转换为 Contract Document |

Pi 的官方 SDK 允许嵌入应用、注册自定义 Tool、订阅 Session 事件以及使用内存 Session。MVP 依赖这些能力，但不持久化 Pi transcript 或原始 runtime events。[Pi SDK](https://pi.dev/docs/latest/sdk)

## Runtime Flow

```text
Text paste / `.docx` / `.pdf` upload
  -> Document parser (plain text / docx / pdf)
  -> Contract Document IR + SourceRecord
  -> Fact Builder
  -> Rule Assessments (enabled rules × published versions)
  -> bounded Audit Snapshot
  -> Pi Agent Run
       get_rule_assessment
       get_evidence
       submit_finding_proposal
  -> Finding Revision
  -> Human Review
```

The Rule Engine owns the determination that a policy conflict exists. Pi may explain the conflict, organize evidence, propose severity and remediation, or return `NEEDS_HUMAN_REVIEW`; it cannot negate a deterministic Rule Assessment.

## Module Boundaries

### `packages/audit`

Owns domain types, the PlainText adapter contract, Fact Builder, payment rule, audit orchestration interfaces, and all domain validation that is independent of HTTP, PostgreSQL, Pi, or React.

### `packages/pi-agent`

Implements the audit-agent port with Pi. It loads the `payment-terms-audit` Skill and registers only `get_rule_assessment`, `get_evidence`, and `submit_finding_proposal`. Pi built-in coding tools are disabled.

### `apps/api`

Owns Elysia routes, Drizzle schema/migrations, PostgreSQL repositories, the in-process dispatcher, active-session registry, SSE mapping, and dependency composition. It translates Pi events into stable product events without exposing Pi event names or payloads.

### `apps/web`

Owns the dashboard, the audit queue and workbench (`/audit-cases`, `/audit-cases/:id`, `/audit-cases/:id/trace`), the review center (`/reviews`), remediation tracking (`/remediations`), rule governance (`/rules`, `/rules/:id`) and case validation (`/cases`). It uses Eden Treaty for API calls and EventSource for progress. A reconnect first fetches an audit-case snapshot; it does not replay historical streaming events. The acting operator's name is a browser-local preference (`src/operator.ts`) shared by the review center, the rule editor and the app shell.

## Persistence Boundary

The MVP stores the following collections:

| Collection | Purpose |
| --- | --- |
| `source_records` | Immutable source text and metadata |
| `audit_cases` | Audit status, current stage and immutable contract identity |
| `audit_snapshots` | Contract Document, Facts, policy inputs and time bounds used for a run |
| `subject_verifications` | External subject lookups attached to a case |
| `agent_runs` | Pi/provider/model/version, usage, duration and failure metadata |
| `agent_trace_steps` | Ordered trace steps for a run, backing the 运行轨迹 view |
| `finding_revisions` | Machine proposal and append-only human acceptance/rejection revision |
| `rules` | Rule identity plus the runtime enabled/disabled overlay |
| `rule_versions` | Parameter sets with draft/published/retired lifecycle |
| `validation_runs` / `validation_cases` | Golden-case runs recorded against a rule version |
| `remediations` | Remediation items opened from a confirmed finding |

JSONB is used inside snapshots for bounded document, Fact and policy payloads. This preserves the domain distinctions without forcing a table for every concept before the MVP has a second consumer.

## Execution and Failure Semantics

- `POST /api/audit-cases` creates a `PENDING` case and returns `202`.
- A single in-process dispatcher claims at most `MAX_CONCURRENT_AUDITS` cases; MVP default is one.
- An Agent Run owns one `SessionManager.inMemory()` session. The application unsubscribes listeners and disposes it in `finally`.
- Browser/SSE disconnect does not cancel work. `POST /api/audit-cases/:id/cancel` aborts the active session.
- On application startup, stale `RUNNING` cases become `INTERRUPTED`; pending cases remain eligible to run.
- A retry creates a new Agent Run against the immutable Audit Snapshot.
- Product completion occurs only after Finding validation and persistence succeed, not merely when Pi settles.

## API Surface

```text
# Audit cases
POST /api/audit-cases
POST /api/audit-cases/upload
GET  /api/audit-cases
GET  /api/audit-cases/:id
GET  /api/audit-cases/:id/events
GET  /api/audit-cases/:id/trace
POST /api/audit-cases/:id/cancel
POST /api/audit-cases/:id/retry
POST /api/audit-cases/:id/assignment

# Review
POST /api/findings/:id/reviews
GET  /api/reviews/queue

# Rule governance
GET  /api/rules
GET  /api/rules/:id
POST /api/rules
PUT  /api/rules/:id
POST /api/rules/:id/versions
PUT  /api/rules/:id/versions/:versionId
POST /api/rules/:id/validate
POST /api/rules/:id/publish
POST /api/rules/:id/disable
POST /api/rules/:id/enable

# Case validation
GET  /api/validation/cases
GET  /api/validation/runs
GET  /api/validation/runs/:id
POST /api/validation/runs

# Remediation
GET   /api/remediations
PATCH /api/remediations/:id
POST  /api/remediations/:id/close

# Ops
GET  /api/agent-runs
GET  /api/stats/overview
GET  /api/health
GET  /openapi
```

## Rule Governance

Rules are seeded from the engine catalogue — the `RuleCode` union in `packages/audit/src/model.ts`. A rule's parameters are versioned; a version moves `draft → published → retired`:

- Publishing a new version retires the previously published one. `retired` (`已退役`) is therefore a *lifecycle* status: that version was superseded, and findings that cite it keep their historical trace.
- The engine catalogues 17 rule codes. `SUBJECT_RED_LINE_RISK` is the one exception: its determination comes from external subject verification rather than published parameters, so it may be active with no published version. Every other code must exist in the catalogue to be persisted.
- A rule also carries a *runtime* toggle (`enabled`, `disabled_reason`, `disabled_by`, `disabled_at`), orthogonal to version status. Disabling records an operator and a required reason; the dispatcher reads the enabled set fresh on every run, so a rule disabled after a case is enqueued is skipped and re-enabling restores it. `POST /api/rules/:id/disable` and `POST /api/rules/:id/enable` are the mutation points, and `GET /api/rules` surfaces both `status` and `enabled` so the UI never conflates them.

Publishing is gated: the open draft must have a green validation run (`POST /api/rules/:id/validate`) before `POST /api/rules/:id/publish` accepts it.

## Review Flow

Once an audit reaches review, its findings enter the queue:

- `GET /api/reviews/queue` returns SLA-annotated items; a case's remaining time is recomputed from its deadline on render, not frozen at fetch time.
- `POST /api/audit-cases/:id/assignment` sets assignee and priority; a null assignee returns the item to the shared queue.
- `POST /api/findings/:id/reviews` records the per-finding human decision (confirm or false positive). Batch actions deliberately stop at routing work — they never confirm or dismiss findings in bulk.

A finding has no `ruleCode` of its own; the inspector aligns a finding to its rule through `findingType`. “不适用” (not applicable) is a derived view — the engine catalogue minus this case's `ruleAssessments` — not a persisted disposition, so no new disposition is introduced.

## Remediation

A confirmed risk opens a remediation item. `GET /api/remediations` returns the board (`pending` 待整改 / `in_progress` 整改中 / `awaiting_review` 待复核 / `closed` 已关闭); `PATCH /api/remediations/:id` updates owner, due date and progress note; `POST /api/remediations/:id/close` closes it and publishes `remediation.closed` on the SSE stream. The board is a state machine rather than a second review surface — opening an item returns to the audit workbench.

## Configuration and Compatibility Gate

The configuration layer maps the existing `XYG_*` environment variables to a provider-neutral internal configuration. No keys are logged, persisted, or returned by the API.

The first implementation task runs a real, no-tool `createAgentSession()` smoke test under Bun. If that exact Pi version has an upstream Bun runtime blocker, Elysia may run through its Node adapter while preserving the in-process architecture and package boundaries. A separate Pi service is not the fallback for this MVP.
