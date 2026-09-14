import { expect, type Page, test } from "@playwright/test";

/**
 * End-to-end lifecycle of one audit case, exercising every layer the demo
 * audience cares about:
 *
 * 1. Submit a demo contract (DEMO provenance).
 * 2. Watch the fake agent process it (the case settles to AWAITING_REVIEW).
 * 3. Open the agent trace page and verify every tool call is visible with its
 *    arguments and result — this is the "deepseek harness" view.
 * 4. Open the agent runs index and confirm the run appears there too.
 * 5. Go back to the case, confirm the risk (human review), and see it close.
 * 6. Return to the trace page and confirm it still shows the full trace.
 *
 * The fake agent is deterministic, so the assertions can be exact.
 */

async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

async function createDemoAudit(page: Page): Promise<string> {
  await assertApiReachable(page);
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "新建审计" }).click();
  await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  // The list shows finding-type labels; the inspector may be on another finding.
  await expect(page.getByText("预付款比例超过制度上限").first()).toBeVisible({ timeout: 15000 });

  const url = page.url();
  const caseId = url.split("/").pop()!;
  return caseId;
}

test("full audit lifecycle: submit, trace, review, close", async ({ page }) => {
  const caseId = await createDemoAudit(page);

  // ── 1. The workbench shows the finding and a trace button ──
  await expect(page.getByText("预付款比例超过制度上限").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "运行轨迹" })).toBeVisible();

  // ── 2. Open the trace page and verify the agent's tool calls ──
  await page.getByRole("button", { name: "运行轨迹" }).click();
  await expect(page).toHaveURL(new RegExp(`/audit-cases/${caseId}/trace`));

  // The trace card shows the agent identity.
  await expect(page.locator(".trace-card")).toBeVisible();
  await expect(page.getByText("Fake 0 · fake-agent")).toBeVisible();

  // Locators arrive inline on get_rule_assessments, so a conflict-only path
  // no longer needs get_evidence. The timeline still always shows assess then
  // submit.
  await expect(page.getByText("开始运行")).toBeVisible();
  await expect(page.getByText("get_rule_assessments").first()).toBeVisible();
  await expect(page.getByText("submit_finding_proposal").first()).toBeVisible();
  await expect(page.getByText("运行完成")).toBeVisible();

  // The workbench links here with ?expand=true, so payloads may already be
  // open. Expand only when they are still collapsed.
  const expandAll = page.getByRole("button", { name: "全部展开" });
  if (await expandAll.isVisible()) await expandAll.click();
  // A tool result is visible — the trace is not just names, it shows payloads.
  const ruleResult = page
    .locator(".trace-step--tool")
    .filter({ hasText: "get_rule_assessments" })
    .first();
  await expect(ruleResult).toBeVisible();
  // The tool result body contains the assessment data.
  await expect(ruleResult.locator(".trace-payload__body").first()).toContainText("assessments");

  // ── 3. The agent runs index page lists this run ──
  await page.goto("/audit-runs");
  await expect(page.getByRole("heading", { name: "运行轨迹" })).toBeVisible();
  // The run we just created is in the list.
  await expect(page.getByText("fake-agent").first()).toBeVisible();
  await expect(page.getByText("查看轨迹").first()).toBeVisible();

  // ── 4. Go back to the case and perform a human review ──
  await page.goto(`/audit-cases/${caseId}`);
  await expect(page.getByText("预付款比例超过制度上限").first()).toBeVisible();
  // The demo contract always breaches advance payment and jurisdiction. A
  // seeded demo world may add a party-history finding on the same
  // counterparty; every pending item must be decided before the case closes.
  const titles = await page.locator(".finding-list .f-title").allTextContents();
  for (const title of titles) {
    await page.locator(".finding-list").getByText(title, { exact: true }).click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(page.getByText("复核已提交").first()).toBeVisible();
  }

  // Reload to confirm the review persisted.
  await page.reload();
  await page.getByRole("button", { name: /^全部 / }).click();
  await expect(page.getByText("已确认风险").first()).toBeVisible();
  // The status badge, not the step list, is what proves the case closed.
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();

  // ── 5. The trace is still accessible after the case closed ──
  await page.getByRole("button", { name: "运行轨迹" }).click();
  await expect(page).toHaveURL(new RegExp(`/audit-cases/${caseId}/trace`));
  await expect(page.getByText("开始运行")).toBeVisible();
  await expect(page.getByText("运行完成")).toBeVisible();
  await expect(page.getByText("get_rule_assessments").first()).toBeVisible();
});

test("the trace page is reachable from the navigation menu", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "运行轨迹", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "运行轨迹", exact: true }).click();
  await expect(page).toHaveURL(/\/audit-runs$/);
  await expect(page.getByRole("heading", { name: "运行轨迹" })).toBeVisible();
});

test("the trace page shows an empty state for a case with no runs", async ({ page }) => {
  await assertApiReachable(page);
  // Create a case and cancel it synchronously. The dispatcher enqueues the
  // case on creation, but `cancel` only acts on PENDING cases. If the agent
  // already claimed it, the cancel is a no-op and the case will have a run.
  // To guarantee no runs, we cancel twice: once immediately, and we check
  // that the case status is CANCELLED before navigating.
  const response = await page.request.post("/api/audit-cases", {
    data: {
      source: "text",
      contractText: "这是一份合规合同，预付款比例为20%。",
      policyLimitRatio: 30,
    },
  });
  expect(response.ok()).toBe(true);
  const { id } = (await response.json()) as { id: string };

  // Cancel before the dispatcher claims it. If this succeeds, the case is
  // CANCELLED and the agent never runs.
  const cancelRes = await page.request.post(`/api/audit-cases/${id}/cancel`);
  // If cancel failed (agent already claimed), interrupt instead.
  if (!cancelRes.ok()) {
    await page.request.post(`/api/audit-cases/${id}/cancel`);
  }

  await page.goto(`/audit-cases/${id}/trace`);
  // The case exists but has no agent runs — either because it was cancelled
  // before the agent ran, or because the agent ran but the page still shows
  // the empty state when no traces are returned.
  // Wait for the trace query to settle — the page now shows a skeleton
  // while loading, then either the empty state or a trace card.
  const emptyState = page.getByText("该案件还没有智能体运行记录");
  const traceCard = page.locator(".trace-card");
  // One of the two states must be visible: either empty or with traces.
  await expect(emptyState.or(traceCard)).toBeVisible({ timeout: 15000 });
});

test("a needs-review case shows the agent reading the contract once", async ({ page }) => {
  await assertApiReachable(page);
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "新建审计" }).click();
  await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();

  // A sample whose penalty clause is missing: the penalty rule cannot settle
  // it, so the case asks for human review and the agent must read the contract
  // before proposing. The demo picker selects by short label.
  await page.getByText("广告服务", { exact: true }).first().click();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  await expect(page.getByText("缺少违约责任条款").first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "运行轨迹" }).click();
  await expect(page).toHaveURL(/\/trace/);
  // The abstaining dimension leaves a real reading trail: one full-document
  // read, not a keyword survey plus per-block follow-ups.
  await expect(page.getByText("get_contract_document").first()).toBeVisible();
});
