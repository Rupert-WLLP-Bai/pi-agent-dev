import type { AgentRun } from "@contract-audit/audit/model";
import { expect, type Page, test } from "@playwright/test";
import type { RemediationBoard } from "../../apps/api/src/db/repositories";
import type { AuditCaseDetailData } from "../../apps/web/src/components/audit-case-workbench";
import { deleteCasesAndRelations } from "./db-cleanup";

/** Every case this file audits through the live API, removed afterAll. */
const createdCaseIds: string[] = [];

test.afterAll(async () => {
  await deleteCasesAndRelations(createdCaseIds.splice(0));
});

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

async function createDemoAudit(page: Page) {
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
  createdCaseIds.push(page.url().split("/").pop()!);
  await expectAdvancePaymentFinding(page);
}

/**
 * Waits for the demo audit's advance-payment risk to reach the finding list.
 *
 * The gate is the list entry, not the inspector's 判断依据 text: the inspector
 * shows whichever finding sorts first, and the dev database is shared across
 * specs, so every run that confirms a risk for the demo counterparty feeds
 * 相对方历史关联 until it outranks this one and the rationale is no longer on
 * screen. The list entry is true whatever is selected.
 */
async function expectAdvancePaymentFinding(page: Page) {
  await expect(
    page.locator(".finding-list").getByText("预付款比例超过制度上限", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
}

/**
 * Confirms every finding still awaiting a decision as risk.
 *
 * How many that is depends on the shared database, so the loop is driven by the
 * list rather than by a fixed set of labels. The list defaults to 待处理 and a
 * decision drops the finding out of it, which is why each round takes the first
 * entry and why the shrinking count — not the 复核已提交 toast, which lingers
 * from the previous round — is what marks progress.
 */
async function confirmPendingFindings(page: Page) {
  const findings = page.locator(".finding-item");
  for (let remaining = await findings.count(); remaining > 0; remaining -= 1) {
    await findings.first().click();
    await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();
    const dialog = page.getByRole("dialog", { name: "确认风险" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认风险" }).click();
    await expect(findings).toHaveCount(remaining - 1);
  }
}

test("renders the application shell with brand, navigation, and pages", async ({ page }) => {
  await page.goto("/");

  // Root redirects to the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计队列", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "审计驾驶舱", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计驾驶舱" })).toBeVisible();

  await page.getByRole("link", { name: "审计队列", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审计队列" })).toBeVisible();
});

test("loads every brand image without a broken or blank brand area", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/brands/") && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/dashboard");

  // The sider starts expanded on desktop, so the full lockup must be present.
  const lockup = page.locator(".brand-lockup");
  await expect(lockup).toBeVisible();

  const brandImages = lockup.locator("img");
  await expect(brandImages).not.toHaveCount(0);
  const count = await brandImages.count();

  for (let index = 0; index < count; index += 1) {
    const image = brandImages.nth(index);
    await expect(image).toBeVisible();
    // A 200 response is not enough: the decoded image must have real pixels.
    // Visibility does not imply decoded — an <img> occupies its box before the
    // bytes arrive, and on a cold dev server they arrive late — so poll rather
    // than read naturalWidth once.
    await expect
      .poll(async () => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }

  // The organisation wordmark must render even if the mark is unavailable.
  await expect(lockup.getByText("中国移动", { exact: true })).toBeVisible();
  expect(failedRequests).toEqual([]);
});

test("the sidebar follows the operator's choice on every route, and a narrow viewport overrides it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit-cases");

  const sider = page.locator(".app-sider");
  const siderWidth = async () => Math.round((await sider.boundingBox())!.width);
  await expect(sider).toBeVisible();
  expect(await siderWidth()).toBeGreaterThan(200);

  await createDemoAudit(page);

  // Opening a case does not narrow the rail: the design spec (§3.2) keeps the
  // width the operator's to decide on every route, so switching sections stays
  // one click away.
  expect(await siderWidth()).toBeGreaterThan(200);

  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect.poll(siderWidth, { timeout: 5000 }).toBeLessThanOrEqual(64);
  await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();

  // The choice is remembered, so leaving the case keeps the rail collapsed.
  await page.goto("/audit-cases");
  await expect.poll(siderWidth).toBeLessThanOrEqual(64);

  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect.poll(siderWidth).toBeGreaterThan(200);

  // A viewport too narrow for the full rail overrides the preference.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(siderWidth).toBeLessThanOrEqual(64);
});

test("renders the three-pane review workspace with a located quote", async ({ page }) => {
  await createDemoAudit(page);

  const workspace = page.locator(".review-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator("> .finding-nav")).toBeVisible();
  await expect(workspace.locator("> .document-stage")).toBeVisible();
  await expect(workspace.locator("> .inspector")).toBeVisible();

  // The contract original must be shown, not just an excerpt.
  await expect(workspace.locator(".document-block").first()).toBeVisible();
  expect(await workspace.locator(".document-block").count()).toBeGreaterThan(1);

  // The cited clause is highlighted in the document and has a problem marker.
  expect(await workspace.locator(".document-block.has-problem").count()).toBeGreaterThan(0);

  // The fact comparison below belongs to the advance-payment finding, so select
  // it rather than trusting it to be the one the list opened on.
  await workspace
    .locator(".finding-list")
    .getByText("预付款比例超过制度上限", { exact: true })
    .click();

  // Fact comparison pins actual vs. limit.
  await expect(workspace.locator(".fact-cell.bad b")).toHaveText("50%");
  await expect(workspace.locator(".fact-cell.ref b")).toHaveText("30%");
});

test("records a confirmed risk and retains the business wording", async ({ page }) => {
  await createDemoAudit(page);

  expect(await page.locator(".finding-item").count()).toBeGreaterThan(1);
  await confirmPendingFindings(page);

  await page.reload();
  // Nothing is pending now, so the decisions have to be read back on 全部.
  await page.getByRole("button", { name: /^全部/ }).click();
  await expect(page.getByText("已确认风险").first()).toBeVisible();
  // The status badge is the case's state; the step list always shows 已完成.
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});

test("re-audits a reviewed case as a new case, leaving the original history untouched", async ({
  page,
}) => {
  await createDemoAudit(page);
  const caseId = page.url().split("/").pop()!;
  await confirmPendingFindings(page);
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();

  const readDetail = async (caseIdToRead: string): Promise<AuditCaseDetailData> =>
    (await page.request.get(`/api/audit-cases/${caseIdToRead}`)).json();
  const readRuns = async (caseIdToRead: string): Promise<Array<{ run: AgentRun }>> =>
    (await page.request.get(`/api/audit-cases/${caseIdToRead}/trace`)).json();
  const readRemediations = async (caseIdToRead: string): Promise<RemediationBoard["columns"]> => {
    const board: RemediationBoard = await (await page.request.get("/api/remediations")).json();
    return board.columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => item.caseId === caseIdToRead),
    }));
  };
  const before = await readDetail(caseId);
  const originalRuns = await readRuns(caseId);
  const originalRemediations = await readRemediations(caseId);
  const originalFindingIds = before.findings.map((finding) => finding.id);

  // A reviewed case is offered 重新审计 (a NEW case), never 重新运行 Agent
  // (retry in place): retrying would append fresh findings into work a human
  // already decided. The retry control must not exist for this case.
  await expect(page.getByRole("button", { name: "重新运行 Agent", exact: true })).toHaveCount(0);
  const rerun = page.getByRole("button", { name: "重新审计", exact: true }).first();
  await expect(rerun).toBeVisible();

  // Dismissing the confirmation must leave the case, its run and its
  // remediations exactly as they were.
  await rerun.click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: /返\s*回/ })
    .click();
  expect(await readRuns(caseId)).toEqual(originalRuns);
  expect((await readDetail(caseId)).case.status).toBe("COMPLETED");

  await rerun.click();
  const rerunResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/audit-cases/${caseId}/rerun`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认重新审计" }).click();
  expect((await rerunResponse).status()).toBe(202);

  // The client navigates to the fresh case, so the operator watches the new
  // audit rather than the reviewed one.
  await page.waitForURL(/\/audit-cases\/.+$/);
  const newCaseId = page.url().split("/").pop()!;
  expect(newCaseId).not.toBe(caseId);
  createdCaseIds.push(newCaseId);

  // ── The new case: its own identity, its own run ──
  const after = await readDetail(newCaseId);
  expect(after.case.id).toBe(newCaseId);
  expect(after.case.status).not.toBe("COMPLETED");
  // Same Source Record and same Contract Revision: the same bytes are re-read,
  // not registered as a new document version.
  expect(after.case.sourceRecordId).toBe(before.case.sourceRecordId);
  expect(after.case.contractRevisionId).toBe(before.case.contractRevisionId);
  // The fresh case starts empty: it is the audit about to run that produces
  // its findings, not a copy of the reviewed ones.
  expect(after.findings).toEqual([]);
  const newRuns = await readRuns(newCaseId);
  expect(newRuns.map(({ run }) => run.id)).not.toEqual(originalRuns.map(({ run }) => run.id));

  // ── The original case: reviewed history is immutable ──
  const afterOriginal = await readDetail(caseId);
  expect(afterOriginal.case.status).toBe("COMPLETED");
  expect(afterOriginal.case.sourceRecordId).toBe(before.case.sourceRecordId);
  expect(afterOriginal.case.contractRevisionId).toBe(before.case.contractRevisionId);
  // Same findings, same reviews, same snapshot and same rule assessments.
  expect(afterOriginal.findings.map((finding) => finding.id)).toEqual(originalFindingIds);
  for (const finding of before.findings) {
    expect(afterOriginal.findings.find((item) => item.id === finding.id)).toEqual(finding);
  }
  expect(afterOriginal.snapshot).toEqual(before.snapshot);
  expect(afterOriginal.ruleAssessments).toEqual(before.ruleAssessments);
  // The run list of the original case is unchanged: no new run was appended
  // into it, which is exactly what retry would have done.
  expect(await readRuns(caseId)).toEqual(originalRuns);
  // Remediation items opened by accepting findings stay on the original case.
  expect(await readRemediations(caseId)).toEqual(originalRemediations);
});

test("requires a reason for a false positive and retains the decision", async ({ page }) => {
  await createDemoAudit(page);

  // Reject by name, so the decision can be found again after the reload below.
  const rejected = "预付款比例超过制度上限";
  await page.locator(".finding-list").getByText(rejected, { exact: true }).click();
  await page.locator(".inspector-actions").getByRole("button", { name: "判定误报" }).click();
  const dialog = page.getByRole("dialog", { name: "判定误报" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("请输入误报理由")).toBeVisible();

  await page.getByLabel("复核理由").fill("合同证据不足以支持该风险等级");
  await dialog.getByRole("button", { name: "确认误报" }).click();
  await expect(page.getByText("复核已提交")).toBeVisible();

  // A rejected finding is one decision; every remaining finding still needs one
  // before the case can complete.
  await confirmPendingFindings(page);

  await page.reload();
  // Nothing is pending now, so the decision has to be read back on 全部.
  await page.getByRole("button", { name: /^全部/ }).click();
  await page.locator(".finding-list").getByText(rejected, { exact: true }).click();
  await expect(page.getByText("已判定误报").first()).toBeVisible();
  await expect(page.getByText("合同证据不足以支持该风险等级")).toBeVisible();
  await expect(page.locator(".audit-state-badge", { hasText: "已完成" })).toBeVisible();
});

test("opens the review drawer for the finding selected in the risk list", async ({ page }) => {
  await createDemoAudit(page);

  // The first finding is selected by default; pick the second one explicitly.
  await page.locator(".finding-list").getByText("争议管辖地与我方不一致", { exact: true }).click();
  await page.locator(".inspector-actions").getByRole("button", { name: "确认风险" }).click();

  const drawer = page.getByRole("dialog", { name: "确认风险" });
  await expect(drawer).toBeVisible();
  // The drawer must describe the finding that was chosen, not whichever one
  // happened to be first in the list.
  await expect(drawer.locator(".review-summary")).toContainText("争议管辖地与我方所在地不一致");
  await expect(drawer.locator(".review-summary")).not.toContainText("预付款比例高于制度上限");
});
