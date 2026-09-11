# Contract Audit MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user contract-audit vertical slice that identifies an advance-payment policy conflict, obtains an evidence-bound Pi Finding Proposal, and records human review.

**Architecture:** A Bun workspace hosts a React SPA and an Elysia API. A pure audit package owns Contract Document normalization, facts and deterministic rules; a Pi adapter implements the agent port using only allowlisted tools. PostgreSQL stores immutable source/snapshot data and append-only finding revisions; an in-process dispatcher runs one audit at a time and publishes product-level SSE events.

**Tech Stack:** Bun 1.3.14, TypeScript, React, Vite, Ant Design, TanStack Router/Query, Elysia, `@elysiajs/openapi`, `@elysiajs/eden`, PostgreSQL, Drizzle, Docker Compose, `@earendil-works/pi-coding-agent@0.85.1`, Bun test, Playwright.

## Global Constraints

- Pin `@earendil-works/pi-coding-agent` to `0.85.1` and do not use the deprecated `@mariozechner/*` scope.
- The Agent must not receive built-in Pi coding tools, arbitrary SQL, arbitrary HTTP, shell, file-write, or file-edit access.
- A deterministic Rule Assessment cannot be overridden by the Agent.
- Every persisted Finding Proposal must cite stable Evidence Locators from the Audit Snapshot.
- Keep `.env` out of source control; use only `.env.example` for defaults without credentials.
- PostgreSQL is the only MVP infrastructure service; no Redis, object store, MinerU, or external business integrations.
- Use `bun test` for unit/integration tests and Playwright for the acceptance flow.
- Preserve the vocabulary in `CONTEXT.md` and the architectural boundary in ADR-0001.

---

## File Structure

```text
package.json
tsconfig.base.json
compose.yaml
.env.example
apps/
  api/
    package.json
    drizzle.config.ts
    src/
      app.ts
      config.ts
      db/schema.ts
      db/repositories.ts
      dispatcher.ts
      routes/audit-cases.ts
      routes/findings.ts
      sse.ts
  web/
    package.json
    src/
      main.tsx
      app.tsx
      api.ts
      routes/audit-cases.tsx
      routes/audit-case-detail.tsx
packages/
  audit/
    package.json
    src/
      model.ts
      plaintext-adapter.ts
      payment-rule.ts
      orchestrator.ts
      ports.ts
  pi-agent/
    package.json
    src/
      config.ts
      runtime.ts
      tools.ts
      payment-terms-audit.skill.md
tests/
  acceptance/audit-case.spec.ts
```

## Task 1: Bootstrap the workspace and local infrastructure

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `compose.yaml`
- Create: `apps/api/package.json`, `apps/web/package.json`, `packages/audit/package.json`, `packages/pi-agent/package.json`
- Modify: `.gitignore`, `.env.example`

**Produces:** Bun workspaces named `@contract-audit/api`, `@contract-audit/web`, `@contract-audit/audit`, and `@contract-audit/pi-agent`; `bun run test`, `bun run typecheck`, and `bun run dev` root scripts.

- [ ] **Step 1: Create a failing workspace-resolution test**

Create `packages/audit/src/workspace.test.ts`:

```ts
import { expect, test } from "bun:test";
import { workspaceName } from "./workspace";

test("exports the audit workspace identity", () => {
  expect(workspaceName).toBe("@contract-audit/audit");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/audit/src/workspace.test.ts`

Expected: FAIL because the workspace package and module do not yet exist.

- [ ] **Step 3: Add the root workspaces and the minimal module**

Use the root workspace declaration:

```json
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "dev": "bun --filter @contract-audit/api dev"
  }
}
```

Implement `packages/audit/src/workspace.ts`:

```ts
export const workspaceName = "@contract-audit/audit" as const;
```

Create `compose.yaml` with a single `postgres:16` service named `postgres`, database/user/password `contract_audit`, and port `5432:5432`.

- [ ] **Step 4: Run the test and type check**

Run: `bun install && bun test packages/audit/src/workspace.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock tsconfig.base.json compose.yaml .gitignore .env.example apps packages
git commit -m "chore: bootstrap contract audit workspaces"
```

## Task 2: Define the audit core and deterministic payment rule

