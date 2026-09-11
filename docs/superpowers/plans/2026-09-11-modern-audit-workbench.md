# Modern Audit Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare two-page frontend with the approved Modern Authority audit command center and decision-first review workbench, wiring every existing audit action and making both review decisions terminal.

**Architecture:** Keep TanStack Query as the server-state owner and keep route components responsible for queries and mutations. Introduce one pure presentation module that translates domain lifecycle values into user-facing state, focused view components for the shell, queue, creation flow, and review flow, and one shared CSS/token system layered over Ant Design 6.6.3. Preserve the existing Elysia/Eden boundary; the only backend behavior change makes `REJECTED` review completion match `ACCEPTED` completion.

**Tech Stack:** Bun 1.3.14, TypeScript, React 19, Vite 6, Ant Design 6.6.3, `@ant-design/icons` 6.3.4, TanStack Router, TanStack Query, Eden Treaty, Elysia, Bun Test, Playwright.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-09-11-modern-audit-workbench-design.md`.
- Do not execute this plan until the user has switched models and explicitly asks for implementation.
- At execution start, invoke `using-git-worktrees` and implement in an isolated worktree because the current workspace contains unrelated changes.
- Preserve unrelated changes if they appear in this worktree, especially `apps/api/package.json`, `apps/api/start.sh`, `diag-pi.ts`, and `.superpowers/`; `README.md`, the root `package.json`, and the web package files are explicitly in scope for this Ant Design v6 upgrade.
- Use exact-path `git add` commands from each task; never stage the whole worktree.
- Add no runtime dependency and do not migrate to Next.js, shadcn/ui, Tailwind, Geist components, or a web font. TypeScript remains a root development dependency so the existing `bun run typecheck` script is reproducible.
- Use `antd@^6.6.3` with `@ant-design/icons@^6.3.4`; React 19 satisfies the v6 peer requirement.
- Treat the v5-to-v6 migration as part of this plan: use `Space.orientation`, `Descriptions.items`, `Alert.title`, `Drawer.size` plus `mask.closable`, contextual `App.useApp()` feedback, and `Listy` instead of deprecated `List`.
- Do not add `@ant-design/v5-patch-for-react-19`; Ant Design v6 supports React 19 directly.
- Show no list-level severity, contract title, user, navigation destination, or live datum unavailable from the API.
- Never fetch every case detail to enrich the list; summary values come from `GET /api/audit-cases` only.
- Use one root Ant Design `ConfigProvider`; theme with tokens first and project CSS classes second. Never target internal `.ant-*` selectors.
- Before editing a component, run `antd info <Component> --version 6.6.3 --format json`. After each frontend task, run `antd lint <changed-path> --format json`.
- Preserve visible focus, semantic landmarks, text-plus-color status cues, 4.5:1 text contrast, reduced-motion behavior, and 44×44 px mobile targets.
- Verify at 375, 768, 1024, and 1440 CSS pixels without horizontal page overflow.
- All status and stage copy shown to users is Chinese; wire values remain unchanged.

## Ant Design v6 Migration Gate

The workbench is implemented against the current stable Ant Design v6 line, not the v5 API surface that the original plan was written against. Before any frontend task changes code, query the exact v6.6.3 component API with `antd info <Component> --version 6.6.3 --format json`.

The migration rules for this worktree are concrete:

- `Space direction="vertical"` becomes `Space orientation="vertical"`.
- `Descriptions.Item` children become a `Descriptions items` array with `{ key, label, children }` entries.
- `Alert message="..."` becomes `Alert title="..."` when the value is the alert heading.
- Static `message.error/warning/success` imports are forbidden; routes call `const { message } = App.useApp()` inside the root `App` provider.
- The deprecated `List` component becomes `Listy`; use `items`, `rowKey`, and `itemRender`, and render `Empty` explicitly when the collection is empty because `Listy` has no `locale.emptyText` prop.
- `Drawer width`/`maskClosable` examples use v6 `size`/`mask={{ closable }}`.

After each changed frontend path, run `antd lint <changed-path> --format json`. The final frontend check must report zero deprecated and usage findings, followed by `bun run typecheck` and the focused Playwright flows.

## File Structure

- `apps/api/src/routes/findings.ts` — terminal review transition for both review decisions.
- `apps/api/src/app.test.ts` — API state-transition regression coverage.
- `apps/web/src/api.ts` — one API origin, typed request errors, creation input, health, cancel/retry, and SSE URL.
- `apps/web/src/audit-presentation.ts` — pure domain-to-product lifecycle mapping, queue filtering, sorting, statistics, and step state.
- `apps/web/src/audit-presentation.test.ts` — lifecycle precedence and derived queue behavior.
- `apps/web/src/theme.ts` — the single Ant Design theme configuration.
- `apps/web/src/styles.css` — Modern Authority tokens, shell/layout styles, responsive adaptations, focus, and reduced motion.
- `apps/web/src/components/app-shell.tsx` — semantic shell, real navigation, API health, and responsive chrome.
- `apps/web/src/components/audit-state-badge.tsx` — shared text-plus-tone lifecycle presentation.
- `apps/web/src/components/new-audit-drawer.tsx` — validated contract text and policy threshold form.
- `apps/web/src/components/audit-queue.tsx` — summary strip, queue controls, desktop table, mobile cards, and state actions.
- `apps/web/src/components/review-drawer.tsx` — explicit accept/reject confirmation and reason validation.
- `apps/web/src/components/audit-case-workbench.tsx` — detail header, progress, state-specific body, evidence, Finding, and sticky review actions.
- `apps/web/src/hooks/use-audit-events.ts` — SSE connection lifecycle and refetch callback.
- `apps/web/src/hooks/use-media-query.ts` — one responsive-rendering decision without offscreen interactive duplicates.
- `apps/web/src/main.tsx` — root provider composition and stylesheet import.
- `apps/web/src/app.tsx` — shell route composition.
- `apps/web/src/routes/audit-cases.tsx` — queue query/mutation orchestration and creation drawer state.
- `apps/web/src/routes/audit-case-detail.tsx` — detail query/mutation orchestration and event subscription.
- `apps/web/index.html` — product title.
- `tests/acceptance/audit-case.spec.ts` — creation, accept, reject, reason, persistence, and shell behavior.
- `tests/acceptance/audit-queue.spec.ts` — deterministic queue filtering, action availability, cancel/retry, and mobile overflow behavior.
- `CHANGELOG.md` — observed user-facing changes and exact final verification evidence, updated only after verification passes.

---

### Task 1: Make Both Human Decisions Terminal

**Files:**
- Modify: `apps/api/src/routes/findings.ts:15-43`
- Modify: `apps/api/src/app.test.ts:58-92`

**Interfaces:**
- Consumes: `AuditCaseRepository.appendReviewRevision()`, `AuditCaseRepository.updateCaseStatus()`, and `AuditEventBroker.publish()`.
- Produces: `POST /api/findings/:id/reviews` records either decision, updates the case to `{ status: "COMPLETED", stage: "COMPLETED" }`, and only then publishes `audit.completed`.

- [ ] **Step 1: Add the rejected-review state-transition test**

First extend the existing accepted-review test so it also protects the terminal state:

```ts
expect(await repository.getCase(caseId)).toMatchObject({
  status: "COMPLETED",
  stage: "COMPLETED",
});
```

Then add a rejected-review test beside it. The new test must assert the recorded reason, terminal case state, and completion event:

```ts
test("completes a rejected human review", async () => {
  const { caseId } = await repository.createPendingCase("source-rejected", snapshotStub());
  const findingId = await repository.appendFindingRevision(caseId, {
    findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "Advance payment exceeds the policy limit",
    evidenceIds: ["contract-payment"],
    remediation: "Reduce the advance payment ratio",
  }, null);

  const response = await app.handle(json("POST", `/api/findings/${findingId}/reviews`, {
    decision: "REJECTED",
    reason: "Evidence does not support the proposed severity",
  }));

  expect(response.status).toBe(200);
  expect((await repository.getFindingsByCase(caseId))[0].review).toMatchObject({
    decision: "REJECTED",
    reason: "Evidence does not support the proposed severity",
  });
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "COMPLETED",
    stage: "COMPLETED",
  });
  expect(broker.events.at(-1)).toMatchObject({
    type: "audit.completed",
    auditCaseId: caseId,
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the current asymmetry**

Run:

```bash
bun test apps/api/src/app.test.ts -t "completes a rejected human review"
```

Expected: FAIL because the rejected review is persisted but the case remains `PENDING`/`QUEUED` in the in-memory repository and no completion event is published.

- [ ] **Step 3: Remove the acceptance-only completion branch**

After `appendReviewRevision()` succeeds, make completion unconditional:

```ts
await repository.updateCaseStatus(finding.auditCaseId, "COMPLETED", "COMPLETED");
broker.publish({ type: "audit.completed", auditCaseId: finding.auditCaseId });
return { id: params.id, reviewed: true as const };
```

Delete the `if (body.decision === "ACCEPTED")` wrapper. Do not change unknown-Finding or duplicate-review behavior.

- [ ] **Step 4: Run all API route tests**

Run:

```bash
bun test apps/api/src/app.test.ts
```

Expected: every route test passes, including accepted review, rejected review, duplicate review, create, and detail behavior.

- [ ] **Step 5: Commit the transition correction**

```bash
git add apps/api/src/routes/findings.ts apps/api/src/app.test.ts
git commit -m "fix: complete rejected audit reviews"
```

---

### Task 2: Define the Frontend Presentation and API Contracts

**Files:**
- Create: `apps/web/src/audit-presentation.ts`
- Create: `apps/web/src/audit-presentation.test.ts`
- Modify: `apps/web/src/api.ts:1-52`

**Interfaces:**
- Consumes: `AuditCase`, `AuditCaseStatus`, and `AuditStage` from `@contract-audit/audit/model`; existing Eden `createApp` typing.
- Produces:
  - `ApiRequestError { status: number }`
  - `CreateAuditCaseInput { contractText: string; policyLimitRatio: number }`
  - `API_BASE_URL: string`
  - `createAuditCase(input)`, `getApiHealth()`, `getAuditEventsUrl(id)`, `cancelAuditCase(id)`, `retryAuditCase(id)`, and existing list/detail/review calls
  - `AuditLifecycleFilter`, `AuditDisplayState`, `AuditQueueStats`
  - `getAuditDisplayState()`, `getAuditStageLabel()`, `getAuditStep()`, `getAvailableCaseActions()`, `deriveQueueStats()`, and `filterAndSortCases()`

- [ ] **Step 1: Write lifecycle precedence and queue derivation tests**

Create `apps/web/src/audit-presentation.test.ts` with fixed timestamps and explicit cases:

```ts
import { expect, test } from "bun:test";
import type { AuditCase } from "@contract-audit/audit/model";
import {
  deriveQueueStats,
  filterAndSortCases,
  getAuditDisplayState,
  getAvailableCaseActions,
} from "./audit-presentation";

const caseAt = (
  id: string,
  status: AuditCase["status"],
  stage: AuditCase["stage"],
  updatedAt: string,
): AuditCase => ({
  id,
  status,
  stage,
  sourceRecordId: `source-${id}`,
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt,
});

test("awaiting review wins over the completed machine status", () => {
  const auditCase = caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z");
  expect(getAuditDisplayState(auditCase)).toMatchObject({ key: "AWAITING_REVIEW", label: "待复核" });
  expect(getAvailableCaseActions(auditCase)).toEqual(["VIEW"]);
});

test("derives only statistics available from case rows", () => {
  const cases = [
    caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z"),
    caseAt("pending", "PENDING", "QUEUED", "2026-09-11T09:10:00.000Z"),
    caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T09:20:00.000Z"),
    caseAt("failed", "FAILED", "FAILED", "2026-09-11T09:30:00.000Z"),
    caseAt("interrupted", "INTERRUPTED", "INTERRUPTED", "2026-09-10T09:30:00.000Z"),
    caseAt("done", "COMPLETED", "COMPLETED", "2026-09-11T09:40:00.000Z"),
  ];
  expect(deriveQueueStats(cases, new Date("2026-09-11T12:00:00.000Z"))).toEqual({
    awaitingReview: 1,
    processing: 2,
    abnormal: 2,
    completedToday: 1,
  });
});

test("filters by product lifecycle and sorts by latest update", () => {
  const cases = [
    caseAt("older-failure", "FAILED", "FAILED", "2026-09-11T08:00:00.000Z"),
    caseAt("newer-interruption", "INTERRUPTED", "INTERRUPTED", "2026-09-11T10:00:00.000Z"),
    caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T11:00:00.000Z"),
  ];
  expect(filterAndSortCases(cases, "ABNORMAL", "").map(({ id }) => id)).toEqual([
    "newer-interruption",
    "older-failure",
  ]);
  expect(filterAndSortCases(cases, "ALL", "RUN").map(({ id }) => id)).toEqual(["running"]);
});
```

- [ ] **Step 2: Run the pure tests and verify the module is missing**

Run:

```bash
bun test apps/web/src/audit-presentation.test.ts
```

Expected: FAIL because `audit-presentation.ts` does not exist.

- [ ] **Step 3: Implement one authoritative lifecycle mapping**

Create `audit-presentation.ts` with these public types and keys:

```ts
import type { AuditCase, AuditCaseStatus, AuditStage } from "@contract-audit/audit/model";

export type AuditLifecycleFilter =
  | "ALL"
  | "AWAITING_REVIEW"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "ABNORMAL";
export type AuditCaseAction = "VIEW" | "CANCEL" | "RETRY";
export type AuditTone = "neutral" | "info" | "warning" | "danger" | "success";
export type AuditDisplayKey = AuditCaseStatus | "AWAITING_REVIEW";

export interface AuditDisplayState {
  key: AuditDisplayKey;
  label: string;
  tone: AuditTone;
}

export interface AuditQueueStats {
  awaitingReview: number;
  processing: number;
  abnormal: number;
  completedToday: number;
}

const displayStates: Record<AuditDisplayKey, Omit<AuditDisplayState, "key">> = {
  PENDING: { label: "排队中", tone: "info" },
  RUNNING: { label: "审计中", tone: "warning" },
  AWAITING_REVIEW: { label: "待复核", tone: "info" },
  COMPLETED: { label: "已完成", tone: "success" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  INTERRUPTED: { label: "已中断", tone: "warning" },
};

export function getAuditDisplayState(auditCase: AuditCase): AuditDisplayState {
  const key: AuditDisplayKey = auditCase.stage === "AWAITING_REVIEW"
    ? "AWAITING_REVIEW"
    : auditCase.status;
  return { key, ...displayStates[key] };
}

export const getAuditStageLabel = (stage: AuditStage): string => ({
  QUEUED: "等待处理",
  NORMALIZING: "合同规范化",
  RULE_ASSESSMENT: "规则评估",
  AGENT_RUNNING: "Agent 分析",
  AWAITING_REVIEW: "人工复核",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断",
})[stage];

export function getAuditStep(auditCase: AuditCase): number {
  if (auditCase.stage === "COMPLETED") return 4;
  if (auditCase.stage === "AWAITING_REVIEW") return 3;
  if (auditCase.stage === "AGENT_RUNNING") return 2;
  if (auditCase.stage === "RULE_ASSESSMENT" || auditCase.stage === "NORMALIZING") return 1;
  return 0;
}

const retryableStatuses = new Set<AuditCaseStatus>(["FAILED", "CANCELLED", "INTERRUPTED"]);

export function getAvailableCaseActions(auditCase: AuditCase): AuditCaseAction[] {
  if (auditCase.stage === "AWAITING_REVIEW" || auditCase.stage === "COMPLETED") return ["VIEW"];
  if (auditCase.status === "PENDING" || auditCase.status === "RUNNING") return ["VIEW", "CANCEL"];
  if (retryableStatuses.has(auditCase.status)) return ["VIEW", "RETRY"];
  return ["VIEW"];
}

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

export function deriveQueueStats(cases: AuditCase[], now = new Date()): AuditQueueStats {
  return cases.reduce<AuditQueueStats>((stats, auditCase) => {
    const displayKey = getAuditDisplayState(auditCase).key;
    if (displayKey === "AWAITING_REVIEW") stats.awaitingReview += 1;
    if (displayKey === "PENDING" || displayKey === "RUNNING") stats.processing += 1;
    if (displayKey === "FAILED" || displayKey === "INTERRUPTED") stats.abnormal += 1;
    if (
      displayKey === "COMPLETED"
      && sameLocalDay(new Date(auditCase.updatedAt), now)
    ) {
      stats.completedToday += 1;
    }
    return stats;
  }, { awaitingReview: 0, processing: 0, abnormal: 0, completedToday: 0 });
}

const matchesLifecycle = (auditCase: AuditCase, filter: AuditLifecycleFilter): boolean => {
  const displayKey = getAuditDisplayState(auditCase).key;
  switch (filter) {
    case "ALL": return true;
    case "AWAITING_REVIEW": return displayKey === "AWAITING_REVIEW";
    case "PROCESSING": return displayKey === "PENDING" || displayKey === "RUNNING";
    case "COMPLETED": return displayKey === "COMPLETED";
    case "CANCELLED": return displayKey === "CANCELLED";
    case "ABNORMAL": return displayKey === "FAILED" || displayKey === "INTERRUPTED";
  }
};

export function filterAndSortCases(
  cases: AuditCase[],
  filter: AuditLifecycleFilter,
  search: string,
): AuditCase[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return cases
    .filter((auditCase) =>
      matchesLifecycle(auditCase, filter)
      && auditCase.id.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
```

Do not introduce severity, contract-title, or detail fetches into these helpers.

- [ ] **Step 4: Run the presentation tests**

Run:

```bash
bun test apps/web/src/audit-presentation.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Centralize API origin, request errors, and action calls**

Replace positional creation arguments and preserve the existing Eden calls:

```ts
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const api = treaty<ReturnType<typeof createApp>>(API_BASE_URL);

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface CreateAuditCaseInput {
  contractText: string;
  policyLimitRatio: number;
}

export async function createAuditCase({ contractText, policyLimitRatio }: CreateAuditCaseInput) {
  const { data, error } = await api.api["audit-cases"].post({
    source: "text",
    contractText,
    policyLimitRatio,
  });
  if (error) throw new ApiRequestError("创建审计失败", error.status);
  return data;
}

export async function getApiHealth(): Promise<"ok" | "unavailable"> {
  const { data, error } = await api.api.health.get();
  if (error || !data) return "unavailable";
  return data.status;
}

export function getAuditEventsUrl(id: string): string {
  return `${API_BASE_URL}/api/audit-cases/${encodeURIComponent(id)}/events`;
}
```

Make `getAuditCases()`, `getAuditCase()`, `submitReview()`, `cancelAuditCase()`, and `retryAuditCase()` throw `ApiRequestError` with their safe Chinese operation label and `error.status`. This lets the review route distinguish 409 without parsing message text.

- [ ] **Step 6: Run frontend type checking and the pure tests**

Run:

```bash
bun test apps/web/src/audit-presentation.test.ts && bun run typecheck
```

Expected: presentation tests pass and TypeScript is clean after callers are migrated in the same change to `createAuditCase({ contractText, policyLimitRatio })` with the current 30% default.

- [ ] **Step 7: Commit the contracts**

```bash
git add apps/web/src/api.ts apps/web/src/audit-presentation.ts apps/web/src/audit-presentation.test.ts apps/web/src/routes/audit-cases.tsx
git commit -m "feat: define audit workbench presentation model"
```

---

### Task 3: Establish the Modern Authority Theme and Application Shell

**Files:**
- Create: `apps/web/src/theme.ts`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/components/audit-state-badge.tsx`
- Modify: `apps/web/src/main.tsx:1-12`
- Modify: `apps/web/src/app.tsx:1-56`
- Modify: `apps/web/index.html:1-12`
- Modify: `tests/acceptance/audit-case.spec.ts:3-12`

**Interfaces:**
- Consumes: `getApiHealth()`, `getAuditDisplayState()`, TanStack Router `Link`/`Outlet`, and Ant Design provider APIs.
- Produces: `appTheme`, `AppShell`, `AuditStateBadge`, global CSS variables/classes, and semantic `banner`, `navigation`, and `main` landmarks around both routes.

- [ ] **Step 1: Query exact Ant Design APIs used by the shell**

Run:

```bash
antd info ConfigProvider --version 6.6.3 --format json
antd info App --version 6.6.3 --format json
antd info Button --version 6.6.3 --format json
antd info Tooltip --version 6.6.3 --format json
```

Expected: JSON output confirms `ConfigProvider.theme`, `App`, documented button props, and Tooltip accessible title support for Ant Design 6.6.3. The v6 provider is rendered as one root `ConfigProvider` wrapping `App`.

- [ ] **Step 2: Extend the real acceptance path with shell landmarks**

At the start of the existing acceptance test, after `page.goto("/audit-cases")`, add:

```ts
await expect(page.getByRole("banner")).toBeVisible();
await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
await expect(page.getByRole("link", { name: "审计工作台" })).toBeVisible();
await expect(page.getByRole("heading", { name: "审计队列" })).toBeVisible();
```

- [ ] **Step 3: Run the acceptance test and verify the shell is absent**

Run:

```bash
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: FAIL at the missing banner/navigation or the missing “审计队列” heading.

- [ ] **Step 4: Define the root theme**

Create `theme.ts` with a `ThemeConfig` that maps the approved tokens:

```ts
import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#18181b",
    colorInfo: "#0369a1",
    colorSuccess: "#15803d",
    colorWarning: "#a16207",
    colorError: "#b91c1c",
    colorText: "#18181b",
    colorTextSecondary: "#71717a",
    colorBorder: "#e4e4e7",
    colorBgLayout: "#f7f8fa",
    colorBgContainer: "#ffffff",
    borderRadius: 6,
    borderRadiusLG: 10,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    lineHeight: 1.5,
    controlHeight: 36,
  },
  components: {
    Button: { primaryShadow: "none", defaultShadow: "none" },
    Card: { boxShadow: "none", boxShadowTertiary: "none" },
    Table: { headerBg: "#fafafa", headerColor: "#71717a", rowHoverBg: "#fafafa" },
  },
};
```

- [ ] **Step 5: Compose providers once and import global CSS**

Update `main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AppRouter } from "./app";
import { appTheme } from "./theme";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AntApp>
        <AppRouter />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
