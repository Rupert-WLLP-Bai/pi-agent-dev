# Modern Audit Workbench Design

**Status:** Approved direction

## Problem

The current React workbench exposes the MVP path but behaves like a component demo: it has no application shell, raw English lifecycle values, weak loading and error recovery, no queue prioritization, and no usable path to backend capabilities such as policy thresholds, cancellation, retry, and review reasons. The detail page separates rule, evidence, and Finding into unrelated stacked cards, so the reviewer must reconstruct why a decision is needed.

This redesign must make the existing single-user audit loop feel complete without inventing document upload, OCR, full-document highlighting, playbook management, multi-user approval, or portfolio analytics that the backend does not support.

## Goals

- Make the audit queue the primary home-screen task.
- Make risk evidence, deterministic rule output, Agent rationale, remediation, and human decision understandable in one review flow.
- Expose every relevant capability already present in the API: custom policy threshold, cancellation, retry, review reason, health, and SSE updates.
- Localize status and stage labels while keeping domain values unchanged over the wire.
- Provide explicit loading, empty, success, error, disconnected, and terminal states.
- Work without horizontal scrolling at 375, 768, 1024, and 1440 CSS pixels.
- Retain the current React, Vite, TanStack Router/Query, Eden Treaty, and Ant Design stack, upgraded to `antd@6.6.3` with `@ant-design/icons@6.3.4`.

## Non-goals

- Migrating the application to Next.js.
- Adding shadcn/ui, Tailwind, Geist components, or another component system beside Ant Design.
- File upload, PDF/OCR, full contract rendering, redlining, playbook configuration, comments, assignments, authentication, authorization, or reporting.
- Fabricated risk counts, live indicators, navigation destinations, users, or contract names.
- Fetching every case detail to manufacture list-level severity; that would create an N+1 request pattern.

## Research Basis

The visual direction uses Vercel Geist as a reference for high-contrast semantic color scales, two restrained background levels, grid-based composition, compact typography, 6/12-pixel material radii, thin borders, and shadows reserved for floating surfaces. These are visual principles only; the implementation remains Ant Design.

Contract-review products reinforce the chosen information hierarchy:

- Icertis describes prioritized queues, playbook-guided decisions, source-language evidence, and human approval as the core review loop.
- Ironclad Playbooks center clause detection, non-standard-term flags, preferred positions, and reviewer resolution.
- IntelAgree presents status, pending approvals, and in-flight work at portfolio level before users open an individual contract.

References:

