import { expect, type Page, test } from "@playwright/test";

async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API not reachable via web origin (status ${response.status()}); is the dev stack up?`,
  ).toBe(true);
}

test("demo page plants typical cases and surfaces cross-case history", async ({ page }) => {
  test.setTimeout(90_000);
  await assertApiReachable(page);
  const seed = await page.request.post("/api/demo/world", {
    data: { reset: true, fillerCount: 4, rngSeed: 1 },
  });
  expect(seed.ok(), `seed failed: ${seed.status()} ${await seed.text()}`).toBe(true);
  const body = (await seed.json()) as {
    seededCaseCount: number;
    scenarios: Array<{
      id: string;
      cases: Array<{ caseId: string; caseKey: string; stage: string }>;
    }>;
  };
  expect(body.seededCaseCount).toBeGreaterThan(4);

  const featured = body.scenarios.find((scenario) => scenario.id === "cross-case-missed-link");
  const nextCase = featured?.cases.find((item) => item.caseKey === "history-new-clean-look");
  expect(nextCase?.caseId).toBeTruthy();

  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "演示概览" })).toBeVisible();
  await expect(page.getByText("跨案漏关联")).toBeVisible();
  await expect(page.getByText("劳务分包合同（条款看似合规）")).toBeVisible();

  await page.goto(`/audit-cases/${nextCase?.caseId}`);
  await expect(page.getByRole("heading", { name: /相对方历史案件/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("重型设备租赁合同").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "打开" }).first()).toBeVisible();
});

test("the rules table fills the remaining viewport instead of scrolling the page", async ({
  page,
}) => {
  await assertApiReachable(page);
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "规则管理" })).toBeVisible();
  const content = page.locator(".app-content");
  await expect(content).toBeVisible();
  const scrolled = await content.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(scrolled).toBeLessThanOrEqual(8);
  await expect(page.locator(".page-table-fill .ant-table-header")).toBeVisible();
});
