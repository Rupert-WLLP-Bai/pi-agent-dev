import { expect, type Page, test } from "@playwright/test";

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API not reachable via web origin (status ${response.status()}); is the dev stack up?`,
  ).toBe(true);
}

const CONTRACT_TEXT = `设备采购合同

甲方：深圳精工科技有限公司（采购方）

乙方：重庆华盛贸易有限公司（供货方）

第一条 采购内容
乙方向甲方供应办公用笔记本电脑50台。

第二条 支付方式
甲方应在合同签订后七日内支付合同总价70%作为预付款，验收合格后支付剩余价款。

第三条 交付时间
乙方应于2026年10月31日前完成交付。`;

test("uploads a .txt contract through the drawer and lands on the case page", async ({ page }) => {
  await assertApiReachable(page);
  await page.goto("/audit-cases");

  await page.getByRole("button", { name: "新建审计" }).click();
  const drawer = page.getByRole("dialog", { name: "新建审计" });
  await expect(drawer).toBeVisible();

  // Switch to the file mode and attach the contract as a .txt upload.
  await drawer.getByText("上传文件").click();
  await drawer.locator("input[type=file]").setInputFiles({
    name: "设备采购合同.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(CONTRACT_TEXT, "utf-8"),
  });
  await expect(drawer.getByText("设备采购合同.txt")).toBeVisible();

  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();

  // The case detail page opens and the audit completes.
  await page.waitForURL(/\/audit-cases\/.+$/, { timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const match = page.url().match(/\/audit-cases\/(.+)$/);
        if (!match) return "NO_URL";
        const resp = await page.request.get(`/api/audit-cases/${match[1]}`);
        if (!resp.ok()) return "NO_CASE";
        return (await resp.json()).case?.status;
      },
      { timeout: 30_000, message: "uploaded case should complete" },
    )
    .toBe("COMPLETED");

  // The document panel shows the contract title as the first block, and both
  // parties were extracted from the uploaded file.
  await expect(page.locator(".document-block").first()).toContainText("设备采购合同");
  await expect(page.getByText("深圳精工科技有限公司").first()).toBeVisible();
  await expect(page.getByText("重庆华盛贸易有限公司").first()).toBeVisible();
});