```

Change the document title to `合同审计工作台`.

- [ ] **Step 6: Implement semantic shell and real navigation only**

`AppShell` must render:

```tsx
const health = healthQuery.data ?? "checking";
const healthLabel = {
  checking: "正在检查服务",
  ok: "服务正常",
  unavailable: "服务不可用",
}[health];

return (
<div className="app-shell">
  <aside className="app-sidebar">
    <Link className="app-brand" to="/audit-cases" aria-label="合同审计工作台首页">
      <span className="app-brand-mark" aria-hidden="true">审</span>
      <span>Contract Audit</span>
    </Link>
    <nav aria-label="主导航">
      <Link className="app-nav-link" to="/audit-cases" activeProps={{ "aria-current": "page" }}>
        <AuditOutlined aria-hidden="true" />
        <span>审计工作台</span>
      </Link>
    </nav>
  </aside>
  <div className="app-frame">
    <header className="app-header">
      <span className="app-header-title">合同审计工作台</span>
      <span
        className={`health-indicator health-indicator--${health}`}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" className="health-indicator__dot" />
        {healthLabel}
      </span>
    </header>
    <main className="app-main"><Outlet /></main>
  </div>
  </div>
);
```

Use `useQuery({ queryKey: ["api-health"], queryFn: getApiHealth, refetchInterval: 30_000 })`. Do not add Rules or Settings links.

Change the root route in `app.tsx` from a bare `<Outlet />` to `<AppShell />`.

- [ ] **Step 7: Add the shell and token CSS**

Define `:root` variables for all approved colors and spacing, `box-sizing: border-box`, body margin/background/font, visible `:focus-visible`, the 190 px desktop sidebar, 54 px header, and max 1200 px content frame. Add these breakpoint contracts now:

```css
@media (max-width: 1023px) {
  .app-shell { grid-template-columns: 68px minmax(0, 1fr); }
  .app-sidebar { width: 68px; }
  .app-brand > span:last-child,
  .app-nav-link > span:last-child { display: none; }
}

