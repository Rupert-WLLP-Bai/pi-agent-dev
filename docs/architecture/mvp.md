# Contract Audit Architecture

## Goal

交付一个单实例的合同审计工作台，证明受控 Agent 能在不拥有业务裁决权的前提下，围绕确定性付款规则形成可复核的风险建议。运行时可接入对象存储与缓存以增强留痕与吞吐，但二者均可降级：缺少它们时审计流程仍然完整。

## Runtime Topology

```text
                    ┌─────────────────────────────────────────────┐
  浏览器 ───────────▶│ React 工作台（Vite）                          │
                    │  开发 :5173（/api 代理到 :3000）              │
                    │  演示 :8080（容器内 Web 服务）                │
                    └───────────────┬─────────────────────────────┘
                                    │ REST / SSE
                    ┌───────────────▼─────────────────────────────┐
                    │ Elysia API :3000                             │
                    │  进程内 AuditDispatcher + SSE broker         │
                    │  嵌入式 Pi agent runtime（一个 Run 一个 Session）│
                    └──┬───────────┬────────────┬─────────────────┘
                       │           │            │
              ┌────────▼──┐  ┌─────▼─────┐  ┌───▼──────────────┐
              │PostgreSQL │  │ MinIO/S3  │  │ Redis（可选缓存）  │
              │ 留痕/快照 │  │ 合同原文   │  │ 企查查核验结果     │
              └───────────┘  └─────┬─────┘  └──────────────────┘
                                   │ S3_ENDPOINT 未配置 → 本机 UPLOAD_DIR
```

### Deployment

两条路径，均由 `compose.yaml` 描述。

**development**（本地基础设施在容器里，应用在宿主上跑，改代码即时热更新）：

```bash
docker compose up -d postgres minio redis
bun --filter @contract-audit/api dev    # 宿主原生 API，:3000
bun --filter @contract-audit/web dev    # Vite :5173，将 /api 代理到 :3000
```

**demo**（整套栈构建进容器）：

```bash
docker compose up --build
# 打开 http://localhost:8080
docker compose exec api bun run seed:demo   # 演示种子不自动执行，需手动触发
```

服务与端口：

| 服务 | 端口 |
| --- | --- |
| postgres | 5432 |
| minio | 9000（S3 API）/ 9001（控制台）|
| redis | 6379 |
| api | 3000 |
| web | 8080 |

API 容器启动时自动应用迁移。`AUDIT_AGENT_MODE` 在容器中默认为 `fake`，因此演示不需要任何 LLM 凭证；需要真实 Agent 时显式设置 `AUDIT_AGENT_MODE=pi` 并提供 `XYG_*`（或通过模型服务页配置 provider）。

## Technical Selection

| Area | Choice | responsibility |
| --- | --- | --- |
| Web | React, Vite, Ant Design, TanStack Router/Query | 审计创建、进度、Finding 与人工复核、模型服务页 |
| API | Bun 1.3.14, Elysia, TypeBox/Elysia `t` | REST、SSE、DTO 校验、OpenAPI/Scalar |
| Client typing | Eden Treaty | Monorepo 内前后端类型推导 |
| Core | TypeScript | Contract Document、Facts、Rule Assessment、编排端口 |
| Agent | `@earendil-works/pi-coding-agent@0.85.1` | 一个内存 Session 对应一个 Agent Run |
| Data | PostgreSQL, Drizzle | 审计快照、运行记录、Finding revisions、规则参数、LLM provider |
| Object storage | MinIO（S3 API）| 合同原文；未配置时回退本地目录 |
| Cache | Redis | 仅企查查主体核验结果（7 天 TTL）|
| LLM providers | OpenAI-compatible | 运行时可配置的模型服务（`/settings/providers`）|
| Dev infrastructure | Docker Compose | 开发启动 PostgreSQL + MinIO + Redis；演示启动整套栈 |
| Later adapter | MinerU Python service | 将 PDF/OCR 输出转换为 Contract Document |

