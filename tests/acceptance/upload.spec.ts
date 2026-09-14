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

test("accepts a .txt contract upload and audits it end-to-end", async ({ page }) => {
  await assertApiReachable(page);

  const uploadResp = await page.request.post("/api/audit-cases/upload", {
    multipart: {
      file: {
        name: "设备采购合同.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(CONTRACT_TEXT, "utf-8"),
      },
      policyLimitRatio: "30",
    },
  });
  expect(uploadResp.status()).toBe(202);
  const { id } = await uploadResp.json();

  // Poll until the agent is done, then load the page. The E2E stack runs the
  // fake agent (sub-second), but the upload parse adds a hop, so waiting beats
  // assuming instant readiness. The state to wait for is AWAITING_REVIEW, not
  // COMPLETED: this contract's 70% advance payment raises the finding asserted
  // below, and a case with an undecided finding still owes a human a decision.
  await expect
    .poll(
      async () => {
        const resp = await page.request.get(`/api/audit-cases/${id}`);
        const body = await resp.json();
        return body.case?.status;
      },
      { timeout: 30_000, message: "uploaded case should reach a decision point" },
    )
    .toBe("AWAITING_REVIEW");

  await page.goto(`/audit-cases/${id}`);

  // The document panel must show the contract title as the first block.
  await expect(page.locator(".document-block").first()).toContainText("设备采购合同");

  // Both parties were extracted from the uploaded file.
  await expect(page.getByText("深圳精工科技有限公司").first()).toBeVisible();
  await expect(page.getByText("重庆华盛贸易有限公司").first()).toBeVisible();

  // The 70% advance payment must trigger a policy conflict finding.
  const findingTexts = await page.locator(".f-title, .inspector-title h3").allInnerTexts();
  expect(
    findingTexts.some((text) => text.includes("预付款")),
    `finding should mention advance payment, got: ${findingTexts.join(", ")}`,
  ).toBe(true);
});