@media (max-width: 767px) {
  .app-shell { display: block; }
  .app-sidebar { position: static; width: 100%; height: 56px; flex-direction: row; }
  .app-header { display: none; }
  .app-main { padding: 16px; }
  button, input, textarea { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Use project-owned classes only; do not add `.ant-*` selectors.

- [ ] **Step 8: Implement the shared lifecycle badge**

`AuditStateBadge` accepts `{ auditCase: AuditCase }`, calls `getAuditDisplayState()`, and renders a text label plus an `aria-hidden` tone dot. The CSS must provide distinct neutral/info/warning/danger/success foreground, border, and background pairs with sufficient contrast.

- [ ] **Step 9: Verify shell behavior and Ant Design usage**

Run:

```bash
antd lint apps/web/src --format json
bun run typecheck
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: Ant Design lint returns no a11y/deprecated errors, TypeScript is clean, and the existing audit flow passes with the new landmarks visible.

- [ ] **Step 10: Commit the shell**

```bash
git add apps/web/index.html apps/web/src/main.tsx apps/web/src/app.tsx apps/web/src/theme.ts apps/web/src/styles.css apps/web/src/components/app-shell.tsx apps/web/src/components/audit-state-badge.tsx tests/acceptance/audit-case.spec.ts
git commit -m "feat: add modern audit application shell"
```

---

### Task 4: Move Audit Creation Into a Validated Drawer

**Files:**
- Create: `apps/web/src/components/new-audit-drawer.tsx`
- Modify: `apps/web/src/routes/audit-cases.tsx:1-55`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/acceptance/audit-case.spec.ts`

**Interfaces:**
- Consumes: `CreateAuditCaseInput`, the route-owned create mutation, and Ant Design Drawer/Form/Input/InputNumber APIs.
- Produces: `NewAuditDrawer({ open, submitting, submitError, onClose, onSubmit })` and an accessible “新建审计” flow that sends percentage input as a decimal ratio.

- [ ] **Step 1: Query exact form component APIs**

Run:

```bash
antd info Drawer --version 6.6.3 --format json
antd info Form --version 6.6.3 --format json
antd info Input --version 6.6.3 --format json
antd info InputNumber --version 6.6.3 --format json
```

Expected: JSON confirms `Drawer.open`, `destroyOnHidden`, `footer`, `size`, `mask.closable`, Form validation props, `Input.TextArea.showCount`, and `InputNumber.suffix/min/max/precision`.

- [ ] **Step 2: Change the acceptance path to use the Drawer and explicit policy field**

Replace the direct “加载演示合同” click with:

```ts
await page.getByRole("button", { name: "新建审计" }).click();
await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();
await page.getByRole("button", { name: "开始审计" }).click();
await expect(page.getByText("请输入合同文本")).toBeVisible();
await page.getByRole("button", { name: "加载演示合同" }).click();
await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
await page.getByRole("button", { name: "开始审计" }).click();
```

Keep the existing URL, Finding, review, and reload assertions after submission.

- [ ] **Step 3: Run the acceptance test and verify the Drawer is absent**

Run:

```bash
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: FAIL because “新建审计” and its dialog do not exist.

- [ ] **Step 4: Implement the controlled Drawer contract**

Use this public shape:

```ts
export interface NewAuditDrawerProps {
  open: boolean;
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (input: CreateAuditCaseInput) => void;
}

interface NewAuditFormValues {
  contractText: string;
  policyLimitPercent: number;
}
```

The Drawer uses `size="min(520px, 100vw)"`, `destroyOnHidden`, `mask={{ closable: !submitting }}`, and a stable footer. The Form uses `layout="vertical"`, `validateTrigger="onBlur"`, `scrollToFirstError={{ focus: true }}`, and initial `policyLimitPercent: 30`.

The contract rule is:

```ts
{
  validator: async (_, value: string | undefined) => {
    if (!value?.trim()) throw new Error("请输入合同文本");
  },
}
```

The threshold field uses `min={0}`, `max={100}`, `precision={0}`, `suffix="%"`, and required/range messages. On finish:

```ts
onSubmit({
  contractText: values.contractText.trim(),
  policyLimitRatio: values.policyLimitPercent / 100,
});
```

“加载演示合同” calls `form.setFieldValue("contractText", demoContract)` and never submits.

- [ ] **Step 5: Convert the queue route into data orchestration**

The route owns:

```ts
const [createOpen, setCreateOpen] = useState(false);
const createMutation = useMutation({
  mutationFn: createAuditCase,
  onSuccess: ({ id }) => {
    setCreateOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["audit-cases"] });
    void navigate({ to: "/audit-cases/$id", params: { id } });
  },
});
```

Render the page heading “审计队列,” a “新建审计” button, and the controlled Drawer. Preserve form input after errors; clearing occurs when a successful close destroys the Drawer.

- [ ] **Step 6: Add creation-flow styles and verify**

Add Drawer content spacing, helper copy, `.drawer-footer`, full-width mobile Drawer behavior through `size="min(520px, 100vw)"`, and a stable inline error region with `role="alert"`.

Run:

```bash
antd lint apps/web/src/components/new-audit-drawer.tsx --format json
bun run typecheck
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: validation appears inline, the demo text fills without submitting, 30% is sent, and the browser navigates to the created case.

