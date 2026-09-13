import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";

/**
 * These specs create real rules (and an ADVANCE draft) through the live API,
 * so they must not leave test rows in the shared dev database.
 */
test.afterAll(async () => {
  const envFile = readFileSync(".env", "utf8");
  const match = envFile.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error("DATABASE_URL missing from .env — cannot clean up test rules");
  const sql = postgres(match[1].trim());
  try {
    await sql`delete from rules where code like 'PLAYWRIGHT_RULE_%'`;
    await sql`delete from rule_versions where status = 'draft'
      and rule_id in (select id from rules where code = 'ADVANCE_PAYMENT_LIMIT')`;
    // The runtime toggle spec stops a seeded rule; the shared dev database must
    // not keep it off for the next run even if that spec died mid-flight.
    await sql`update rules
      set enabled = true, disabled_reason = null, disabled_by = null, disabled_at = null
      where code = 'ADVANCE_PAYMENT_LIMIT' and enabled = false`;
  } finally {
    await sql.end();
  }
});

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API not reachable via web origin (status ${response.status()}); is the dev stack up?`,
  ).toBe(true);
}

/**
 * Puts ADVANCE_PAYMENT_LIMIT back in force. The runtime toggle test disables a
 * seeded rule in the shared dev database, so it is restored through the API at
 * the end of that test rather than only after the whole file.
 */
async function reEnableAdvanceRule(page: Page) {
  const response = await page.request.get("/api/rules");
  if (!response.ok()) return;
  const rules = (await response.json()) as Array<{ id: string; code: string; enabled: boolean }>;
  const advance = rules.find((rule) => rule.code === "ADVANCE_PAYMENT_LIMIT");
  if (advance && !advance.enabled) {
    await page.request.post(`/api/rules/${advance.id}/enable`, { data: {} });
  }
}

/**
 * The visible tab panel. Ant keeps visited tabs mounted and marks the inactive
 * ones hidden, so the active pane is selected by its own class.
 */
const activePanel = (page: Page) => page.locator('[role="tabpanel"].ant-tabs-content-active');

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
  await expect(activePanel(page)).toBeVisible();
}

/**
 * Ant inserts a space between two CJK characters in a Button, so the accessible
 * name of 保存 is "保 存". Matching on the words keeps the spec readable.
 */
const button = (scope: Page | Locator, label: string) =>
  scope.getByRole("button", { name: new RegExp(label.split("").join("\\s*")) });

async function openAdvanceRule(page: Page) {
  await page.goto("/rules");
  const row = page.getByRole("row", { name: /ADVANCE_PAYMENT_LIMIT/ });
  await row.getByRole("button", { name: /打\s*开/ }).click();
  await page.waitForURL(/\/rules\/[0-9a-f-]{36}$/);
}

/**
 * Saves a draft whose first parameter is the advance/penalty ceiling. Creates
 * the parameter row when the rule has none yet, so it works for both a seeded
 * rule and a freshly created one.
 */
async function saveLimitRatio(page: Page, value: string) {
  await openTab(page, "审查逻辑");
  const panel = activePanel(page);
  const paramValue = panel.getByLabel("参数值 1");
  if ((await paramValue.count()) === 0) {
    await button(panel, "添加参数").click();
    await panel.getByLabel("参数名 1").fill("limitRatio");
  }
  await paramValue.fill(value);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/versions") && response.request().method() !== "GET",
    ),
    button(panel, "保存").click(),
  ]);
  await expect(page.getByText(/草稿 v\d+/)).toBeVisible();
}

async function runValidation(page: Page) {
  await openTab(page, "验证案例");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/validate")),
    button(activePanel(page), "按当前草稿运行验证").click(),
  ]);
}

async function publish(page: Page) {
  await openTab(page, "发布记录");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/publish")),
    button(activePanel(page), "发布").click(),
  ]);
}

test("lists the seeded rules with their codes and contract types", async ({ page }) => {
  await assertApiReachable(page);
  await page.goto("/rules");

  await expect(page.getByRole("heading", { name: "规则管理" })).toBeVisible();
  for (const code of [
    "ADVANCE_PAYMENT_LIMIT",
    "PENALTY_RATIO_LIMIT",
    "TERMINATION_CLAUSE_PRESENT",
    "DISPUTE_JURISDICTION",
    "SUBJECT_RED_LINE_RISK",
  ]) {
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("预付款上限规则")).toBeVisible();
  await expect(page.getByText("系统初始化").first()).toBeVisible();
});

test("creates a rule, gates its publish on validation, and lands a v2", async ({ page }) => {
  await assertApiReachable(page);
  const uniqueCode = `PLAYWRIGHT_RULE_${Date.now()}`;
  const uniqueName = `验收规则 ${uniqueCode}`;

  await page.goto("/rules");
  await page.getByRole("button", { name: "新建规则" }).click();
  const modal = page.getByRole("dialog", { name: "新建规则" });
  await modal.getByLabel("规则名").fill(uniqueName);
  await modal.getByLabel("规则代码").fill(uniqueCode);
  await modal.getByLabel("适用合同类型").fill("全部");
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/api/rules") && response.request().method() === "POST",
    ),
    button(modal, "创建").click(),
  ]);
  await page.waitForURL(/\/rules\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
  await expect(page.getByText(/草稿 v1/)).toBeVisible();

  // A draft without a run cannot be published, and the button says why.
  await openTab(page, "发布记录");
  await expect(button(activePanel(page), "发布")).toBeDisabled();
  await expect(page.getByText("尚未运行验证")).toBeVisible();

  await runValidation(page);
  await expect(activePanel(page).getByText(/通过/).first()).toBeVisible();

  await openTab(page, "发布记录");
  await expect(button(activePanel(page), "发布")).toBeEnabled();
  await publish(page);
  await expect(page.getByText(/已发布 v1/)).toBeVisible();

  // A second draft publishes as v2.
  await saveLimitRatio(page, "0.4");
  await runValidation(page);
  await expect(activePanel(page).getByText(/通过/).first()).toBeVisible();
  await publish(page);
  await expect(page.getByText(/已发布 v2/)).toBeVisible();

  await page.goto("/rules");
  const row = page.getByRole("row", { name: new RegExp(uniqueCode) });
  await expect(row).toContainText("v2");
  await expect(row).toContainText("已发布");
  await expect(row).toContainText("规则管理员");
});

test("blocks publish with the failing case count when a draft regresses", async ({ page }) => {
  await assertApiReachable(page);
  await openAdvanceRule(page);

  // A 50% ceiling contradicts the labelled 30% and 31% conflict cases.
  await saveLimitRatio(page, "0.5");
  await runValidation(page);
  await expect(activePanel(page).getByText(/失败/).first()).toBeVisible();

  await openTab(page, "发布记录");
  await expect(button(activePanel(page), "发布")).toBeDisabled();
  await expect(activePanel(page).getByText("验证未通过：2 例失败")).toBeVisible();
});

test("disables a rule and omits it from new audits", async ({ page }) => {
  await assertApiReachable(page);
  // A previous aborted run may have left the seeded rule off; start from on.
  await reEnableAdvanceRule(page);
  await page.goto("/rules");

  const advanceRow = page.getByRole("row", { name: /ADVANCE_PAYMENT_LIMIT/ });
  await expect(advanceRow).toBeVisible();
  await expect(advanceRow.getByText("运行中")).toBeVisible();

  try {
    // Stopping a rule is a confirmed action: the toggle opens a modal whose
    // reason is required before the disable is actually submitted.
    await advanceRow.getByRole("switch").click();
    const confirm = page.getByRole("dialog", { name: /停用规则/ });
    await expect(confirm).toBeVisible();
    await confirm.getByLabel("停用原因").fill("演示关闭预付款规则");
    await button(confirm, "停用").click();

    await expect(advanceRow.getByText("已停用")).toBeVisible({ timeout: 5000 });

    // A case assembled while the rule is off must not carry its finding.
    await page.goto("/audit-cases");
    await page.getByRole("button", { name: "新建审计" }).click();
    await expect(page.getByRole("dialog", { name: "新建审计" })).toBeVisible();
    await page.getByRole("button", { name: "加载演示合同" }).click();
    await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
    await page.getByRole("button", { name: "开始审计" }).click();
    await page.waitForURL(/\/audit-cases\/.+$/);

    // The other demo conflict still settles, which proves the run finished —
    // the absence below is the overlay taking effect, not a slow load.
    await expect(page.locator(".review-workspace")).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(".finding-list").getByText("争议管辖地与我方不一致", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(".finding-list").getByText("预付款比例超过制度上限", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("预付款比例高于制度上限")).toHaveCount(0);
  } finally {
    // The dev database is shared across specs, so the disabled rule cannot
    // outlive this test.
    await reEnableAdvanceRule(page);
  }
});
