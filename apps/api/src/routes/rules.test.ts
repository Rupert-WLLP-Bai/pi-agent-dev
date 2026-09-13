import { beforeEach, expect, test } from "bun:test";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

let rules: InMemoryRuleRepository;
let app: AuditApp;

beforeEach(() => {
  rules = new InMemoryRuleRepository();
  app = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: rules.asRepository(),
  });
});

const json = (method: string, path: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

const ruleBody = (overrides: Record<string, unknown> = {}) => ({
  code: "ADVANCE_PAYMENT_LIMIT",
  name: "预付款上限规则",
  contractType: "采购类",
  description: "预付款比例不得超过制度上限。",
  params: { limitRatio: 0.3 },
  stances: {
    preferred: "首选 ≤30%",
    acceptableRetreat: "可退让 ≤40% 需审批",
    unacceptable: "不可接受 >40%",
    exceptionApproval: "高级管理层书面审批",
  },
  ...overrides,
});

async function createRule(overrides: Record<string, unknown> = {}) {
  const response = await app.handle(json("POST", "/api/rules", ruleBody(overrides)));
  expect(response.status).toBe(201);
  return (await response.json()) as {
    rule: {
      id: string;
      enabled: boolean;
      disabledReason: string | null;
      disabledBy: string | null;
      disabledAt: string | null;
    };
    activeDraft: { id: string };
  };
}

test("creates a rule with an open v1 draft", async () => {
  const response = await app.handle(json("POST", "/api/rules", ruleBody()));

  expect(response.status).toBe(201);
  const detail = await response.json();
  expect(detail.rule).toMatchObject({ code: "ADVANCE_PAYMENT_LIMIT", contractType: "采购类" });
  expect(detail.versions).toHaveLength(1);
  expect(detail.activeDraft).toMatchObject({ version: 1, status: "draft" });
});

test("rejects a duplicate rule code with a readable reason", async () => {
  await createRule();
  const response = await app.handle(json("POST", "/api/rules", ruleBody()));

  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("规则代码已存在");
});

test("rejects a nested parameter value as malformed", async () => {
  const response = await app.handle(
    json("POST", "/api/rules", ruleBody({ params: { limitRatio: { nested: 1 } } })),
  );

  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("规则参数格式不正确");
});

test("lists rules with the latest version and its status", async () => {
  await createRule();

  const response = await app.handle(json("GET", "/api/rules"));

  expect(response.status).toBe(200);
  const list = (await response.json()) as Array<Record<string, unknown>>;
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    code: "ADVANCE_PAYMENT_LIMIT",
    currentVersion: 1,
    status: "draft",
    lastValidation: null,
  });
});

test("returns 404 for an unknown rule", async () => {
  expect((await app.handle(json("GET", "/api/rules/missing"))).status).toBe(404);
  expect(
    (await app.handle(json("POST", "/api/rules/missing/validate", { triggeredBy: "x" }))).status,
  ).toBe(404);
  expect(
    (await app.handle(json("POST", "/api/rules/missing/publish", { publishedBy: "x" }))).status,
  ).toBe(404);
});

test("updates basic rule info without touching versions", async () => {
  const { rule, activeDraft } = await createRule();

  const response = await app.handle(
    json("PUT", `/api/rules/${rule.id}`, { name: "预付款上限规则（修订）" }),
  );

  expect(response.status).toBe(200);
  expect((await response.json()).rule.name).toBe("预付款上限规则（修订）");
  expect((await rules.getRuleDetail(rule.id))?.rule.name).toBe("预付款上限规则（修订）");
  expect((await rules.getRuleDetail(rule.id))?.activeDraft?.id).toBe(activeDraft.id);
});

test("refuses a second open draft", async () => {
  const { rule } = await createRule();

  const response = await app.handle(
    json("POST", `/api/rules/${rule.id}/versions`, {
      params: { limitRatio: 0.2 },
      stances: ruleBody().stances,
    }),
  );

  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("已存在草稿版本");
});

test("revises the open draft in place", async () => {
  const { rule, activeDraft } = await createRule();

  const response = await app.handle(
    json("PUT", `/api/rules/${rule.id}/versions/${activeDraft.id}`, {
      params: { limitRatio: 0.4 },
      stances: ruleBody().stances,
    }),
  );

  expect(response.status).toBe(200);
  expect((await response.json()).version.params).toEqual({ limitRatio: 0.4 });
});

