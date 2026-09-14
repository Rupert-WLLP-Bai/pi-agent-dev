import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The contract centre renders a read-only index and a revision history. These
 * specs pin the wire-to-UI contract the API and the shell owe the page:
 * localized status labels, visible names for unknown rule codes, an authored
 * not-found result, and shell geometry that never covers the content.
 */

const listPayload = [
  {
    id: "contract-1",
    title: "设备采购合同",
    createdAt: "2026-09-11T08:00:00.000Z",
    revisionCount: 2,
    latestVersion: 2,
  },
];

const finding = (ruleCode: string) => ({
  ruleCode,
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  severity: "HIGH" as const,
});

const detailPayload = {
  contract: {
    id: "contract-1",
    title: "设备采购合同",
    createdAt: "2026-09-11T08:00:00.000Z",
  },
  revisions: [
    {
      revision: {
        id: "rev-1",
        contractId: "contract-1",
        version: 1,
        sourceRecordId: "src-1",
        label: "v1",
        createdAt: "2026-09-11T08:00:00.000Z",
      },
      auditCaseId: "case-1",
      caseStatus: "COMPLETED",
      caseStage: "COMPLETED",
      findingPins: [finding("ADVANCE_PAYMENT_LIMIT")],
    },
    {
      revision: {
        id: "rev-2",
        contractId: "contract-1",
        version: 2,
        sourceRecordId: "src-2",
        label: "v2",
        createdAt: "2026-09-12T08:00:00.000Z",
      },
      // Finished the machine lifecycle but still awaiting a human sign-off: the
      // status alone would read 已完成, so the stage is what the badge shows.
      auditCaseId: "case-2",
      caseStatus: "COMPLETED",
      caseStage: "AWAITING_REVIEW",
      findingPins: [finding("ADVANCE_PAYMENT_LIMIT"), finding("UNKNOWN_RULE")],
    },
  ],
  diffs: [
    {
      fromVersion: 1,
      toVersion: 2,
      diff: {
        introduced: [finding("UNKNOWN_RULE")],
        resolved: [],
        persisting: [finding("ADVANCE_PAYMENT_LIMIT")],
      },
    },
  ],
};

const routeList = (page: Page) =>
  page.route("**/api/contracts", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: listPayload }) : route.continue(),
  );

const routeDetail = (page: Page) =>
  page.route("**/api/contracts/contract-1", (route) => route.fulfill({ json: detailPayload }));

test("lists contracts and opens a contract's revision history", async ({ page }) => {
  await routeList(page);
  await routeDetail(page);

  await page.goto("/contracts");

  await expect(page.getByRole("heading", { name: "合同中心" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "设备采购合同" });
  await expect(row).toContainText("最新 v2");
  await expect(row).toContainText("2 个版本");

  await row.getByRole("button", { name: "查看详情" }).click();

  await expect(page).toHaveURL(/\/contracts\/contract-1$/);
  await expect(page.getByRole("heading", { name: "设备采购合同" })).toBeVisible();
});

test("keeps 合同中心 selected and widens the breadcrumb on the detail", async ({ page }) => {
  await routeList(page);
  await routeDetail(page);

  await page.goto("/contracts");
  await expect(page.locator(".app-sider-menu .ant-menu-item-selected")).toHaveText("合同中心");
  await expect(page.locator(".app-breadcrumb")).toContainText("合同中心");

  await page.goto("/contracts/contract-1");
  await expect(page.locator(".app-sider-menu .ant-menu-item-selected")).toHaveText("合同中心");
  await expect(page.locator(".app-breadcrumb")).toContainText("合同中心");
  await expect(page.locator(".app-breadcrumb")).toContainText("合同详情");
});

test("shows localized revision status and rule names, never raw codes", async ({ page }) => {
  await routeList(page);
  await routeDetail(page);

  await page.goto("/contracts/contract-1");

  const revisionsCard = page.locator(".ant-card").filter({ hasText: "合同版本与审计" });
  const v2Row = revisionsCard.getByRole("row").filter({ hasText: "v2" });
  await expect(v2Row).toContainText("待复核");

  const diffCard = page.locator(".ant-card").filter({ hasText: "相邻版本风险变化" });
  await expect(diffCard).toContainText("预付款上限规则");
  // A code the label catalog does not know stays visible rather than vanishing.
  await expect(diffCard).toContainText("UNKNOWN_RULE");

  // No raw enums or internal vocabulary leak into the rendered page.
  await expect(page.getByText("COMPLETED")).toHaveCount(0);
  await expect(page.getByText("AWAITING_REVIEW")).toHaveCount(0);
  await expect(page.getByText("Contract Revision")).toHaveCount(0);
  await expect(page.getByText("finding")).toHaveCount(0);
});

test("renders the authored not-found result for a missing contract", async ({ page }) => {
  await page.route("**/api/contracts/missing", (route) =>
    route.fulfill({ status: 404, json: { error: "contract_not_found" } }),
  );

  await page.goto("/contracts/missing");

  await expect(page.getByText("合同不存在")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回合同中心" })).toBeVisible();
  await expect(page.getByText("无法加载合同详情")).toHaveCount(0);
});

test("keeps the rail in flow and content clear of it at tablet width", async ({ page }) => {
  await page.setViewportSize({ width: 975, height: 1064 });
  await routeList(page);
  await routeDetail(page);

  await page.goto("/contracts");

  const sider = page.locator(".app-sider");
  const siderBox = await sider.boundingBox();
  const headingBox = await page.getByRole("heading", { name: "合同中心" }).boundingBox();
  expect(siderBox).not.toBeNull();
  expect(headingBox).not.toBeNull();

  // A 64px in-flow rail; the heading begins after it plus a 16px gutter.
  expect(siderBox!.width).toBeLessThanOrEqual(64);
  expect(headingBox!.x).toBeGreaterThanOrEqual(siderBox!.x + siderBox!.width + 15);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("drops the sider and opens a 260px drawer on mobile without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await routeList(page);
  await routeDetail(page);

  await page.goto("/contracts");
  await expect(page.locator(".app-sider")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await page.getByRole("button", { name: "打开菜单" }).click();
  const panel = page.locator(".ant-drawer-content-wrapper");
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(Math.round(panelBox!.width)).toBe(260);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await page.goto("/contracts/contract-1");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