**Files:**
- Create: `packages/audit/src/model.ts`, `packages/audit/src/payment-rule.ts`
- Test: `packages/audit/src/payment-rule.test.ts`

**Consumes:** `@contract-audit/audit` workspace.

**Produces:** `evaluateAdvancePaymentRule(snapshot): RuleAssessment`.

- [ ] **Step 1: Write failing rule tests**

```ts
import { expect, test } from "bun:test";
import { evaluateAdvancePaymentRule } from "./payment-rule";

test("returns POLICY_CONFLICT when advance payment exceeds the policy limit", () => {
  const result = evaluateAdvancePaymentRule({ advancePaymentRatio: 0.7, policyLimitRatio: 0.3 });
  expect(result.disposition).toBe("POLICY_CONFLICT");
  expect(result.evidenceIds).toEqual(["contract-payment", "policy-limit"]);
});

test("returns COMPLIANT at the policy limit", () => {
  const result = evaluateAdvancePaymentRule({ advancePaymentRatio: 0.3, policyLimitRatio: 0.3 });
  expect(result.disposition).toBe("COMPLIANT");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/audit/src/payment-rule.test.ts`

Expected: FAIL because `evaluateAdvancePaymentRule` is not exported.

- [ ] **Step 3: Implement minimal types and rule**

```ts
export type RuleDisposition = "POLICY_CONFLICT" | "COMPLIANT";

export interface PaymentFacts {
  advancePaymentRatio: number;
  policyLimitRatio: number;
}

export interface RuleAssessment {
  disposition: RuleDisposition;
  ruleCode: "ADVANCE_PAYMENT_LIMIT";
  evidenceIds: string[];
}

export function evaluateAdvancePaymentRule(facts: PaymentFacts): RuleAssessment {
  return {
    disposition: facts.advancePaymentRatio > facts.policyLimitRatio ? "POLICY_CONFLICT" : "COMPLIANT",
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    evidenceIds: facts.advancePaymentRatio > facts.policyLimitRatio
      ? ["contract-payment", "policy-limit"]
      : ["contract-payment", "policy-limit"],
  };
}
```

- [ ] **Step 4: Run tests and type check**

Run: `bun test packages/audit/src/payment-rule.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/audit/src/model.ts packages/audit/src/payment-rule.ts packages/audit/src/payment-rule.test.ts
git commit -m "feat: add deterministic advance payment rule"
```

## Task 3: Normalize pasted text into evidence-bearing audit snapshots

**Files:**
- Create: `packages/audit/src/plaintext-adapter.ts`, `packages/audit/src/plaintext-adapter.test.ts`
- Modify: `packages/audit/src/model.ts`

**Consumes:** `PaymentFacts`, `RuleAssessment`.

**Produces:** `createAuditSnapshot(input): AuditSnapshot`, including `ContractDocument`, Evidence Locators and payment facts.

- [ ] **Step 1: Write failing normalization tests**

```ts
test("anchors the 70% payment term to a stable text span", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "source-1",
    contractText: "乙方签订后支付合同金额的70%作为预付款。",
    policyLimitRatio: 0.3,
  });
  expect(snapshot.facts.advancePaymentRatio).toBe(0.7);
  expect(snapshot.evidence[0]).toMatchObject({ blockId: "p-1", quotedText: "70%" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/audit/src/plaintext-adapter.test.ts`

Expected: FAIL because `createAuditSnapshot` does not exist.

- [ ] **Step 3: Implement a narrow, explicit parser**

Use a single regular expression `/([0-9]+(?:\\.[0-9]+)?)%/u` for the MVP and reject text containing no percentage with `ContractNormalizationError`. Build a paragraph block ID from input order and create this locator shape:

```ts
export interface EvidenceLocator {
  sourceRecordId: string;
  contractDocumentHash: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
}
```

Compute the document hash with `Bun.CryptoHasher("sha256")`. Preserve Unicode code-point offsets by using `Array.from(blockText)` when locating the matched percentage.

- [ ] **Step 4: Run tests**

Run: `bun test packages/audit/src/plaintext-adapter.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/audit/src/model.ts packages/audit/src/plaintext-adapter.ts packages/audit/src/plaintext-adapter.test.ts
git commit -m "feat: normalize text into audit snapshots"
```

## Task 4: Persist audit cases and immutable revisions with Drizzle

