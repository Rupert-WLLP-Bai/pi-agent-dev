import { test, expect, type Page } from "@playwright/test";

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API health check failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

/** Creates an audit from one of the demo contracts in the New Audit drawer. */
async function createDemoAudit(page: Page, demoLabel: string) {
  await assertApiReachable(page);
  await page.goto("/audit-cases");
  await page.getByRole("button", { name: "新建审计" }).click();
  const drawer = page.getByRole("dialog", { name: "新建审计" });
  await expect(drawer).toBeVisible();
  await drawer.getByText(demoLabel, { exact: true }).click();
  await page.getByRole("button", { name: "加载演示合同" }).click();
  await page.getByRole("spinbutton", { name: "制度允许的预付款上限" }).fill("30");
  await page.getByRole("button", { name: "开始审计" }).click();
  await page.waitForURL(/\/audit-cases\/.+$/);
}

/**
 * The inspector section that follows the given heading. Sections are addressed
 * by the Chinese heading an operator reads, not by their CSS class.
 */
function section(page: Page, title: string) {
  return page
    .getByRole("heading", { name: new RegExp(`^${title}`) })
    .locator("..");
}

test("flags a counterparty with a red-line record and anchors the finding", async ({ page }) => {
  await createDemoAudit(page, "工程服务");

  // The finding headline names the subject risk, not the payment one.
  await expect(page.getByText("相对方主体风险").first()).toBeVisible();
  await expect(page.getByText("预付款比例超过制度上限")).toHaveCount(0);

  // 主体核验 lists every party and shows which subject the 乙方 resolved to.
  const subject = section(page, "主体核验");
  await expect(subject).toContainText("甲方 · 深圳精工科技有限公司");
  await expect(subject).toContainText("乙方 · 重庆恒昌建筑工程有限公司");
  await expect(subject).toContainText("已匹配主体");
  await expect(subject).toContainText("91500108MA5U7X2K3D");
  await expect(subject).toContainText("红线 2 项");

  // The rationale names both red-line dimensions with the counts behind them.
  const rationale = section(page, "判断依据");
  await expect(rationale).toContainText("【失信信息】2 条");
  await expect(rationale).toContainText("【被执行人】1 条");

  // Both rules were assessed, even though only the subject one is violated.
  const rules = section(page, "违反规则");
  await expect(rules).toContainText("主体红线规则");
  await expect(rules).toContainText("预付款上限规则");

  // The 外部核验 group carries the provider, a capture time, and the exact
  // evidence ids the finding cites for the red-line hits.
  const evidence = section(page, "证据来源");
  await expect(evidence).toContainText("合同原文");
  await expect(evidence).toContainText("制度依据");
  const external = evidence.getByText("外部核验", { exact: true }).locator("..").locator("..");
  await expect(external).toContainText("提供方 qcc-fixture");
  await expect(external).toContainText(/采集 \d{4}\/\d{1,2}\/\d{1,2}/);
  await expect(external).toContainText("party-2-失信信息");
  await expect(external).toContainText("party-2-被执行人");
});

test("routes an unresolvable counterparty to a human instead of inventing risk", async ({ page }) => {
  await createDemoAudit(page, "备电采购");

  // Wait for the case to reach a terminal state — the finding type depends on
  // which deterministic rules fire, so we poll the API rather than text-match.
  await expect.poll(async () => {
    const match = page.url().match(/\/audit-cases\/(.+)$/);
    if (!match) return "NO_URL";
    const resp = await page.request.get(`/api/audit-cases/${match[1]}`);
    if (!resp.ok()) return "NO_CASE";
    return (await resp.json()).case?.status;
  }, { timeout: 30_000 }).toBe("COMPLETED");

  // The 乙方 has no organization suffix, so the provider answers ambiguously
  // and hands the decision back to the reviewer.
  const subject = section(page, "主体核验");
  await expect(subject).toContainText("乙方 · 恒昌建筑");
  await expect(subject).toContainText("多个候选");
  await expect(subject).toContainText("恒昌建筑（集团）有限公司");
  await expect(subject).toContainText("恒昌建筑有限公司");
  await expect(subject.getByRole("button", { name: "确认主体" })).toBeVisible();

  // No red-line dimension may be asserted for a party the provider could not
  // settle, and no external record may be attributed to it either.
  await expect(subject).not.toContainText("红线");
  await expect(page.getByText("qcc-fixture")).toHaveCount(0);
});
