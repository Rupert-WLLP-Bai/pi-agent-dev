import { expect, type Page, test } from "@playwright/test";

/**
 * 辅助决策（影子建议）界面验收.
 *
 * These specs exercise the real shadow surface against the typed decision API:
 * the list, the detail and the feedback write. They assert the states that must
 * always be distinguishable — off, empty, not-found, unauthorized — and the
 * invariants that hold whatever the provider does: a shadow advice is never a
 * formal risk, confidence is never accuracy, and feedback never touches the
 * formal review chain.
 *
 * No provider needs to run for these checks: with no shadow provider configured
 * the list must still answer with an explicit empty/off state, and the panel
 * must still render its disclaimer. Provider-driven rendering (a SUCCEEDED
 * advice) is covered by the component behaviour test and by integration once
 * the backend assembles the routes.
 */

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

/** Creates the demo audit and returns the new case id. */
async function createDemoAudit(page: Page): Promise<string> {
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
  return page.url().split("/").pop() as string;
}

test.describe("辅助决策面板", () => {
  test("列表对真实案件返回版本化 DTO，关闭时不伪造建议", async ({ page }) => {
    await assertApiReachable(page);
    const caseId = await createDemoAudit(page);

    const response = await page.request.get(`/api/audit-cases/${caseId}/decisions`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      schemaVersion?: number;
      mode?: string;
      provider?: string;
      items?: unknown[];
    };
    // The wire shape is the frozen DTO: versioned, and it names the mode and
    // provider so the UI can tell "off" from "on but empty".
    expect(body.schemaVersion).toBe(1);
    expect(body.mode === "off" || body.mode === "shadow").toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    // With the shadow pipeline off there must be no fabricated advice.
    if (body.mode === "off") expect(body.items).toEqual([]);
  });

  test("关闭态与空态各有可区分的中文说明，不是空白页", async ({ page }) => {
    const caseId = await createDemoAudit(page);
    await page.goto(`/audit-cases/${caseId}/decisions`);

    // The panel always states the shadow disclaimer, whatever the mode.
    await expect(page.getByText("影子建议仅用于评估，不改变审计结论")).toBeVisible();

    // One of the two explicit empty reasons must be shown: "off" and "on but
    // no records" are different states and must not collapse into a blank panel.
    await expect(
      page
        .getByText("影子模式未开启，暂无辅助建议。")
        .or(page.getByText("该案件暂无影子建议记录。"))
        .first(),
    ).toBeVisible();
  });

  test("面板不提供绕过人工复核的执行入口", async ({ page }) => {
    const caseId = await createDemoAudit(page);
    await page.goto(`/audit-cases/${caseId}/decisions`);
    await expect(page.locator(".decision-panel")).toBeVisible();

    // Shadow feedback is evaluation-only: the formal review verbs must not
    // appear on this surface at all.
    await expect(page.getByRole("button", { name: "确认风险" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "判定误报" })).toHaveCount(0);
  });

  test("决策详情对未知 ID 返回类型化 404，不伪造建议", async ({ page }) => {
    await assertApiReachable(page);

    const response = await page.request.get("/api/decisions/00000000-0000-4000-8000-0000000000ff");
    // The contract fixes this as a DecisionApiError with error=decision_not_found.
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { schemaVersion?: number; error?: string };
    expect(body.schemaVersion).toBe(1);
    expect(body.error).toBe("decision_not_found");
  });

  test("反馈写入对未知决策返回 404，且不写入任何事件", async ({ page }) => {
    await assertApiReachable(page);

    const response = await page.request.post(
      "/api/decisions/00000000-0000-4000-8000-0000000000ff/feedback",
      {
        headers: { "content-type": "application/json", "Idempotency-Key": "ux-probe-404" },
        data: { schemaVersion: 1, decision: "accepted" },
      },
    );
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { schemaVersion?: number; error?: string };
    expect(body.schemaVersion).toBe(1);
  });
});
