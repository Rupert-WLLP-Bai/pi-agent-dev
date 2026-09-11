import { test, expect } from "@playwright/test";

test("creates, reviews, and retains a payment-risk finding", async ({ page }) => {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计队列" })).toBeVisible();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  await expect(page.getByText("预付款比例高于制度上限").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /接\s*受/ }).click();
  await page.reload();
  await expect(page.getByText("已接受")).toBeVisible();
});
