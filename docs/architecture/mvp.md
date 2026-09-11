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
Demo text / pasted text
  -> PlainTextContractAdapter
  -> ContractDocument + SourceRecord
  -> Fact Builder
  -> Rule Assessment
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

Owns the two routes `/audit-cases` and `/audit-cases/:id`. It uses Eden Treaty for API calls and EventSource for progress. A reconnect first fetches an audit-case snapshot; it does not replay historical streaming events.

## Persistence Boundary

The MVP stores five collections:

| Collection | Purpose |
| --- | --- |
| `source_records` | Immutable source text and metadata |
| `audit_cases` | Audit status, current stage and immutable contract identity |
| `audit_snapshots` | Contract Document, Facts, policy inputs and time bounds used for a run |
| `agent_runs` | Pi/provider/model/version, usage, duration and failure metadata |
| `finding_revisions` | Machine proposal and append-only human acceptance/rejection revision |

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
POST /api/audit-cases
GET  /api/audit-cases
GET  /api/audit-cases/:id
GET  /api/audit-cases/:id/events
POST /api/audit-cases/:id/cancel
POST /api/audit-cases/:id/retry
POST /api/findings/:id/reviews
GET  /api/health
GET  /openapi
```

## Configuration and Compatibility Gate

The configuration layer maps the existing `XYG_*` environment variables to a provider-neutral internal configuration. No keys are logged, persisted, or returned by the API.

The first implementation task runs a real, no-tool `createAgentSession()` smoke test under Bun. If that exact Pi version has an upstream Bun runtime blocker, Elysia may run through its Node adapter while preserving the in-process architecture and package boundaries. A separate Pi service is not the fallback for this MVP.
