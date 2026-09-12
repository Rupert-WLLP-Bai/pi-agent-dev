import { test, expect } from "@playwright/test";
import type { AuditCase } from "@contract-audit/audit/model";

/** Queue rows carry the contract title and finding summary resolved by the API list join. */
interface QueueCase extends AuditCase {
  contractTitle: string | null;
  findingCount: number;
  highestSeverity: "LOW" | "MEDIUM" | "HIGH" | null;
}

const caseAt = (
  id: string,
  status: AuditCase["status"],
  stage: AuditCase["stage"],
  updatedAt: string,
  contractTitle: string | null,
  findingCount = 0,
  highestSeverity: QueueCase["highestSeverity"] = null,
): QueueCase => ({
  id,
  status,
  stage,
  sourceRecordId: `00000000-0000-4000-8000-0000000000${id.length}${id.charCodeAt(0) % 10}`,
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt,
  contractTitle,
  findingCount,
  highestSeverity,
});

const queueCases = (): QueueCase[] => [
  caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T11:00:00.000Z", "设备采购合同", 3, "HIGH"),
  caseAt("failed", "FAILED", "FAILED", "2026-09-11T10:00:00.000Z", "原材料买卖合同", 1, "MEDIUM"),
  caseAt("interrupted", "INTERRUPTED", "INTERRUPTED", "2026-09-11T09:30:00.000Z", null, 0, null),
  caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z", "电子元件采购合同", 2, "LOW"),
  caseAt("done", "COMPLETED", "COMPLETED", "2026-09-11T08:30:00.000Z", "办公场地租赁合同", 1, "HIGH"),
];

const QUEUE_SEARCH = "搜索合同名称 / 审计 ID / 来源记录 ID";

test("shows contract titles and keeps the audit ID as a secondary identity", async ({ page }) => {
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: queueCases() })
      : route.continue(),
  );

  await page.goto("/audit-cases");

  // Contract title leads; the UUID is demoted and copyable.
  await expect(page.getByText("设备采购合同", { exact: true })).toBeVisible();
  await expect(page.getByText("电子元件采购合同", { exact: true })).toBeVisible();
  // A case without a contract title must not fall back to the raw UUID.
  await expect(page.getByText("未命名合同")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制审计 ID" }).first()).toBeVisible();

  // Risk comes from real findings: severity, count, and an explicit dash when none.
  const runningRow = page.getByRole("row").filter({ hasText: "设备采购合同" });
  await expect(runningRow.locator(".risk-cell.risk-high")).toHaveText(/高\s*·\s*3/);

  const mediumRow = page.getByRole("row").filter({ hasText: "原材料买卖合同" });
  await expect(mediumRow.locator(".risk-cell.risk-medium")).toHaveText(/中\s*·\s*1/);

  const noFindingRow = page.getByRole("row").filter({ hasText: "未命名合同" });
  await expect(noFindingRow.locator(".risk-cell")).toHaveCount(0);
});

test("filters by lifecycle and searches contract name and ID", async ({ page }) => {
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: queueCases() })
      : route.continue(),
  );

  await page.goto("/audit-cases");
  await expect(page.getByText("待复核", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("处理中", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("异常", { exact: true }).first()).toBeVisible();

  await page.locator(".queue-toolbar").getByText("异常", { exact: true }).click();
  await expect(page.getByText("原材料买卖合同")).toBeVisible();
  await expect(page.getByText("未命名合同")).toBeVisible();
  await expect(page.getByText("设备采购合同", { exact: true })).toBeHidden();

  await page.locator(".queue-toolbar").getByText("全部", { exact: true }).click();
  await page.getByPlaceholder(QUEUE_SEARCH).fill("电子元件");
  await expect(page.getByText("电子元件采购合同")).toBeVisible();
  await expect(page.getByText("设备采购合同", { exact: true })).toBeHidden();

  // Searching by audit ID still resolves.
  await page.getByPlaceholder(QUEUE_SEARCH).fill("");
  await page.getByPlaceholder(QUEUE_SEARCH).fill("running");
  await expect(page.getByText("设备采购合同", { exact: true })).toBeVisible();
});

test("confirms cancellation and retry and shows localized results", async ({ page }) => {
  let cases = queueCases();
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: cases })
      : route.continue(),
  );
  await page.route("**/api/audit-cases/running/cancel", (route) => {
    cases = cases.map((auditCase) =>
      auditCase.id === "running"
        ? { ...auditCase, status: "CANCELLED", stage: "CANCELLED" }
        : auditCase,
    );
    return route.fulfill({ json: { id: "running", status: "CANCELLED" } });
  });
  await page.route("**/api/audit-cases/failed/retry", (route) => {
    cases = cases.map((auditCase) =>
      auditCase.id === "failed"
        ? { ...auditCase, status: "PENDING", stage: "QUEUED" }
        : auditCase,
    );
    return route.fulfill({ json: { id: "failed", status: "PENDING" } });
  });

  await page.goto("/audit-cases");

  const runningRow = page.getByRole("row").filter({ hasText: "设备采购合同" });
  await runningRow.getByRole("button", { name: /取\s*消/ }).click();
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(runningRow.getByText("已取消").first()).toBeVisible();

  const failedRow = page.getByRole("row").filter({ hasText: "原材料买卖合同" });
  await failedRow.getByRole("button", { name: /重\s*试/ }).click();
  await page.getByRole("button", { name: "确认重试" }).click();
  await expect(failedRow.getByText("排队中")).toBeVisible();
});

test("scrolls the queue table internally on mobile without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: queueCases() })
      : route.continue(),
  );

  await page.goto("/audit-cases");
  await expect(page.getByText("设备采购合同", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