- [ ] **Step 7: Commit the creation flow**

```bash
git add apps/web/src/components/new-audit-drawer.tsx apps/web/src/routes/audit-cases.tsx apps/web/src/styles.css tests/acceptance/audit-case.spec.ts
git commit -m "feat: add guided audit creation drawer"
```

---

### Task 5: Build the Queue Command Center

**Files:**
- Create: `apps/web/src/components/audit-queue.tsx`
- Create: `apps/web/src/hooks/use-media-query.ts`
- Create: `tests/acceptance/audit-queue.spec.ts`
- Modify: `apps/web/src/routes/audit-cases.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: presentation helpers from Task 2, `AuditStateBadge`, `AuditCase[]`, route navigation, and cancel/retry API calls.
- Produces: `useMediaQuery(query)`, plus `AuditQueue` with summary, search, lifecycle filters, refresh timestamp, one responsive desktop-or-mobile result surface, state-specific actions, and confirmed mutations.

- [ ] **Step 1: Query queue and confirmation component APIs**

Run:

```bash
antd info Table --version 6.6.3 --format json
antd info Segmented --version 6.6.3 --format json
antd info Popconfirm --version 6.6.3 --format json
antd info Result --version 6.6.3 --format json
antd info Skeleton --version 6.6.3 --format json
```

Expected: JSON confirms stable `rowKey`, controlled Segmented value/options, Popconfirm title/description/onConfirm, Result status/extra, and Skeleton loading props.

- [ ] **Step 2: Write deterministic queue interaction tests**

Create `tests/acceptance/audit-queue.spec.ts`. Intercept `**/api/audit-cases` with an in-memory array containing a running case, failed case, interrupted case, waiting-review case, and completed case. For GET return the array; for `/running/cancel` mutate the running row to cancelled; for `/failed/retry` mutate the failed row to pending.

Assert the user-visible contract:

```ts
await page.goto("/audit-cases");
await expect(page.getByText("待复核").first()).toBeVisible();
await expect(page.getByText("处理中").first()).toBeVisible();
await expect(page.getByText("异常").first()).toBeVisible();