**Files:**
- Create: `apps/api/src/db/schema.ts`, `apps/api/src/db/repositories.ts`, `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/repositories.test.ts`

**Consumes:** `AuditSnapshot`, `RuleAssessment`.

**Produces:** `AuditCaseRepository` with `createPendingCase`, `claimNextPendingCase`, `completeAgentRun`, `appendFindingRevision`, and `markStaleRunsInterrupted`.

- [ ] **Step 1: Write repository contract tests**

```ts
test("claims only one pending audit case", async () => {
  await repository.createPendingCase(seedSnapshot);
  expect(await repository.claimNextPendingCase()).toMatchObject({ status: "RUNNING" });
  expect(await repository.claimNextPendingCase()).toBeNull();
});

test("appends a human review without overwriting the proposal", async () => {
  const proposal = await repository.appendFindingRevision(seedProposal);
  const review = await repository.appendFindingRevision({ ...seedReview, supersedesId: proposal.id });
  expect(review.supersedesId).toBe(proposal.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/api/src/db/repositories.test.ts`

Expected: FAIL because the repository and database schema do not exist.

- [ ] **Step 3: Create the five MVP tables**

Use UUID primary keys and UTC timestamps. Store immutable source text in `source_records`; status/stage in `audit_cases`; normalized document/facts/policy data in `audit_snapshots` JSONB; model/version/usage/error metadata in `agent_runs`; and proposal/review payloads plus `supersedes_id` in `finding_revisions`. Use `SELECT ... FOR UPDATE SKIP LOCKED` in `claimNextPendingCase` so the single-dispatcher invariant has a safe path if concurrency is raised later.

- [ ] **Step 4: Apply migration and run tests**

Run: `docker compose up -d postgres && bun --filter @contract-audit/api drizzle-kit generate && bun --filter @contract-audit/api drizzle-kit migrate && bun test apps/api/src/db/repositories.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db apps/api/drizzle.config.ts apps/api/drizzle
git commit -m "feat: persist audit cases and finding revisions"
```

## Task 5: Prove Bun/Pi compatibility and implement the Agent port

**Files:**
- Create: `packages/pi-agent/src/config.ts`, `packages/pi-agent/src/runtime.ts`, `packages/pi-agent/src/tools.ts`
- Create: `packages/pi-agent/src/runtime.test.ts`, `packages/pi-agent/src/payment-terms-audit.skill.md`

**Consumes:** `AuditSnapshot`, `RuleAssessment`, `EvidenceLocator`.

**Produces:** `PiAuditAgent.run(input, signal): Promise<FindingProposal>` and `FakeAuditAgent` for tests.

- [ ] **Step 1: Write a no-tool smoke test and a fake-agent unit test**

```ts
test("creates and disposes a Pi session under Bun", async () => {
  const session = await createSmokeTestSession();
  session.dispose();
});

test("rejects a proposal with an unknown evidence locator", async () => {
  await expect(fakeAgent.run(snapshotWithUnknownEvidence, AbortSignal.timeout(100))).rejects.toThrow("UNKNOWN_EVIDENCE");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/pi-agent/src/runtime.test.ts`

Expected: FAIL because the Pi adapter is absent.

- [ ] **Step 3: Implement explicit Pi configuration and allowlisted tools**

Load `XYG_ENDPOINT`, `XYG_API_KEY`, `XYG_MODEL`, `XYG_MAX_INPUT`, and `XYG_MAX_OUTPUT` in `config.ts`; reject missing configuration with `LLM_NOT_CONFIGURED`. Register the provider as OpenAI-compatible and pin `@earendil-works/pi-coding-agent` to `0.85.1`.

Create only these TypeBox-validated tools:

```ts
get_rule_assessment(): RuleAssessment
get_evidence({ evidenceIds: string[] }): EvidenceLocator[]
submit_finding_proposal({
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT" | "NEEDS_HUMAN_REVIEW";
  severity: "LOW" | "MEDIUM" | "HIGH";
  rationale: string;
  evidenceIds: string[];
  remediation: string;
}): { accepted: true }
```

Call `createAgentSession` with `SessionManager.inMemory()`, no built-in tools, the custom tools, and the payment audit Skill. Validate every submitted `evidenceIds` value against the immutable snapshot before returning `{ accepted: true }`.

