import { expect, test } from "@playwright/test";

/**
 * 案例验证 acceptance. The API is mocked at the network boundary so the spec
 * stays hermetic — the seeded golden cases, the run history and the regression
 * diff are all controllable. The one state change the flow performs (opening a
 * failing draft through the rules API) is driven from the page so it is
 * intercepted too, rather than reaching the shared dev database.
 */

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_1 = "22222222-2222-4222-8222-222222222222";
const RUN_2 = "33333333-3333-4333-8333-333333333333";
const FINISHED_1 = "2026-09-13T08:00:00.000Z";
const FINISHED_2 = "2026-09-13T08:30:00.000Z";

const rule = {
  id: RULE_ID,
  code: "ADVANCE_PAYMENT_LIMIT",
  name: "预付款上限规则",
  contractType: "采购类",
  description: "预付款比例不得超过制度上限。",
  createdAt: "2026-09-13T07:00:00.000Z",
  updatedAt: "2026-09-13T07:00:00.000Z",
  currentVersion: 1,
  status: "published",
  lastValidation: null,
  publishedBy: "系统初始化",
};

const caseAt = (
  id: string,
  caseType: string,
  name: string,
  outcome: "pass" | "fail" | "needs_review",
  actual = "COMPLIANT",
  expected = "COMPLIANT",
) => ({
  id,
  ruleCode: rule.code,
  caseType,
  name,
  input: "第二条 支付方式：甲方支付合同总价30%作为预付款。",
  expectedDisposition: expected,
  expectedNote: "",
  createdAt: "2026-09-13T07:10:00.000Z",
  latest: { runId: RUN_1, finishedAt: FINISHED_1, outcome, expected, actual },
});

const cases = (afterDraft: boolean) => [
  caseAt(
    "c1",
    "positive",
    "bench-01 · 预付款 70% 触发风险",
    afterDraft ? "fail" : "pass",
    afterDraft ? "COMPLIANT" : "POLICY_CONFLICT",
    "POLICY_CONFLICT",
  ),
  caseAt(
    "c2",
    "positive",
    "bench-03 · 预付款 50% 触发风险",
    "pass",
    "POLICY_CONFLICT",
    "POLICY_CONFLICT",
  ),
  caseAt("c3", "negative", "bench-02 · 预付款 30% 合规", "pass"),
  caseAt("c4", "boundary", "bench-08 · 预付款 30% 恰好上限", "pass"),
  caseAt(
    "c5",
    "missing_evidence",
    "bench-01 · 违约金条款缺失",
    "needs_review",
    "NEEDS_HUMAN_REVIEW",
    "NEEDS_HUMAN_REVIEW",
  ),
];

const detail = (caseType: string, name: string, expected: string, actual: string) => ({
  caseName: name,
  caseType,
  expected,
  actual,
  passed: expected === actual,
  note: expected === actual ? "" : `期望 ${expected}，实际 ${actual}`,
});

const details = (afterDraft: boolean) => [
  detail(
    "POSITIVE",
    "bench-01 · 预付款 70% 触发风险",
    "POLICY_CONFLICT",
    afterDraft ? "COMPLIANT" : "POLICY_CONFLICT",
  ),
  detail("POSITIVE", "bench-03 · 预付款 50% 触发风险", "POLICY_CONFLICT", "POLICY_CONFLICT"),
  detail("NEGATIVE", "bench-02 · 预付款 30% 合规", "COMPLIANT", "COMPLIANT"),
  detail("BOUNDARY", "bench-08 · 预付款 30% 恰好上限", "COMPLIANT", "COMPLIANT"),
  detail("BOUNDARY", "bench-01 · 违约金条款缺失", "NEEDS_HUMAN_REVIEW", "NEEDS_HUMAN_REVIEW"),
];

const summaryOf = (failed: number) => ({
  total: 5,
  passed: 5 - failed,
  failed,
  byCaseType: {
    POSITIVE: { total: 2, passed: 2 - failed, failed },
    NEGATIVE: { total: 1, passed: 1, failed: 0 },
    BOUNDARY: { total: 2, passed: 2, failed: 0 },
  },
});

const run = (id: string, afterDraft: boolean) => ({
  id,
  ruleId: RULE_ID,
  ruleCode: rule.code,
  ruleName: rule.name,
  ruleVersion: afterDraft ? 2 : 1,
  versionStatus: afterDraft ? "draft" : "published",
  status: afterDraft ? "failed" : "passed",
  summary: summaryOf(afterDraft ? 1 : 0),
  triggeredBy: "规则管理员",
  startedAt: afterDraft ? FINISHED_2 : FINISHED_1,
  finishedAt: afterDraft ? FINISHED_2 : FINISHED_1,
});