await page.getByRole("radio", { name: /异常/ }).click();
await expect(page.getByText("合同审计 failed")).toBeVisible();
await expect(page.getByText("合同审计 interrupted")).toBeVisible();
await expect(page.getByText("合同审计 running")).toBeHidden();

await page.getByRole("radio", { name: /全部/ }).click();
await page.getByPlaceholder("搜索任务 ID").fill("RUNNING");
await expect(page.getByText("合同审计 running")).toBeVisible();
await expect(page.getByText("合同审计 failed")).toBeHidden();
```

In a second test, confirm cancellation and retry, then assert localized “已取消” and “排队中” after the mocked refetch. Use the visible Popconfirm buttons “确认取消” and “确认重试.”

In a third test set `page.setViewportSize({ width: 375, height: 812 })`, assert `getByRole("list", { name: "审计记录" })` is visible, the desktop table is not visible, and:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
```

- [ ] **Step 3: Run the queue tests and verify the command center is missing**

Run:

```bash
bunx playwright test tests/acceptance/audit-queue.spec.ts
```

Expected: FAIL on missing summary/filter labels and mobile audit list.

- [ ] **Step 4: Implement the queue view contract**

Use this prop boundary:

```ts
export interface AuditQueueProps {
  cases: AuditCase[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  action: { id: string; type: "CANCEL" | "RETRY" } | null;
  refreshedAt: Date | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onCreate: () => void;
}
```

