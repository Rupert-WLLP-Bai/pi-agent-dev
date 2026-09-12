import { expect, test, type Page } from "@playwright/test";

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API not reachable via web origin (status ${response.status()}); is the dev stack up?`,
  ).toBe(true);
}

/** Numeric KPI read off the cockpit card with the given title. */
async function readKpi(page: Page, title: string): Promise<number> {
  const value = page.locator(".kpi-card", { hasText: title }).locator(".ant-statistic-content-value");
  await expect(value).toBeVisible();
  const text = await value.innerText();
  return Number(text.replace(/[^0-9]/g, ""));
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
  await expect(page.getByText("预付款比例高于制度上限").first()).toBeVisible({ timeout: 15000 });
}

test("derives cockpit KPIs and risk mix from stored cases, not constants", async ({ page }) => {
  await assertApiReachable(page);
  await page.goto("/dashboard");

  // KPI cards render counts with real, non-constant values.
  const totalBefore = await readKpi(page, "审计案件总量");
  const acceptedBefore = await readKpi(page, "已确认风险");
  expect(totalBefore).toBeGreaterThan(0);

  // The trend chart and risk-type bars are driven by the same database.
  await expect(page.locator(".line-chart-placeholder svg polyline").first()).toBeVisible();
  await expect(page.locator(".hbar-row").first()).toBeVisible();
  const riskLabels = await page.locator(".hbar-label").allInnerTexts();
  expect(
    riskLabels.some((label) => label.includes("预付款") || label.includes("主体")),
    `risk bars should show known types, got: ${riskLabels.join(", ")}`,
  ).toBe(true);

  // Rates are derived, so they render as percentages or explicit no-data.
  for (const metric of await page.locator(".quality-item").allInnerTexts()) {
    expect(metric).toMatch(/%|暂无数据/);
  }

  await createDemoAudit(page);
  await page.getByRole("button", { name: "确认风险" }).click();
  const dialog = page.getByRole("dialog", { name: "确认风险" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认风险" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  await page.goto("/dashboard");
  // Other workers in this suite also create cases, so the deltas are lower
  // bounds: a constant projection could never grow past its hardcoded value.
  await expect
    .poll(async () => readKpi(page, "审计案件总量"), { message: "case total should grow by our case" })
    .toBeGreaterThanOrEqual(totalBefore + 1);
  await expect
    .poll(async () => readKpi(page, "已确认风险"), { message: "confirmed risks should grow by our review" })
    .toBeGreaterThanOrEqual(acceptedBefore + 1);
});