test("blocks publish until the draft has a green validation run", async () => {
  const { rule, activeDraft } = await createRule();

  const blocked = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" }),
  );
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).error).toBe("尚未运行验证");

  const validation = await app.handle(
    json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "规则管理员" }),
  );
  expect(validation.status).toBe(200);
  const validationBody = await validation.json();
  expect(validationBody.run).toMatchObject({ status: "passed", ruleCode: "ADVANCE_PAYMENT_LIMIT" });
  expect(validationBody.run.summary.failed).toBe(0);
  expect(validationBody.run.summary.total).toBeGreaterThan(0);

  const published = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" }),
  );
  expect(published.status).toBe(200);
  const publishedBody = await published.json();
  expect(publishedBody.version).toMatchObject({
    version: 1,
    status: "published",
    publishedBy: "规则管理员",
  });
  expect(publishedBody.version.id).toBe(activeDraft.id);
});

test("reports the failing case count when a red run gates publish", async () => {
  const { rule, activeDraft } = await createRule();

  // A 50% ceiling breaks the labelled 30% and 31% conflict cases.
  await app.handle(
    json("PUT", `/api/rules/${rule.id}/versions/${activeDraft.id}`, {
      params: { limitRatio: 0.5 },
      stances: ruleBody().stances,
    }),
  );

  const validation = await app.handle(
    json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "规则管理员" }),
  );
  const validationBody = await validation.json();
  expect(validationBody.run.status).toBe("failed");
  expect(validationBody.run.summary.failed).toBe(2);

  const blocked = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" }),
  );
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).error).toBe("验证未通过：2 例失败");
});

test("refuses to publish a rule whose golden set has no cases", async () => {
  // Every engine code is labelled by the golden set, so the empty golden set an
  // unlabelled rule would produce is seeded directly: a green run with total 0.
  const { rule, activeDraft } = await createRule();
  await rules.recordValidation({
    ruleVersionId: activeDraft.id,
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    triggeredBy: "test",
    startedAt: new Date(),
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      byCaseType: {
        POSITIVE: { total: 0, passed: 0, failed: 0 },
        NEGATIVE: { total: 0, passed: 0, failed: 0 },
        BOUNDARY: { total: 0, passed: 0, failed: 0 },
      },
    },
    details: [],
  });

  const res = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "test" }),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("没有可验证的案例，不能发布");
});

test("publishes the subject red-line rule despite an empty golden set", async () => {
  const { rule } = await createRule({ code: "SUBJECT_RED_LINE_RISK" });

  const validated = await app.handle(
    json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "test" }),
  );
  expect(validated.status).toBe(200);
  const { run } = (await validated.json()) as {
    run: { status: string; summary: { total: number } };
  };
  expect(run.status).toBe("passed");
  expect(run.summary.total).toBe(0);

  const res = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "test" }),
  );
  expect(res.status).toBe(200);
});

test("publishes a corrected draft after it turns green, retiring the previous version", async () => {
  const { rule } = await createRule();
  await app.handle(json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "规则管理员" }));
  await app.handle(json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" }));

  const created = await app.handle(
    json("POST", `/api/rules/${rule.id}/versions`, {
      params: { limitRatio: 0.5 },
      stances: ruleBody().stances,
    }),
  );
  expect(created.status).toBe(201);
  const v2 = (await created.json()).version as { id: string };

  const red = await app.handle(
    json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "规则管理员" }),
  );
  expect((await red.json()).run.status).toBe("failed");
  expect(
    (await app.handle(json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" })))
      .status,
  ).toBe(409);

  await app.handle(
    json("PUT", `/api/rules/${rule.id}/versions/${v2.id}`, {
      params: { limitRatio: 0.3 },
      stances: ruleBody().stances,
    }),
  );
  const green = await app.handle(
    json("POST", `/api/rules/${rule.id}/validate`, { triggeredBy: "规则管理员" }),
  );
  expect((await green.json()).run.status).toBe("passed");

  const published = await app.handle(
    json("POST", `/api/rules/${rule.id}/publish`, { publishedBy: "规则管理员" }),
  );
  expect(published.status).toBe(200);

  const detail = (await (await app.handle(json("GET", `/api/rules/${rule.id}`))).json()) as {
    versions: Array<{ version: number; status: string }>;
    rule: { id: string };
  };
  expect(detail.versions).toEqual([
    expect.objectContaining({ version: 2, status: "published" }),
    expect.objectContaining({ version: 1, status: "retired" }),
  ]);

  const list = (await (await app.handle(json("GET", "/api/rules"))).json()) as Array<
    Record<string, unknown>
  >;
  expect(list[0]).toMatchObject({
    currentVersion: 2,
    status: "published",
    publishedBy: "规则管理员",
  });
  expect(list[0].lastValidation).toMatchObject({ status: "passed" });
});