Inside `AuditQueue`, keep only search/filter view state. Call `deriveQueueStats()` and `filterAndSortCases()` from Task 2. Render four connected metric cells: 待复核, 处理中, 异常, 今日完成. Do not render high-risk metrics.

State handling is exact: initial load with no rows renders a stable five-row Skeleton; an initial error renders a Result with a “重新加载” button; a successful empty list renders “暂无审计记录” with “新建审计”; a filter with no matches keeps the toolbar and renders “没有匹配的审计记录.” Background refresh and row actions keep current rows visible.

Use a controlled Segmented with values and visible labels `ALL → 全部`, `AWAITING_REVIEW → 待复核`, `PROCESSING → 处理中`, `COMPLETED → 已完成`, `CANCELLED → 已取消`, and `ABNORMAL → 异常`. Keep counts in the four summary cells only.

Create the responsive hook:

```ts
import { useCallback, useMemo, useSyncExternalStore } from "react";

const getServerSnapshot = () => false;

export function useMediaQuery(query: string): boolean {
  const media = useMemo(
    () => typeof window === "undefined" ? null : window.matchMedia(query),
    [query],
  );
  const subscribe = useCallback((notify: () => void) => {
    if (!media) return () => undefined;
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [media]);
  const getSnapshot = useCallback(() => media?.matches ?? false, [media]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

The desktop Table uses `rowKey="id"`, `pagination={{ pageSize: 10, hideOnSinglePage: true }}`, and explicit focusable action buttons. Call `useMediaQuery("(max-width: 767px)")` once. When true, render a semantic `<ul aria-label="审计记录">` populated by `filteredCases.map()` and a private `AuditRecordItem`; when false, render the Table. Each list item contains the same ID, localized lifecycle, stage, update time, and allowed actions as its table row. Render no offscreen interactive duplicate.

- [ ] **Step 5: Wire queue mutations in the route**

Create separate mutations so pending state is scoped by row:

```ts
const { message } = AntApp.useApp();
const cancelMutation = useMutation({ mutationFn: cancelAuditCase });
const retryMutation = useMutation({ mutationFn: retryAuditCase });

const settleAction = async () => {
  await queryClient.invalidateQueries({ queryKey: ["audit-cases"] });
};
```

Import `App as AntApp` from Ant Design and use the contextual `message` instance above; do not import the static message API. Add `onSuccess: settleAction` and safe `message.success()` copy; add `onError` with the operation error. `onRefresh` uses `casesQuery.refetch()` and does not blank existing rows. Pass `casesQuery.dataUpdatedAt ? new Date(casesQuery.dataUpdatedAt) : null` as the refreshed time.

Cancellation is shown only for `PENDING`/`RUNNING`; retry only for `FAILED`/`CANCELLED`/`INTERRUPTED`. Both use Popconfirm with a description of the state change.

- [ ] **Step 6: Implement connected-grid, table, and mobile styles**

Add project classes for `.queue-header`, `.queue-summary`, `.queue-summary__item`, `.queue-surface`, `.queue-toolbar`, `.audit-record`, and `.audit-records-mobile`. Use borders rather than card shadows. At 767 px and below render the semantic card list; retain 44 px action targets. At 768 px and above render the Table.

- [ ] **Step 7: Verify queue behavior**

Run:

```bash
antd lint apps/web/src/components/audit-queue.tsx --format json
bun run typecheck
bunx playwright test tests/acceptance/audit-queue.spec.ts
```

Expected: filters/search work, cancel and retry expose confirmation and update the row state, and the 375 px test has no page overflow.

- [ ] **Step 8: Commit the command center**

```bash
git add apps/web/src/components/audit-queue.tsx apps/web/src/hooks/use-media-query.ts apps/web/src/routes/audit-cases.tsx apps/web/src/styles.css tests/acceptance/audit-queue.spec.ts
git commit -m "feat: build audit queue command center"
```

---

### Task 6: Build the Decision-first Review Workbench

**Files:**
- Create: `apps/web/src/hooks/use-audit-events.ts`
- Create: `apps/web/src/components/review-drawer.tsx`
- Create: `apps/web/src/components/audit-case-workbench.tsx`
- Modify: `apps/web/src/routes/audit-case-detail.tsx:1-83`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/acceptance/audit-case.spec.ts`

