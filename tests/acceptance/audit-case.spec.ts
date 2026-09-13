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
  // The agent explains the risk in the inspector's 判断依据 block.
  await expect(page.getByText("预付款比例高于制度上限").first()).toBeVisible({ timeout: 15000 });
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
    expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // The organisation wordmark must render even if the mark is unavailable.
  await expect(lockup.getByText("中国移动", { exact: true })).toBeVisible();
  expect(failedRequests).toEqual([]);
});

test("collapses the sidebar on a case and expands it on the queue", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit-cases");

  const sider = page.locator(".app-sider");
  await expect(sider).toBeVisible();
  expect((await sider.boundingBox())?.width).toBeGreaterThan(200);

  await createDemoAudit(page);

  // The review workspace must dominate the screen, so the sider narrows.
  await expect
    .poll(async () => Math.round((await sider.boundingBox())!.width), { timeout: 5000 })
    .toBeLessThanOrEqual(64);
  await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();

  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect
    .poll(async () => Math.round((await sider.boundingBox())!.width))
    .toBeGreaterThan(200);
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

  // Fact comparison pins actual vs. limit.
  await expect(workspace.locator(".fact-cell.bad b")).toHaveText("50%");
  await expect(workspace.locator(".fact-cell.ref b")).toHaveText("30%");
});

test("records a confirmed risk and retains the business wording", async ({ page }) => {
  await createDemoAudit(page);
  // Both demo findings must be reviewed before the case completes.
  for (const label of ["预付款比例超过制度上限", "争议管辖地与我方不一致"]) {
    await page.locator(".finding-list").getByText(label, { exact: true }).click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(page.getByText("复核已提交")).toBeVisible();
  }

  await page.reload();
  await expect(page.getByText("已确认风险").first()).toBeVisible();
  // The status badge is the case's state; the step list always shows 已完成.
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});

test("requires a reason for a false positive and retains the decision", async ({ page }) => {
  await createDemoAudit(page);
  await page.locator(".inspector-actions").getByRole("button", { name: "判定误报" }).click();
  const dialog = page.getByRole("dialog", { name: "判定误报" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("请输入误报理由")).toBeVisible();

  await page.getByLabel("复核理由").fill("合同证据不足以支持该风险等级");
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  // A rejected finding is one decision; the other finding still needs one.
  await page.locator(".finding-list").getByText("争议管辖地与我方不一致", { exact: true }).click();
  await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
  const acceptDialog = page.getByRole("dialog", { name: "确认风险" });
  await expect(acceptDialog).toBeVisible();
  await acceptDialog.getByRole("button", { name: "确认风险" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  await page.reload();
  await expect(page.getByText("已判定误报").first()).toBeVisible();
  await expect(page.getByText("合同证据不足以支持该风险等级")).toBeVisible();
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});