- [ ] **Step 4: Run tests and the manual credential smoke test**

Run: `bun test packages/pi-agent/src/runtime.test.ts && bun run typecheck`

Then, with configured credentials: `cd packages/pi-agent && bun run smoke`

Expected: unit tests PASS; smoke test creates a no-tool session and exits without API-key leakage.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-agent package.json bun.lock
git commit -m "feat: add constrained Pi audit runtime"
```

## Task 6: Orchestrate audit execution, cancellation and product events

**Files:**
- Create: `apps/api/src/dispatcher.ts`, `apps/api/src/sse.ts`, `apps/api/src/dispatcher.test.ts`
- Modify: `packages/audit/src/ports.ts`, `apps/api/src/db/repositories.ts`

**Consumes:** `AuditCaseRepository`, `PiAuditAgent`.

**Produces:** `AuditDispatcher.start()`, `AuditDispatcher.cancel(auditCaseId)`, and `AuditEventBroker.subscribe(auditCaseId)`.

- [ ] **Step 1: Write failing dispatcher tests**

```ts
test("does not run more than one audit when concurrency is one", async () => {
  await dispatcher.enqueue("case-a");
  await dispatcher.enqueue("case-b");
  expect(agent.startedCaseIds).toEqual(["case-a"]);
});

test("marks an active run cancelled after explicit cancellation", async () => {
  await dispatcher.cancel("case-a");
  expect(agent.abortCalls).toBe(1);
  expect(await repository.getCase("case-a")).toMatchObject({ status: "CANCELLED" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/api/src/dispatcher.test.ts`

Expected: FAIL because the dispatcher does not exist.

- [ ] **Step 3: Implement lifecycle-safe dispatching**

Maintain `Map<string, AgentSession>` for active sessions. Publish only product events such as `audit.started`, `rules.completed`, `agent.started`, `finding.proposed`, `audit.awaiting_review`, `audit.failed`, and `audit.completed`.

In the Agent Run path, use this cleanup order:

```ts
try {
  await session.prompt(prompt);
} finally {
  unsubscribe();
  activeSessions.delete(agentRunId);
  session.dispose();
}
```

For cancellation, first await `session.abort()` and then allow `finally` to dispose. Wrap event forwarding in `try/catch`; Pi session listeners are synchronous and must never be blocked by SSE clients.

- [ ] **Step 4: Run tests**

Run: `bun test apps/api/src/dispatcher.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dispatcher.ts apps/api/src/sse.ts apps/api/src/dispatcher.test.ts packages/audit/src/ports.ts apps/api/src/db/repositories.ts
git commit -m "feat: orchestrate audit runs and cancellation"
```

## Task 7: Expose Elysia REST, SSE and OpenAPI endpoints

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/routes/audit-cases.ts`, `apps/api/src/routes/findings.ts`, `apps/api/src/app.test.ts`

**Consumes:** `AuditDispatcher`, `AuditCaseRepository`, `AuditEventBroker`.

**Produces:** exported Elysia `app` type for Eden Treaty and the agreed API surface.

- [ ] **Step 1: Write failing HTTP tests**

```ts
test("creates a pending case and returns 202", async () => {
  const response = await app.handle(new Request("http://localhost/api/audit-cases", {
    method: "POST",
    body: JSON.stringify({ source: "text", contractText: demoContractText }),
    headers: { "content-type": "application/json" },
  }));
  expect(response.status).toBe(202);
});

test("rejects a review for an unknown finding", async () => {
  const response = await app.handle(new Request("http://localhost/api/findings/missing/reviews", { method: "POST" }));
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/api/src/app.test.ts`

Expected: FAIL because `app` is missing.

- [ ] **Step 3: Implement routes with Elysia schemas**

Use Elysia `t.Object` schemas for request and response DTOs. Register `@elysiajs/openapi`; expose `/openapi` and Scalar. The SSE route must immediately emit the latest case snapshot, then relay product events until the request abort signal fires. Do not expose Pi event names, raw tool args, thought content, transcript, or API configuration.

- [ ] **Step 4: Run HTTP tests**

Run: `bun test apps/api/src/app.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/routes apps/api/src/app.test.ts
git commit -m "feat: expose audit REST and SSE API"
```

## Task 8: Build the two-page React workbench

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/app.tsx`, `apps/web/src/api.ts`
- Create: `apps/web/src/routes/audit-cases.tsx`, `apps/web/src/routes/audit-case-detail.tsx`
- Test: `tests/acceptance/audit-case.spec.ts`

**Consumes:** Elysia `App` type through Eden Treaty and the REST/SSE API.

**Produces:** `/audit-cases` create/list route and `/audit-cases/:id` live detail/review route.

- [ ] **Step 1: Write the failing Playwright acceptance test**

```ts
test("creates, reviews, and retains a payment-risk finding", async ({ page }) => {
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("button", { name: "开始审计" }).click();
  await expect(page.getByText("预付款比例高于制度上限")).toBeVisible();
  await page.getByRole("button", { name: "接受" }).click();
  await page.reload();
  await expect(page.getByText("已接受")).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx playwright test tests/acceptance/audit-case.spec.ts`

Expected: FAIL because the web application does not exist.

- [ ] **Step 3: Implement the workbench**

Create an Ant Design form with a demo-load button and textarea. On submission, call `POST /api/audit-cases`, navigate to its detail route, fetch the snapshot, and open `EventSource` for progress. Render the rule assessment, evidence quote, Pi proposal, status/stage, and Accept/Reject controls. On EventSource error, refetch the case snapshot rather than replaying history.

- [ ] **Step 4: Run acceptance test**

Run: `bunx playwright test tests/acceptance/audit-case.spec.ts`

Expected: PASS with `FakeAuditAgent`; run a separate manual session with real Pi credentials before declaring the agent integration complete.

- [ ] **Step 5: Commit**

```bash
git add apps/web tests/acceptance
git commit -m "feat: add audit workbench and review flow"
```

## Task 9: Verify production-shaped local operation

**Files:**
- Create: `apps/api/Dockerfile`, `docs/runbook/mvp-local.md`
- Modify: `README.md`, `compose.yaml`

**Consumes:** complete workspace, database migration, API and web applications.

**Produces:** reproducible local verification instructions and an API container build.

- [ ] **Step 1: Write a failing health check script**

Create `apps/api/src/health.test.ts`:

```ts
test("reports database and dispatcher readiness", async () => {
  const response = await app.handle(new Request("http://localhost/api/health"));
  expect(await response.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/api/src/health.test.ts`

Expected: FAIL until the health route verifies its repository connection and dispatcher start state.

- [ ] **Step 3: Implement verification assets**

Add `/api/health`; create an API Dockerfile using the pinned Bun base image; document these exact commands in `docs/runbook/mvp-local.md`:

```bash
cp .env.example .env
docker compose up -d postgres
bun install
bun --filter @contract-audit/api drizzle-kit migrate
bun run typecheck
bun test
bunx playwright test
```

- [ ] **Step 4: Run the complete verification**

Run: `docker compose up -d postgres && bun install && bun run typecheck && bun test && bunx playwright test && docker build -f apps/api/Dockerfile -t contract-audit-api .`

Expected: every check passes and the image builds without copying `.env`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/api/src/health.test.ts docs/runbook/mvp-local.md README.md compose.yaml
git commit -m "docs: add local MVP verification runbook"
```

## Self-Review

### Spec coverage

- Bun/Elysia/React/Drizzle/SSE/Pi implementation: Tasks 1, 4, 5, 6, 7 and 8.
- One deterministic advance-payment vertical slice: Tasks 2 and 3.
- Pi Tools, Skill and bounded evidence: Task 5.
- PostgreSQL persistence and append-only reviews: Task 4.
- Two-page UI, SSE, acceptance/rejection: Tasks 7 and 8.
- Configuration, Docker and the Bun/Pi compatibility gate: Tasks 1, 5 and 9.
- Explicit exclusions are not represented by implementation tasks.

### Placeholder scan

The plan uses no deferred implementation marker. Each task names files, interfaces, test commands and an observable expected outcome.

### Type consistency

`AuditSnapshot` is produced in Task 3, persisted in Task 4, consumed by the Pi Agent in Task 5, orchestrated in Task 6, returned through Task 7, and displayed in Task 8. `FindingProposal` is validated by the Tool in Task 5, persisted as a `finding_revision` in Task 4, and reviewed through Task 7 and Task 8.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-11-contract-audit-mvp.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, with checkpoints between tasks.