- [Vercel Geist Design System](https://vercel.com/geist/introduction)
- [Geist Colors](https://vercel.com/geist/colors)
- [Geist Typography](https://vercel.com/geist/typography)
- [Geist Materials](https://vercel.com/geist/materials)
- [Geist Grid](https://vercel.com/geist/grid)
- [Icertis AI Contract Review](https://www.icertis.com/learn/ai-contract-review)
- [Ironclad AI Playbooks](https://support.ironcladapp.com/hc/en-us/articles/12275685560215-Ironclad-AI-Playbooks-Overview)
- [IntelAgree Platform Tour](https://www.intelagree.com/platform-tour)

## Approved Product Direction

- Delivery boundary: complete the existing audit loop; do not simulate future product modules.
- Home priority: process the audit queue rather than lead with a large creation form.
- Home layout: **Risk Command Center**.
- Detail layout: **Decision-first Review Workbench**.
- Visual language: **Modern Authority** — trustworthy slate foundations with the restraint and precision associated with modern Vercel/Next.js surfaces.
- Density: compact desktop dashboard, with touch-safe controls and card-based mobile adaptation.
- Motion: only 150–250 ms feedback transitions; no decorative entrance animation.

## Information Architecture

The root route renders one application shell around both existing routes.

The desktop shell contains a narrow dark sidebar, a light top bar, and a flexible content region. The sidebar shows the product identity and the only real destination, “审计工作台.” It must not show Rules or Settings until those routes exist. The top bar provides page context, API health, and the primary “新建审计” action where applicable.

At widths below 1024 pixels the sidebar collapses to a rail. Below 768 pixels it becomes a top header with a menu trigger. All primary content becomes a single column; audit records render as cards rather than forcing the desktop table to scroll horizontally.

Routes remain:

- `/audit-cases` — queue command center
- `/audit-cases/:id` — decision-first review workbench

Deep links and browser Back remain authoritative. The detail header also includes an explicit “返回审计队列” link.

## Visual System

### Color

- Shell navigation: near-black slate, approximately `#0A0A0A`.
- Page background: cool off-white, approximately `#F7F8FA`.
- Primary surface: white.
- Primary text: approximately `#18181B`.
- Secondary text: approximately `#71717A`.
- Border: approximately `#E4E4E7`.
- Primary action: carbon/near-black rather than a large blue field.
- Link and focus accent: restrained accessible blue.
- Risk, warning, progress, and success colors appear only with a text label or icon; color is never the sole signal.

Exact values are expressed through one root Ant Design `ConfigProvider` theme plus project CSS variables. Component code must not contain a second ad hoc color system.

### Ant Design v6 Baseline

The workbench targets the stable Ant Design v6 API surface. Use the documented v6 equivalents throughout the UI: `Space.orientation`, `Descriptions.items`, `Alert.title`, `Drawer.size` with `mask.closable`, and `App.useApp()` for contextual feedback. The deprecated `List` component is not part of the design; long or dynamic collections use `Listy` with explicit empty states. The root `ConfigProvider` wraps one Ant Design `App`, and React 19 requires no v5 compatibility patch.

### Typography

Use the local system stack: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, and `sans-serif`. Do not add a web-font download. Chinese copy uses the native CJK face; short IDs and timestamps may use the platform monospace stack.

Body copy is at least 14 px on desktop and 16 px in mobile form controls, with a line height of at least 1.5. Dense 12–13 px labels are limited to metadata and never carry primary instructions.

### Surfaces and Spacing

- Spacing scale: 4, 8, 12, 16, 24, and 32 px.
- Inline controls: 6 px radius.
- Connected dashboard surfaces: 10 px radius.
- Drawers and modals: 12 px radius where supported.
- Static surfaces use borders instead of elevation.
- Shadows are limited to drawers, modals, popovers, and the sticky review bar.
- Summary metrics form one connected grid rather than four floating cards.

## Queue Command Center

### Header and Summary

The page title is “审计队列” with a concise description and a visible last-updated timestamp. “新建审计” is the primary action.

The summary strip is derived only from `GET /api/audit-cases`:

- 待复核: `stage === "AWAITING_REVIEW"`
- 处理中: `status === "PENDING" || status === "RUNNING"`
- 异常: `status === "FAILED" || status === "INTERRUPTED"`
- 今日完成: `stage === "COMPLETED"` and the local calendar date of `updatedAt` is today

The design must not show a high-risk count because the list endpoint does not return Finding severity.

### Queue Controls

- Search by complete or partial audit ID.
- Filter by localized lifecycle groups: all, waiting for review, processing, completed, cancelled, and abnormal.
- Explicit refresh button with pending state and refreshed timestamp.
- Default sort by most recently updated.
- Filters and search operate client-side on the already-loaded MVP dataset.

### Desktop Records

Use an Ant Design Table with a stable `rowKey="id"`. Columns show short audit ID, localized status, localized stage, created time, updated time, and actions. The first cell is a functional label such as “合同审计 d92f2cc5”; it must not invent a contract title unavailable from the API.

Rows have a clear hover state, but opening a record is also exposed as a keyboard-focusable link or button. Hover must not be the only affordance.

Action visibility:

- Pending or running: 查看, 取消
- Failed, cancelled, or interrupted: 查看, 重试
- Waiting for review or completed: 查看

### Mobile Records

Below 768 pixels, use stacked audit cards with the same labels and actions. Primary controls are at least 44×44 CSS pixels and separated by at least 8 pixels. No horizontal table scrolling.

### Empty and Error States

A successful empty response shows a concise explanation and “新建审计.” A failed request shows an inline Result/Alert with the actual safe error message and a retry action. Refresh errors do not erase previously loaded data.

## New Audit Flow

“新建审计” opens a right-side Drawer on desktop and a full-width Drawer on mobile. It contains:

- A visible “合同文本” label and multiline input.
- Character count and concise helper text.
- “制度允许的预付款上限” as a percentage InputNumber, defaulting to 30% and submitted as `0.3`.
- “加载演示合同” as a secondary action that fills the text without submitting.
- Cancel and “开始审计” actions in a stable footer.

Validation occurs on blur and submit:

- Contract text cannot be blank after trimming.
- Policy threshold must be between 0% and 100%.
- Field errors appear adjacent to their fields and are announced accessibly; a toast alone is insufficient.

During submission, inputs and duplicate submit paths are disabled, the primary action shows progress, and the layout does not jump. Success closes the Drawer and navigates to the new detail route. Failure preserves input and shows an inline submission error plus a toast for global feedback.

## Decision-first Review Workbench

### Context Header

The detail header contains a queue breadcrumb, short ID with copy action, localized state badge, created/updated timestamps, and contextual actions. The copy control has an accessible name.

A compact stage indicator communicates these user-level phases:

1. 已创建
2. 规则评估
3. Agent 分析
4. 人工复核
5. 已完成

It maps existing status/stage values to product language rather than displaying raw enums. Failed, cancelled, and interrupted states replace false progress with a clear terminal/interruption message.

### State-specific Body

Pending and running cases show a stable progress surface, current product stage, and a cancel action. Cancellation requires explicit confirmation and explains that completed work is not rolled back.

Failed, cancelled, and interrupted cases show the last safe state description and a primary retry action. Retrying confirms intent, calls the existing retry endpoint, invalidates list/detail queries, and returns the surface to queued progress.

Waiting-for-review cases use a two-column desktop layout:

- Main column: Finding title in Chinese, severity, rationale, fact comparison, and remediation.
- Context column: evidence quotations and deterministic rule identity.

Evidence is associated by matching `finding.proposal.evidenceIds` to `snapshot.evidence`. Missing referenced evidence is rendered as an explicit unavailable state, not silently dropped.

On narrow screens the Finding comes first, followed by rule facts and evidence. A sticky action surface keeps “接受建议” and “驳回建议” reachable without covering content.

Completed cases are read-only and show the recorded human decision, reason when present, reviewer identity, and review time.

### Review Interaction

Both decision buttons open one review Drawer or Modal so the action is never instantaneous.

- The selected decision is restated in the title and summary.
- Acceptance reason is optional.
- Rejection reason is required by the UI, even though the transport currently permits omission.
- Submission disables only the active Finding decision controls.
- Success refreshes detail and list state and shows a brief confirmation.
- HTTP 409 is presented as “该发现已完成复核，请刷新查看最新状态” and triggers a refetch.

A human rejection is a terminal review decision, just like acceptance. The API must mark the case `COMPLETED`/`COMPLETED` and publish completion after either decision; otherwise the queue would permanently claim that a fully reviewed case still awaits review. This is the only backend semantic correction included in the redesign.

## API and Data Flow

The web API module gains calls for:

- `GET /api/health`
- `POST /api/audit-cases/:id/cancel`
- `POST /api/audit-cases/:id/retry`

The API base URL is defined once. Eden Treaty requests and the EventSource URL must derive from the same `VITE_API_URL` value; the current relative EventSource path would target the wrong origin when a remote API URL is configured.

TanStack Query remains the server-state owner:

- List and detail have separate stable query keys.
- Create, cancel, retry, and review mutations invalidate the affected detail and list keys.
- SSE product events trigger detail invalidation.
- EventSource connection state is visible as “实时更新,” “正在重连,” or “已断开.” Browser reconnect behavior remains enabled.
- A reconnect always refetches the current snapshot; historical event replay is not assumed.

## Accessibility and Interaction

- All interactive controls are keyboard reachable with visible focus indication.
- Icon-only controls have accessible names; decorative icons are hidden from assistive technology.
- Status is communicated through Chinese text plus color/icon shape.
- Text contrast is at least 4.5:1 for normal text.
- Mobile targets are at least 44×44 px with at least 8 px spacing.
- Forms use persistent labels, helper text, adjacent errors, and correct `aria-describedby` relationships where needed.
- Loading surfaces preserve layout and expose busy state; no flashing spinner for near-instant refreshes.
- Motion respects `prefers-reduced-motion` and is never required to understand state.
- Destructive cancellation uses confirmation; accepting or rejecting always shows a review summary before submission.

## Component and Styling Strategy

Use one root `ConfigProvider` wrapped by Ant Design `App`. Theme through global tokens first and component tokens only where a documented component API requires them. Layout-specific styling belongs in project CSS classes and CSS variables. Do not target internal `.ant-*` selectors.

Likely UI units are:

- App shell and responsive navigation
- Product status/stage presentation
- Queue summary strip
- Queue toolbar and desktop/mobile record presentations
- New audit Drawer and validated form
- Audit progress header
- Finding review panel
- Evidence panel
- Review decision Drawer/Modal
- Shared query error, empty, and skeleton states

Components stay focused; route files coordinate data and mutations rather than containing every visual primitive inline.

## Verification and Acceptance

The redesigned behavior is complete when:

- A user can open the queue, understand counts and states without reading raw enum values, search/filter records, refresh, and recover from a list error.
- A user can create an audit with contract text and an explicit policy threshold and is navigated to its detail route.
- A running or pending audit can be cancelled with confirmation.
- A failed, cancelled, or interrupted audit can be retried from list or detail.
- Detail state updates through SSE/refetch and communicates reconnect state.
- A reviewer can trace a Finding to its rule facts and evidence, then accept or reject it with the specified reason behavior.
- Both accepted and rejected decisions persist as terminal reviewed cases after reload.
- Existing deep links and browser navigation continue to work.
- The accepted audit acceptance scenario remains green, and a rejection scenario proves required reason plus terminal persistence.
- Desktop behavior is exercised at 1440×900 and keyboard navigation is checked.
- Responsive behavior is visually exercised at 1024, 768, and 375 pixels with no horizontal page overflow.
- Ant Design lint passes for changed frontend files, and type checking reports no new diagnostics.

## Explicit Risks

- List-level severity cannot be shown truthfully without extending the list API; this design intentionally omits it.
- The current list API has no contract title or excerpt; the UI uses a stable audit label and short ID.
- The sidebar has one real destination in this MVP. Extra destinations remain absent rather than disabled or misleading.
- Rejection completion changes one backend transition and therefore requires an API regression test in addition to frontend verification.
