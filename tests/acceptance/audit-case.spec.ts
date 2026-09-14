import { expect, type Page, test } from "@playwright/test";

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

async function createDemoAudit(page: Page) {
  await assertApiReachable(page);
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "新建审计" }).click();
  await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();
  await page.getByRole("button", { name: "开始审计" }).click();
  await expect(page.getByText("请输入合同文本")).toBeVisible();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  await expectAdvancePaymentFinding(page);
}

/**
 * Waits for the demo audit's advance-payment risk to reach the finding list.
 *
 * The gate is the list entry, not the inspector's 判断依据 text: the inspector
 * shows whichever finding sorts first, and the dev database is shared across
 * specs, so every run that confirms a risk for the demo counterparty feeds
 * 相对方历史关联 until it outranks this one and the rationale is no longer on
 * screen. The list entry is true whatever is selected.
 */
async function expectAdvancePaymentFinding(page: Page) {
  await expect(
    page.locator(".finding-list").getByText("预付款比例超过制度上限", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
}

/**
 * Confirms every finding still awaiting a decision as risk.
 *
 * How many that is depends on the shared database, so the loop is driven by the
 * list rather than by a fixed set of labels. The list defaults to 待处理 and a
 * decision drops the finding out of it, which is why each round takes the first
 * entry and why the shrinking count — not the 复核已提交 toast, which lingers
 * from the previous round — is what marks progress.
 */
async function confirmPendingFindings(page: Page) {
  const findings = page.locator(".finding-item");
  for (let remaining = await findings.count(); remaining > 0; remaining -= 1) {
    await findings.first().click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(findings).toHaveCount(remaining - 1);
  }
}

test("renders the application shell with brand, navigation, and pages", async ({ page }) => {
  await page.goto("/");

  // Root redirects to the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计队列", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计驾驶舱", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计驾驶舱" })).toBeVisible();

  await page.getByRole("link", { name: "审计队列", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审计队列" })).toBeVisible();
});

test("loads every brand image without a broken or blank brand area", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/brands/") && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/dashboard");

  // The sider starts expanded on desktop, so the full lockup must be present.
  const lockup = page.locator(".brand-lockup");
  await expect(lockup).toBeVisible();

  const brandImages = lockup.locator("img");
  await expect(brandImages).not.toHaveCount(0);
  const count = await brandImages.count();

  for (let index = 0; index < count; index += 1) {
    const image = brandImages.nth(index);
    await expect(image).toBeVisible();
    // A 200 response is not enough: the decoded image must have real pixels.
    // Visibility does not imply decoded — an <img> occupies its box before the
    // bytes arrive, and on a cold dev server they arrive late — so poll rather
    // than read naturalWidth once.
    await expect
      .poll(async () => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }

  // The organisation wordmark must render even if the mark is unavailable.
  await expect(lockup.getByText("中国移动", { exact: true })).toBeVisible();
  expect(failedRequests).toEqual([]);
});

test("the sidebar follows the operator's choice on every route, and a narrow viewport overrides it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit-cases");

  const sider = page.locator(".app-sider");
  const siderWidth = async () => Math.round((await sider.boundingBox())!.width);
  await expect(sider).toBeVisible();
  expect(await siderWidth()).toBeGreaterThan(200);

  await createDemoAudit(page);

  // Opening a case does not narrow the rail: the design spec (§3.2) keeps the
  // width the operator's to decide on every route, so switching sections stays
  // one click away.
  expect(await siderWidth()).toBeGreaterThan(200);

  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect.poll(siderWidth, { timeout: 5000 }).toBeLessThanOrEqual(64);
  await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();

  // The choice is remembered, so leaving the case keeps the rail collapsed.
  await page.goto("/audit-cases");
  await expect.poll(siderWidth).toBeLessThanOrEqual(64);

  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect.poll(siderWidth).toBeGreaterThan(200);

  // A viewport too narrow for the full rail overrides the preference.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(siderWidth).toBeLessThanOrEqual(64);
});

test("renders the three-pane review workspace with a located quote", async ({ page }) => {
  await createDemoAudit(page);

  const workspace = page.locator(".review-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator("> .finding-nav")).toBeVisible();
  await expect(workspace.locator("> .document-stage")).toBeVisible();
  await expect(workspace.locator("> .inspector")).toBeVisible();

  // The contract original must be shown, not just an excerpt.
  await expect(workspace.locator(".document-block").first()).toBeVisible();
  expect(await workspace.locator(".document-block").count()).toBeGreaterThan(1);

  // The cited clause is highlighted in the document and has a problem marker.
  expect(await workspace.locator(".document-block.has-problem").count()).toBeGreaterThan(0);

  // The fact comparison below belongs to the advance-payment finding, so select
  // it rather than trusting it to be the one the list opened on.
  await workspace
    .locator(".finding-list")
    .getByText("预付款比例超过制度上限", { exact: true })
    .click();

  // Fact comparison pins actual vs. limit.
  await expect(workspace.locator(".fact-cell.bad b")).toHaveText("50%");
  await expect(workspace.locator(".fact-cell.ref b")).toHaveText("30%");
});

test("records a confirmed risk and retains the business wording", async ({ page }) => {
  await createDemoAudit(page);

  expect(await page.locator(".finding-item").count()).toBeGreaterThan(1);
  await confirmPendingFindings(page);

  await page.reload();
  // Nothing is pending now, so the decisions have to be read back on 全部.
  await page.getByRole("button", { name: /^全部/ }).click();
  await expect(page.getByText("已确认风险").first()).toBeVisible();
  // The status badge is the case's state; the step list always shows 已完成.
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});

test("requires a reason for a false positive and retains the decision", async ({ page }) => {
  await createDemoAudit(page);

  // Reject by name, so the decision can be found again after the reload below.
  const rejected = "预付款比例超过制度上限";
  await page.locator(".finding-list").getByText(rejected, { exact: true }).click();
  await page.locator(".inspector-actions").getByRole("button", { name: "判定误报" }).click();
  const dialog = page.getByRole("dialog", { name: "判定误报" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("请输入误报理由")).toBeVisible();

  await page.getByLabel("复核理由").fill("合同证据不足以支持该风险等级");
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  // A rejected finding is one decision; every remaining finding still needs one
  // before the case can complete.
  await confirmPendingFindings(page);

  await page.reload();
  // Nothing is pending now, so the decision has to be read back on 全部.
  await page.getByRole("button", { name: /^全部/ }).click();
  await page.locator(".finding-list").getByText(rejected, { exact: true }).click();
  await expect(page.getByText("已判定误报").first()).toBeVisible();
  await expect(page.getByText("合同证据不足以支持该风险等级")).toBeVisible();
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});

test("opens the review drawer for the finding selected in the risk list", async ({ page }) => {
  await createDemoAudit(page);

  // The first finding is selected by default; pick the second one explicitly.
  await page.locator(".finding-list").getByText("争议管辖地与我方不一致", { exact: true }).click();
  await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();

  const drawer = page.getByRole("dialog", { name: "确认风险" });
  await expect(drawer).toBeVisible();
  // The drawer must describe the finding that was chosen, not whichever one
  // happened to be first in the list.
  await expect(drawer.locator(".review-summary")).toContainText("争议管辖地与我方所在地不一致");
  await expect(drawer.locator(".review-summary")).not.toContainText("预付款比例高于制度上限");
});
