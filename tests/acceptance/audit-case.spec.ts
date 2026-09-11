import { test, expect, type Page } from "@playwright/test";

async function createDemoAudit(page: Page) {
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

test("renders the application shell and queue", async ({ page }) => {
  await page.goto("/audit-cases");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计工作台", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计队列" })).toBeVisible();
});

test("creates, reviews, and retains a payment-risk finding", async ({ page }) => {
  await createDemoAudit(page);
  await page.getByRole("button", { name: "接受建议" }).click();
  await expect(page.getByRole("dialog", { name: "接受审计建议" })).toBeVisible();
  await page.getByRole("button", { name: "确认接受" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  await page.reload();
  await expect(page.getByText("已接受")).toBeVisible();
  await expect(page.getByText("已完成").first()).toBeVisible();
});

test("requires a reason and retains a rejected decision", async ({ page }) => {
  await createDemoAudit(page);
  await page.getByRole("button", { name: "驳回建议" }).click();
  await expect(page.getByRole("dialog", { name: "驳回审计建议" })).toBeVisible();
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