const diffFor = (afterDraft: boolean) =>
  details(afterDraft).map((entry) => {
    const current =
      entry.actual === "NEEDS_HUMAN_REVIEW" ? "needs_review" : entry.passed ? "pass" : "fail";
    // On the first run there is no baseline; on the second, the case a harsher
    // draft broke flips from pass to fail and the rest stay put.
    if (!afterDraft) {
      return { ...entry, previous: null, previousActual: null, current, change: "new" };
    }
    const regressed = entry.caseName.startsWith("bench-01 · 预付款");
    return {
      ...entry,
      previous: regressed ? "pass" : current,
      previousActual: null,
      current,
      change: regressed ? "regression" : "unchanged",
    };
  });

test("shows seeded case counts and the latest run's results, without a baseline", async ({
  page,
}) => {
  let draftCreated = false;

  await page.route("**/api/rules", (route) => route.fulfill({ json: [rule] }));
  await page.route("**/api/rules/*/versions", async (route) => {
    draftCreated = true;
    await route.fulfill({
      status: 201,
      json: { version: { id: "v2", version: 2, status: "draft" } },
    });
  });
  await page.route("**/api/validation/cases*", (route) =>
    route.fulfill({ json: cases(draftCreated) }),
  );
  await page.route("**/api/validation/runs*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { runs: [run(RUN_2, true)], skipped: [] } });
      return;
    }
    if (url.pathname.endsWith("/runs")) {
      await route.fulfill({
        json: draftCreated ? [run(RUN_2, true), run(RUN_1, false)] : [run(RUN_1, false)],
      });
      return;
    }
    const afterDraft = url.pathname.endsWith(RUN_2);
    await route.fulfill({
      json: {
        run: run(afterDraft ? RUN_2 : RUN_1, afterDraft),
        summary: summaryOf(afterDraft ? 1 : 0),
        details: details(afterDraft),
        previous: afterDraft ? { id: RUN_1, ruleVersion: 1, finishedAt: FINISHED_1 } : null,
        diff: diffFor(afterDraft),
      },
    });
  });

  await page.goto("/cases");

  // The nav entry is live, not a disabled placeholder.
  await expect(page.getByRole("link", { name: "案例验证" })).toBeVisible();

  // The five case shapes are counted from the materialised golden set.
  const card = (label: string) => page.locator(".queue-summary-card").filter({ hasText: label });
  await expect(card("正例").locator("b")).toHaveText("2");
  await expect(card("反例").locator("b")).toHaveText("1");
  await expect(card("边界例").locator("b")).toHaveText("1");
  await expect(card("历史误报 / 证据缺失").locator("b")).toHaveText("1");
  await expect(card("正例").getByText("2 / 2 通过")).toBeVisible();
  await expect(card("历史误报 / 证据缺失").getByText("复现 1")).toBeVisible();

  // Selecting the rule is what scopes the run.
  await page.getByLabel("选择规则").click();
  await page.getByText("预付款上限规则（ADVANCE_PAYMENT_LIMIT）").last().click();

  // The first run's results render with outcome chips, and there is no baseline.
  await expect(
    page.getByRole("row").filter({ hasText: "bench-01 · 预付款 70% 触发风险" }).getByText("通过"),
  ).toBeVisible();
  await expect(page.getByText("首次运行，无可比对的基线。")).toBeVisible();
  await expect(page.getByText("新增回归")).toHaveCount(0);
  await expect(page.getByText("已修复")).toHaveCount(0);

  // Open a failing draft through the rules API, then run again: the second run
  // is measured against the first and names the regression.
  const draftStatus = await page.evaluate(async (ruleId) => {
    const response = await fetch(`/api/rules/${ruleId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { limitRatio: 0.1 }, stances: {} }),
    });
    return response.status;
  }, RULE_ID);
  expect(draftStatus).toBe(201);

  await page.getByRole("button", { name: "按规则版本运行验证" }).click();

  await expect(page.getByText("新增回归")).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "bench-01 · 预付款 70% 触发风险" }).getByText("失败"),
  ).toBeVisible();
  await expect(page.getByText("预付款上限规则 · v2")).toBeVisible();
});