**Interfaces:**
- Consumes: `getAuditCase()`, `getAuditEventsUrl()`, `submitReview()`, cancel/retry calls, `ApiRequestError`, presentation helpers, and `FindingRevision`/`EvidenceLocator` domain types.
- Produces:
  - `useAuditEvents(id, onEvent, enabled): "connecting" | "connected" | "reconnecting" | "closed"`
  - `ReviewDrawer({ finding, decision, open, submitting, error, onClose, onSubmit })`
  - `AuditCaseWorkbench` for all case lifecycle states
  - persisted accepted and rejected browser flows

- [ ] **Step 1: Query detail-page Ant Design APIs**

Run:

```bash
antd info Steps --version 6.6.3 --format json
antd info Drawer --version 6.6.3 --format json
antd info Form --version 6.6.3 --format json
antd info Descriptions --version 6.6.3 --format json
antd info Alert --version 6.6.3 --format json
antd info Button --version 6.6.3 --format json
antd info Typography --version 6.6.3 --format json
```

Expected: JSON confirms `Steps.items/current/status/responsive`, controlled Drawer and Form APIs, `Descriptions.items`, `Alert.title`, `Space.orientation`, `Listy.items/itemRender/rowKey`, documented Button props, and `Typography.Text.copyable`.

- [ ] **Step 2: Extend the accepted-review scenario**

After the Finding becomes visible, replace the instant review click with:

```ts
await page.getByRole("button", { name: "接受建议" }).click();
await expect(page.getByRole("dialog", { name: "接受审计建议" })).toBeVisible();
await page.getByRole("button", { name: "确认接受" }).click();
await expect(page.getByText("复核已提交")).toBeVisible();
await page.reload();
await expect(page.getByText("已接受")).toBeVisible();
await expect(page.getByText("已完成").first()).toBeVisible();
```

- [ ] **Step 3: Add the rejected-review scenario**

Extract a local `createDemoAudit(page)` helper that opens the creation Drawer, loads demo text, submits, and waits for the conflict Finding. Add:

```ts
test("requires a reason and retains a rejected decision", async ({ page }) => {
  await createDemoAudit(page);
  await page.getByRole("button", { name: "驳回建议" }).click();
  await page.getByRole("button", { name: "确认驳回" }).click();
  await expect(page.getByText("请输入驳回理由")).toBeVisible();
  await page.getByLabel("复核理由").fill("合同证据不足以支持该风险等级");
  await page.getByRole("button", { name: "确认驳回" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  await page.reload();
  await expect(page.getByText("已驳回")).toBeVisible();
  await expect(page.getByText("合同证据不足以支持该风险等级")).toBeVisible();
  await expect(page.getByText("已完成").first()).toBeVisible();
});
```

- [ ] **Step 4: Run the detail acceptance tests and verify the explicit review flow is missing**

Run:

```bash
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: FAIL because review dialogs, reason validation, and terminal rejected review presentation do not exist.

- [ ] **Step 5: Implement the SSE hook with one URL source**

Create:

```ts
import { useEffect, useState } from "react";
import { getAuditEventsUrl } from "../api";