test("creates a rule enabled by default", async () => {
  const detail = await createRule();
  expect(detail.rule.enabled).toBe(true);
  expect(detail.rule.disabledReason).toBe(null);
});

test("rejects disable without a reason", async () => {
  const detail = await createRule();
  const res = await app.handle(
    json("POST", `/api/rules/${detail.rule.id}/disable`, { reason: "" }),
  );
  expect(res.status).toBe(400);
});

test("disables a rule and shows the overlay fields", async () => {
  const detail = await createRule();
  const res = await app.handle(
    json("POST", `/api/rules/${detail.rule.id}/disable`, { reason: "演示关闭" }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rule.enabled).toBe(false);
  expect(body.rule.disabledReason).toBe("演示关闭");
  expect(body.rule.disabledBy).toBe("规则管理员");
  expect(body.rule.disabledAt).not.toBe(null);

  const getRes = await app.handle(new Request(`http://localhost/api/rules/${detail.rule.id}`));
  const getBody = await getRes.json();
  expect(getBody.rule.enabled).toBe(false);
  expect(getBody.rule.disabledReason).toBe("演示关闭");
});

test("re-enables a disabled rule and clears the overlay", async () => {
  const detail = await createRule();
  await app.handle(json("POST", `/api/rules/${detail.rule.id}/disable`, { reason: "临时停用" }));
  const res = await app.handle(json("POST", `/api/rules/${detail.rule.id}/enable`, {}));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rule.enabled).toBe(true);
  expect(body.rule.disabledReason).toBe(null);
  expect(body.rule.disabledBy).toBe(null);
  expect(body.rule.disabledAt).toBe(null);
});

test("returns 404 when disabling or enabling an unknown rule", async () => {
  expect(
    (await app.handle(json("POST", "/api/rules/missing/disable", { reason: "x" }))).status,
  ).toBe(404);
  expect((await app.handle(json("POST", "/api/rules/missing/enable", {}))).status).toBe(404);
});

test("listEnabledCodes excludes disabled rules", async () => {
  const detail = await createRule();
  expect(await rules.listEnabledCodes()).toContain("ADVANCE_PAYMENT_LIMIT");
  await rules.disableRule(detail.rule.id, { reason: "test", actor: "test" });
  expect(await rules.listEnabledCodes()).not.toContain("ADVANCE_PAYMENT_LIMIT");
});

test("getPublishedVersions excludes disabled rules", async () => {
  const detail = await createRule();
  await app.handle(json("POST", `/api/rules/${detail.rule.id}/validate`, { triggeredBy: "x" }));
  await app.handle(
    json("POST", `/api/rules/${detail.rule.id}/publish`, { publishedBy: "规则管理员" }),
  );

  expect(
    (await rules.getPublishedVersions(["ADVANCE_PAYMENT_LIMIT"])).has("ADVANCE_PAYMENT_LIMIT"),
  ).toBe(true);

  await rules.disableRule(detail.rule.id, { reason: "test", actor: "test" });
  expect(
    (await rules.getPublishedVersions(["ADVANCE_PAYMENT_LIMIT"])).has("ADVANCE_PAYMENT_LIMIT"),
  ).toBe(false);
});

test("rejects a rule code outside the engine catalog", async () => {
  const res = await app.handle(json("POST", "/api/rules", ruleBody({ code: "GHOST_RULE" })));

  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("引擎目录");
});
