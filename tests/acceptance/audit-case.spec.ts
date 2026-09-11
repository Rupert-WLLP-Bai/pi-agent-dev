import { test, expect } from "@playwright/test";

test("creates, reviews, and retains a payment-risk finding", async ({ page }) => {
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  await expect(page.getByText("预付款比例高于制度上限").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /接\s*受/ }).click();
  await page.reload();
  await expect(page.getByText("已接受")).toBeVisible();
});