export type AuditConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export function useAuditEvents(
  id: string,
  onEvent: () => void,
  enabled: boolean,
): AuditConnectionState {
  const [state, setState] = useState<AuditConnectionState>("connecting");

  useEffect(() => {
    if (!enabled) return;

    setState("connecting");
    const events = new EventSource(getAuditEventsUrl(id));
    events.onopen = () => setState("connected");
    events.onmessage = () => onEvent();
    events.onerror = () => setState("reconnecting");
    return () => events.close();
  }, [enabled, id, onEvent]);

  return enabled ? state : "closed";
}
```

The route must pass a `useCallback()` refetch/invalidate function so the hook does not reconnect on every render.

- [ ] **Step 6: Implement the controlled review Drawer**

Use these public props:

```ts
export interface ReviewDrawerProps {
  finding: FindingRevision | null;
  decision: "ACCEPTED" | "REJECTED" | null;
  open: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { findingId: string; decision: "ACCEPTED" | "REJECTED"; reason?: string }) => void;
}
```

The visible title is `接受审计建议` or `驳回审计建议`. Use one `Form<{ reason?: string }>` with a visible `复核理由` TextArea. Apply this rule only when rejecting:

```ts
{
  validator: async (_, value?: string) => {
    if (decision === "REJECTED" && !value?.trim()) throw new Error("请输入驳回理由");
  },
}
```

Submit a trimmed reason only when non-empty. Disable close and duplicate submit while pending. Use buttons “确认接受” and “确认驳回.”

- [ ] **Step 7: Implement the workbench lifecycle body**

The component accepts the fetched detail data, connection state, mutation state, and callbacks. It must:

- Render breadcrumb/back link, short copyable ID, `AuditStateBadge`, created/updated times, and connection text mapped as `connecting → 正在连接`, `connected → 实时更新`, `reconnecting → 正在重连`, and `closed → 已断开`.
- Render Steps with the exact items `已创建`, `规则评估`, `Agent 分析`, `人工复核`, `已完成` and `current={getAuditStep(auditCase)}`.
- For pending/running, render stable progress and confirmed cancellation.
- For failed/cancelled/interrupted, render an Alert/Result and confirmed retry.
- For waiting review, render the Finding in the main column and facts/evidence in the context column.
- Match evidence with:

```ts
const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
const citedEvidence = finding.proposal.evidenceIds.map((evidenceId) => ({
  evidenceId,
  evidence: evidenceById.get(evidenceId) ?? null,
}));
```

- Render `证据不可用：<id>` for a missing locator.
- Render decision buttons only when `finding.review === null`.
- Render accepted/rejected decision, reason, reviewer, and review time after review.
- Keep the sticky action bar in normal document flow on mobile so it cannot cover content.

Translate Finding values for users: `ADVANCE_PAYMENT_POLICY_CONFLICT` → `预付款比例超过制度上限`, `NEEDS_HUMAN_REVIEW` → `需要人工复核`, and LOW/MEDIUM/HIGH → 低/中/高风险.

- [ ] **Step 8: Replace route markup with query and mutation orchestration**

The route keeps `useQuery({ queryKey: ["audit-case", id], queryFn: () => getAuditCase(id) })`. Add cancel, retry, and review mutations. Import `App as AntApp`, obtain `const { message } = AntApp.useApp()`, and do not use the static message API. On success invalidate both `["audit-case", id]` and `["audit-cases"]`.

Memoize the event callback with `useCallback`. Enable the stream only while the case stage is `QUEUED`, `NORMALIZING`, `RULE_ASSESSMENT`, `AGENT_RUNNING`, or `AWAITING_REVIEW`; pass that boolean to `useAuditEvents(id, handleAuditEvent, streamEnabled)`. A completed, failed, cancelled, or interrupted case must close the stream and display `已断开`.

For review 409:

```ts
if (error instanceof ApiRequestError && error.status === 409) {
  message.warning("该发现已完成复核，请刷新查看最新状态");
  void queryClient.invalidateQueries({ queryKey: ["audit-case", id] });
  return;
}
message.error(error.message);
```

Initial loading uses a stable Skeleton workbench. Initial failure uses Result with “重新加载.” A background refetch must keep existing content visible.

- [ ] **Step 9: Add review-workbench responsive styles**

Create a two-column grid with `minmax(0, 1.35fr) minmax(280px, .85fr)` at desktop, one column below 900 px, compact metadata wrapping, quoted evidence with semantic `<blockquote>`, fact comparison cells, and the sticky review surface. Use border and background differences rather than shadowed Card stacks. Ensure no content is covered at 375 px.

- [ ] **Step 10: Verify detail behavior and Ant Design usage**

Run:

```bash
antd lint apps/web/src/components/review-drawer.tsx --format json
antd lint apps/web/src/components/audit-case-workbench.tsx --format json
bun run typecheck
bunx playwright test tests/acceptance/audit-case.spec.ts
```

Expected: accepted and rejected flows pass; both persist after reload; rejection requires a reason; no Ant Design a11y/deprecated issue is reported.

- [ ] **Step 11: Commit the review workbench**

```bash
git add apps/web/src/hooks/use-audit-events.ts apps/web/src/components/review-drawer.tsx apps/web/src/components/audit-case-workbench.tsx apps/web/src/routes/audit-case-detail.tsx apps/web/src/styles.css tests/acceptance/audit-case.spec.ts
git commit -m "feat: build decision-first audit review"
```

---

### Task 7: Verify the Complete Surface and Record Evidence

**Files:**
- Modify after verification: `CHANGELOG.md:8-70`
- Modify for the dependency/API baseline: `README.md`, `package.json`, `apps/web/package.json`, `bun.lock`, and this plan/spec.
- Do not modify unrelated API/bootstrap files: `apps/api/package.json`, `apps/api/start.sh`, `diag-pi.ts`, or `.superpowers/`.

**Interfaces:**
- Consumes: all behavior from Tasks 1–6.
- Produces: exact automated and visual proof for the redesigned surface and a changelog entry grounded in observed output.

- [ ] **Step 1: Run focused unit and API regression tests**

Run:

```bash
bun test apps/api/src/app.test.ts apps/web/src/audit-presentation.test.ts
```

Expected: all focused tests pass, including rejected-review terminal completion and lifecycle precedence.

- [ ] **Step 2: Run Ant Design lint and project type checking**

Run:

```bash
antd lint apps/web/src --format json
bun run typecheck
```

Expected: Ant Design lint reports no deprecated, accessibility, or performance finding for changed files; TypeScript exits successfully.

- [ ] **Step 3: Run the two acceptance files**

Ensure PostgreSQL is available and migrations are applied, then run:

```bash
bunx playwright test tests/acceptance/audit-case.spec.ts tests/acceptance/audit-queue.spec.ts
```

Expected: creation, accept, reject, queue filter, cancel, retry, and 375 px overflow scenarios all pass with `AUDIT_AGENT_MODE=fake` from Playwright configuration.

- [ ] **Step 4: Exercise the actual desktop surface**

Start PostgreSQL, API with `AUDIT_AGENT_MODE=fake`, and Web using project-scoped long-running processes. Open `http://localhost:5173/audit-cases` at 1440×900 in the browser and exercise this exact scenario:

1. Confirm sidebar, header, queue summary, toolbar, and table are visually aligned.
2. Open New Audit; submit blank and observe adjacent validation.
3. Load demo contract, keep threshold at 30%, submit, and observe navigation.
4. Observe progress/SSE connection text until the Finding appears.
5. Open Accept review, cancel once, reopen, submit, reload, and confirm the retained terminal decision.
6. Return to the queue, create a second demo audit, reject it with a reason, reload, and confirm the rejected decision and reason persist in a completed case.
7. Return through browser Back and confirm the queue retains usable state.
8. Navigate every interactive control by keyboard and confirm visible focus is never obscured.

Expected: no console exception, no fake navigation item or list severity, no layout jump during mutation, and every action has visible feedback.

- [ ] **Step 5: Exercise responsive layouts**

At 1024×768, 768×900, and 375×812 inspect the queue, New Audit Drawer, running detail, waiting-review detail, and completed detail. At each viewport evaluate:

```js
document.documentElement.scrollWidth <= window.innerWidth
```

Expected: `true` at every width; 375 px uses audit cards, one-column Finding/evidence, full-width Drawer, and 44 px controls without covered content.

- [ ] **Step 6: Perform post-proof cleanup**

After the smoke path passes:

- Remove obsolete inline page layout and status-color maps from both route files.
- Remove unused Ant Design imports and any superseded helper.
- Confirm no `console.log`, disabled fake navigation, temporary fixture, screenshot, or generated visual-companion file is staged.
- Keep `.superpowers/` untracked and out of commits.

- [ ] **Step 7: Update the changelog with observed facts**

Under `[Unreleased]`, add concise entries for:

- Modern Authority queue and decision-first review workbench.
- Policy threshold, cancellation, retry, reasoned review, localized lifecycle, SSE state, responsive/a11y behavior.
- Rejected reviews becoming terminal.
- The exact commands run and their observed pass counts or success output from Steps 1–5.

Do not copy expected counts from this plan; record only the counts printed by the completed commands.

- [ ] **Step 8: Commit verified documentation only**

```bash
git add CHANGELOG.md
git commit -m "docs: record modern workbench verification"
```

Stage only the verified files belonging to this worktree's feature and Ant Design v6 upgrade; keep unrelated API/bootstrap changes and `.superpowers/` out of commits.
