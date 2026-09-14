import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const createdCaseIds: string[] = [];

/** Accepting findings opens remediation items — remove this run's artifacts. */
test.afterAll(async () => {
  if (createdCaseIds.length === 0) return;
  const match = readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error("DATABASE_URL missing from .env");
  const sql = postgres(match[1].trim());
  try {
    await sql`delete from remediations where audit_case_id in ${sql(createdCaseIds)}`;
  } finally {
    await sql.end();
  }
});

/**
 * Review Centre end-to-end: the operator's path from queue to closure.
 *
 * 1. Submit the default demo contract (two findings: advance payment + jurisdiction).
 * 2. The review queue shows one row per chain-head finding.
 * 3. Assign the case to the current operator (受理).
 * 4. Open the workbench through the queue; the origin travels in the URL.
 * 5. Review every finding; only then does the case complete.
 * 6. Return to the review centre and confirm the case has left the queue.
 */

async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

const QUEUE_SEARCH = "搜索合同名称 / 发现 / 审计 ID";

/**
 * Runs the demo audit and reports its id together with how many findings it
 * raised. The count is not a constant: 相对方历史关联 joins the demo contract's
 * two risks once the shared database holds a confirmed risk for this
 * counterparty, and the queue below is asserted one row per finding.
 */
async function createDemoAudit(page: Page): Promise<{ caseId: string; findingCount: number }> {
  await assertApiReachable(page);
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "新建审计" }).click();
  await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
  // Gate on the list entry rather than the inspector's 判断依据 text: the
  // inspector shows whichever finding sorts first, and 相对方历史关联 climbs above
  // this one as the shared dev database accumulates confirmed risks.
  await expect(
    page.locator(".finding-list").getByText("预付款比例超过制度上限", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  return {
    caseId: page.url().split("/").pop()!,
    findingCount: await page.locator(".finding-item").count(),
  };
}

test("review centre queues findings, assigns the case, and closes it per finding", async ({
  page,
}) => {
  const { caseId, findingCount } = await createDemoAudit(page);
  createdCaseIds.push(caseId);
  const shortId = `${caseId.slice(0, 8)}…`;

  // ── 1. The queue lists one row per chain-head finding ──
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "复核中心" })).toBeVisible();
  await page.getByPlaceholder(QUEUE_SEARCH).fill(caseId);
  const rows = page.getByRole("row").filter({ hasText: shortId });
  await expect(rows).toHaveCount(findingCount);
  await expect(rows.first()).toContainText("未指派");

  // ── 2. 受理 assigns the case to the current operator ──
  await rows
    .first()
    .getByRole("button", { name: /受\s*理/ })
    .click();
  await expect(page.getByText("已更新复核指派")).toBeVisible();
  // The row is now assigned to this operator, so 受理 no longer applies.
  await expect(rows.first().getByRole("button", { name: /受\s*理/ })).toHaveCount(0);

  // 待我处理 keeps it; 证据不足 drops it (every finding cites evidence).
  await page.locator(".queue-toolbar").getByText("待我处理", { exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: shortId })).toHaveCount(findingCount);
  await page.locator(".queue-toolbar").getByText("证据不足", { exact: true }).click();
  await expect(page.getByText("没有匹配的复核事项")).toBeVisible();
  await page.locator(".queue-toolbar").getByText("全部", { exact: true }).click();
  await page.getByPlaceholder(QUEUE_SEARCH).fill(caseId);

  // ── 3. Opening a row carries the review origin into the workbench ──
  await page
    .getByRole("row")
    .filter({ hasText: shortId })
    .first()
    .locator(".table-title")
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/audit-cases/${caseId}\\?origin=reviews`));
  await expect(page.getByRole("button", { name: /返回复核中心/ })).toBeVisible();

  // ── 4. Every finding must be decided before the case completes ──
  // The list defaults to 待处理 and a decision drops the finding out of it, so
  // each round takes the first entry and the shrinking count marks progress —
  // the 复核已提交 toast lingers from the previous round and cannot.
  const findings = page.locator(".finding-item");
  for (let remaining = findingCount; remaining > 0; remaining -= 1) {
    await findings.first().click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(findings).toHaveCount(remaining - 1);
  }
  // The status badge (not the step list, which always shows a 已完成 step) is
  // the case's own state.
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();

  // ── 5. Returning to the review centre: the case has left the queue ──
  await page.getByRole("button", { name: /返回复核中心/ }).click();
  await expect(page).toHaveURL(/\/reviews$/);
  // The completed case no longer has an awaiting-review queue row, whatever
  // other cases the shared database still holds.
  await expect(page.getByText(shortId)).toHaveCount(0);
});
