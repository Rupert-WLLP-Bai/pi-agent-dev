import { test, expect } from "@playwright/test";
import type { AuditCase } from "@contract-audit/audit/model";

const caseAt = (
  id: string,
  status: AuditCase["status"],
  stage: AuditCase["stage"],
  updatedAt: string,
): AuditCase => ({
  id,
  status,
  stage,
  sourceRecordId: `source-${id}`,
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt,
});

const queueCases = (): AuditCase[] => [
  caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T11:00:00.000Z"),
  caseAt("failed", "FAILED", "FAILED", "2026-09-11T10:00:00.000Z"),
  caseAt("interrupted", "INTERRUPTED", "INTERRUPTED", "2026-09-11T09:30:00.000Z"),
  caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z"),
  caseAt("done", "COMPLETED", "COMPLETED", "2026-09-11T08:30:00.000Z"),
];

test("filters and searches the audit queue", async ({ page }) => {
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: queueCases() })
      : route.continue(),
  );

  await page.goto("/audit-cases");
  await expect(page.getByText("待复核").first()).toBeVisible();
  await expect(page.getByText("处理中").first()).toBeVisible();
  await expect(page.getByText("异常").first()).toBeVisible();

  await page.locator(".queue-toolbar").getByText("异常", { exact: true }).click();
  await expect(page.getByText("合同审计 failed")).toBeVisible();
  await expect(page.getByText("合同审计 interrupted")).toBeVisible();
  await expect(page.getByText("合同审计 running")).toBeHidden();

  await page.locator(".queue-toolbar").getByText("全部", { exact: true }).click();
  await page.getByPlaceholder("搜索任务 ID").fill("RUNNING");
  await expect(page.getByText("合同审计 running")).toBeVisible();
  await expect(page.getByText("合同审计 failed")).toBeHidden();
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

  const runningRow = page.getByRole("row").filter({ hasText: "合同审计 running" });
  await runningRow.getByRole("button", { name: /取\s*消/ }).click();
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(runningRow.getByText("已取消").first()).toBeVisible();

  const failedRow = page.getByRole("row").filter({ hasText: "合同审计 failed" });
  await failedRow.getByRole("button", { name: /重\s*试/ }).click();
  await page.getByRole("button", { name: "确认重试" }).click();
  await expect(failedRow.getByText("排队中")).toBeVisible();
});

test("renders mobile audit cards without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/audit-cases", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: queueCases() })
      : route.continue(),
  );

  await page.goto("/audit-cases");
  await expect(page.getByRole("list", { name: "审计记录" })).toBeVisible();
  await expect(page.locator(".queue-table")).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
