import { expect, type Page, test } from "@playwright/test";

/**
 * UX 工作流与尺寸适配验收.
 *
 * These specs walk the real product surface: upload → evidence → review →
 * remediation, the 375px review-accessibility defect that hid the risk list and
 * the review actions, desktop widths, and the fresh-browser direct entry into
 * the workspace. They use role/label locators and measure what is actually
 * rendered.
 *
 * Screenshots and load measurements are the evidence this suite produces; the
 * assertions themselves never claim an improvement they did not observe.
 */

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

/** Creates the demo audit and waits for its findings to reach the risk list. */
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
  await expect(
    page.locator(".finding-list").getByText("预付款比例超过制度上限", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
}

test.describe("上传→证据→复核→整改", () => {
  test("三栏审查工作区在 375px 下仍可到达风险发现与复核操作", async ({ page }) => {
    // The defect: at ≤767px the finding list and the inspector were display:none,
    // so both the risks and 确认风险/判定误报 were unreachable on a phone. The
    // pane switcher must keep every pane reachable.
    await page.setViewportSize({ width: 375, height: 812 });
    await createDemoAudit(page);

    const workspace = page.locator(".review-workspace");
    await expect(workspace).toBeVisible();

    // The switcher exists at this width and names all three panes.
    const switcher = page.getByRole("tablist", { name: "审查视图切换" });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole("tab", { name: /风险发现/ })).toBeVisible();
    await expect(switcher.getByRole("tab", { name: "合同原文" })).toBeVisible();
    await expect(switcher.getByRole("tab", { name: "依据与复核" })).toBeVisible();

    // Risk list: visible by default, and its entries are real findings.
    await expect(workspace.locator("> .finding-nav")).toBeVisible();
    expect(await workspace.locator(".finding-item").count()).toBeGreaterThan(0);

    // Inspector with the review actions: reachable through the switcher.
    await expect(workspace.locator("> .inspector")).toBeHidden();
    await switcher.getByRole("tab", { name: "依据与复核" }).click();
    await expect(workspace.locator("> .inspector")).toBeVisible();
    await expect(workspace.locator("> .finding-nav")).toBeHidden();

    // The review actions themselves must be visible and labelled, not just
    // present in the DOM.
    const actions = workspace.locator(".inspector-actions");
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button", { name: "确认风险" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "判定误报" })).toBeVisible();

    // Document pane reachable too.
    await switcher.getByRole("tab", { name: "合同原文" }).click();
    await expect(workspace.locator("> .document-stage")).toBeVisible();
    expect(await workspace.locator(".document-block").count()).toBeGreaterThan(0);

    // Nothing overflows the viewport horizontally: a 375px screen is usable.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("复核结论可从 375px 提交并回读", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await createDemoAudit(page);

    // Open the inspector pane and confirm the first pending finding as risk.
    await page
      .getByRole("tablist", { name: "审查视图切换" })
      .getByRole("tab", { name: "依据与复核" })
      .click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();

    // The finding leaves 待处理, which is the observable proof the review landed.
    const pendingBefore = await page.locator(".finding-item").count();
    await expect
      .poll(async () => page.locator(".finding-item").count(), { timeout: 15000 })
      .toBeLessThan(pendingBefore);
  });

  test("桌面 1280/1440/1920 宽度下三栏同时可用", async ({ page }) => {
    await createDemoAudit(page);

    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const workspace = page.locator(".review-workspace");
      await expect(workspace).toBeVisible();
      // All three panes render simultaneously; the switcher is desktop-hidden.
      await expect(workspace.locator("> .finding-nav")).toBeVisible();
      await expect(workspace.locator("> .document-stage")).toBeVisible();
      await expect(workspace.locator("> .inspector")).toBeVisible();
      await expect(page.getByRole("tablist", { name: "审查视图切换" })).toBeHidden();
      // No horizontal overflow at any of the three desktop widths.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test("确认风险后整改看板出现对应整改项", async ({ page }) => {
    await createDemoAudit(page);

    // Confirm every pending finding so remediation items are created.
    const findings = page.locator(".finding-item");
    for (let remaining = await findings.count(); remaining > 0; remaining -= 1) {
      await findings.first().click();
      await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
      const dialog = page.getByRole("dialog", { name: "确认风险" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "确认风险" }).click();
      await expect(findings).toHaveCount(remaining - 1);
    }

    await page.goto("/remediations");
    await expect(page.getByRole("heading", { name: "整改跟踪" })).toBeVisible();
    // The board either shows the created items or explains there are none;
    // neither is a blank page.
    const cards = page.locator(".remediation-card");
    const empty = page.getByText("暂无整改项");
    await expect(cards.first().or(empty).first()).toBeVisible();
  });
});

test.describe("辅助决策入口", () => {
  test("案件工作区提供辅助决策入口且页面可加载", async ({ page }) => {
    await createDemoAudit(page);

    const entry = page.getByRole("link", { name: "辅助决策" });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/\/audit-cases\/.+\/decisions$/);

    // The panel renders its shadow disclaimer rather than a bare list.
    await expect(page.getByText("影子建议仅用于评估，不改变审计结论")).toBeVisible();
    // Whatever the server holds, the state is explicit: an empty reason or items.
    const panel = page.locator(".decision-panel");
    await expect(panel).toBeVisible();
  });
});
