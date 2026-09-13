import { expect, type Page, test } from "@playwright/test";

/**
 * 整改跟踪 end-to-end: the closure of the 发现 → 整改 → 复核 → 关闭 loop.
 *
 * 1. Submit the default demo contract (two findings) and confirm both as risk.
 * 2. Each acceptance opens one remediation card in 待整改.
 * 3. Set an owner and an already-passed deadline; the card shows overdue.
 * 4. Advance 待整改 → 整改中 → 待复核.
 * 5. The owner cannot close their own item; a different reviewer can.
 * 6. The closed card links back to the audit case with origin=remediations.
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
  await expect(page.getByText("预付款比例高于制度上限").first()).toBeVisible({ timeout: 15000 });
  return page.url().split("/").pop()!;
}

/** Confirms every chain-head finding on the open case as risk. */
async function confirmBothFindings(page: Page) {
  for (const label of ["预付款比例超过制度上限", "争议管辖地与我方不一致"]) {
    await page.locator(".finding-list").getByText(label, { exact: true }).click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(page.getByText("复核已提交")).toBeVisible();
  }
}

test("remediation items auto-create, advance, and close only by a reviewer", async ({ page }) => {
  const caseId = await createDemoAudit(page);
  await confirmBothFindings(page);

  // ── 1. Each accepted finding opens a card in 待整改 ──
  await page.goto("/remediations");
  await expect(page.getByRole("heading", { name: "整改跟踪" })).toBeVisible();
  const columns = page.locator(".remediation-column");
  await expect(columns.nth(0)).toContainText("待整改");
  const pendingCards = columns.nth(0).locator(`.remediation-card[data-case-id="${caseId}"]`);
  await expect(pendingCards).toHaveCount(2);

  // ── 2. Open a card and set owner + an already-passed deadline ──
  await pendingCards.first().click();
  const drawer = page.locator(".remediation-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("责任人").fill("张工");
  await drawer.getByLabel("截止时间").fill("2020-01-01");
  await drawer.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已更新整改项").first()).toBeVisible();
  await expect(drawer.getByLabel("责任人")).toHaveValue("张工");

  // ── 3. 推进 → 整改中; the missed deadline now reads 已逾期 ──
  await drawer.getByRole("button", { name: "推进至整改中" }).click();
  await expect(page.getByText("已更新整改项").first()).toBeVisible();
  await expect(drawer.getByText("整改中", { exact: true })).toBeVisible();
  await expect(columns.nth(1)).toContainText("已逾期");

  // ── 4. 推进 → 待复核 ──
  await drawer.getByRole("button", { name: "推进至待复核" }).click();
  await expect(page.getByText("已更新整改项").first()).toBeVisible();
  await expect(drawer.getByText("待复核", { exact: true })).toBeVisible();

  // ── 5. The owner may not confirm their own fix ──
  await drawer.getByRole("button", { name: "关闭整改项" }).click();
  const closeDialog = page.getByRole("dialog", { name: /复核人确认/ });
  await expect(closeDialog).toBeVisible();
  await closeDialog.getByLabel("复核人").fill("张工");
  await expect(closeDialog.getByText("复核人与责任人为同一人")).toBeVisible();
  await closeDialog.getByRole("button", { name: "确认关闭" }).click();
  await expect(
    closeDialog.getByText("责任人不能自行关闭；请由复核人确认", { exact: true }),
  ).toBeVisible();

  // ── 6. A different reviewer closes it ──
  await closeDialog.getByLabel("复核人").fill("李复核");
  await closeDialog.getByRole("button", { name: "确认关闭" }).click();
  await expect(page.getByText("整改项已关闭").first()).toBeVisible();
  await expect(columns.nth(3).locator(`.remediation-card[data-case-id="${caseId}"]`)).toHaveCount(1);

  // ── 7. The card links back to the case, carrying the remediation origin ──
  await columns
    .nth(3)
    .locator(`.remediation-card[data-case-id="${caseId}"]`)
    .first()
    .click();
  await page.locator(".remediation-drawer").getByRole("button", { name: "打开审计案件" }).click();
  await expect(page).toHaveURL(new RegExp(`/audit-cases/${caseId}\\?origin=remediations`));
  await expect(page.getByRole("button", { name: /返回整改跟踪/ })).toBeVisible();
});