Pi 的官方 SDK 允许嵌入应用、注册自定义 Tool、订阅 Session 事件以及使用内存 Session。本系统依赖这些能力，但不持久化 Pi transcript 或原始 runtime events。[Pi SDK](https://pi.dev/docs/latest/sdk)

## Runtime Flow

```text
Text paste / `.docx` / `.pdf` upload
  -> Original store (S3/MinIO, else UPLOAD_DIR) + SourceRecord locator
  -> Document parser (plain text / docx / pdf)
  -> Contract Document IR + SourceRecord
  -> Fact Builder
  -> Subject verification (Redis cache hit → new SourceRecord, skip the network call)
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

Owns Elysia routes, Drizzle schema/migrations, PostgreSQL repositories, the in-process dispatcher, active-session registry, SSE mapping, the original-store adapter (S3/MinIO with a local fallback), the QCC verification cache, LLM-provider resolution, and dependency composition. It translates Pi events into stable product events without exposing Pi event names or payloads.

### `apps/web`

Owns the dashboard, the audit queue and workbench (`/audit-cases`, `/audit-cases/:id`, `/audit-cases/:id/trace`), the review center (`/reviews`), remediation tracking (`/remediations`), rule governance (`/rules`, `/rules/:id`), case validation (`/cases`), and the model-service page (`/settings/providers`, sidebar group 系统管理). It uses Eden Treaty for API calls and EventSource for progress. A reconnect first fetches an audit-case snapshot; it does not replay historical streaming events. The acting operator's name is a browser-local preference (`src/operator.ts`) shared by the review center, the rule editor and the app shell.

## Persistence Boundary

The system stores the following collections in PostgreSQL:

| Collection | Purpose |
| --- | --- |
| `source_records` | Immutable source text and metadata, including the original-store locator |
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
| `llm_providers` | OpenAI-compatible provider configuration, including the persisted API key |

JSONB is used inside snapshots for bounded document, Fact and policy payloads. This preserves the domain distinctions without forcing a table for every concept.

**Why not MongoDB.** The snapshots, Facts and rule parameters already live in PostgreSQL JSONB, and there is no independent document-search or change-stream requirement that would justify a second document store. Adding MongoDB would duplicate the store of record without a consumer that needs it.

## External Services

### Object storage (contract originals)

S3/MinIO is the primary store for uploaded contract originals. When `S3_ENDPOINT` is unset — or a Put fails — the adapter degrades to the `UPLOAD_DIR` local directory. The locator prefix on each Source Record records which backend wrote the row: `s3://bucket/key` for the object store, a filesystem path for the local directory. The same degradation path drives the health line: an unconfigured store reports the local directory with `ok: true` rather than failing.

### Redis (Qichacha verification cache only)

Redis is a 7-day TTL cache keyed `qcc:v1:{normalizedSubject}`, wrapping the real Qichacha subject-verification adapter. A cache hit still writes a **new** Source Record for the case — evidence stays immutable; only the network call is skipped. When Redis is down or `REDIS_URL` is unset, verification calls the provider directly; it never fails an audit.

Redis is explicitly **not** the audit queue, **not** SSE pub/sub, and **not** a session store. The audit queue remains on PostgreSQL `SKIP LOCKED`. The trigger for revisiting that decision is running multiple API replicas behind a load balancer, where a shared external queue would again be warranted.

### LLM providers

`/settings/providers` manages OpenAI-compatible providers: name, base URL, model, API key, max input/output tokens, and an enabled flag. Exactly one provider is 当前/active, and it is the configuration the next audit run uses. When the table is empty the runtime falls back to the `XYG_*` environment variables, so nothing needs to be configured to keep the previous behaviour.

Persisting a provider row (including its key) in `llm_providers` is the cost of letting operators add and edit providers at runtime. What remains true for both paths: a provider's key is never returned by any API response (the API reports presence plus a masked hint only), never logged, and never reaches the browser. The `XYG_*` environment path keeps its key in process memory only.

## Configuration and Compatibility Gate

The configuration layer maps the `XYG_*` environment variables to a provider-neutral internal configuration, overridden at runtime by the active row in `llm_providers`. For the active provider the API exposes only presence and a masked hint; the key value is never returned by the API. The environment path's key is never logged or persisted.

The first implementation task ran a real, no-tool `createAgentSession()` smoke test under Bun. Elysia runs under Bun; a separate Pi service is not a deployment target.

## Execution and Failure Semantics

- `POST /api/audit-cases` creates a `PENDING` case and returns `202`.
- A single in-process dispatcher claims at most `MAX_CONCURRENT_AUDITS` cases and reads the enabled rule set fresh on every run.
- An Agent Run owns one `SessionManager.inMemory()` session. The application unsubscribes listeners and disposes it in `finally`.
- Browser/SSE disconnect does not cancel work. `POST /api/audit-cases/:id/cancel` aborts the active session.
- On application startup, stale `RUNNING` cases become `INTERRUPTED`; pending cases remain eligible to run.
- A retry creates a new Agent Run against the immutable Audit Snapshot.
- Product completion occurs only after Finding validation and persistence succeed, not merely when Pi settles.

## Health (`GET /api/health`)

The endpoint answers with the aggregate fields `status`, `database`, `dispatcher`, `agentMode`, `qccConfigured` and `llmConfigured`, plus a `connections` object carrying the concrete, non-secret address of each dependency. Each connection is `{ target, ok, detail }` (with `detail` null on success). Credentials are stripped from every `target`; for secrets only presence is reported.

HTTP 503 is driven **only** by `database` or `dispatcher`. Redis and object storage are degradable: they report `ok: false`/`ok: true` in `connections` without changing `status`.

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

# LLM providers
GET    /api/llm-providers
POST   /api/llm-providers
PATCH  /api/llm-providers/:id
DELETE /api/llm-providers/:id
POST   /api/llm-providers/:id/activate
POST   /api/llm-providers/:id/test
GET    /api/llm-providers/:id/models

# Ops
GET  /api/agent-runs
GET  /api/stats/overview
GET  /api/health
GET  /api/openapi
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
