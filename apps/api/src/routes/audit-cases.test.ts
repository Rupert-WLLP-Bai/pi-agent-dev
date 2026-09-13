import { expect, test } from "bun:test";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";
import { resolvePasteProvenance } from "./audit-cases";

/**
 * Provenance is a recorded fact, so the route resolves it from its own catalog
 * rather than from whatever the client claims. Only an unedited built-in
 * sample earns the DEMO label; everything else is an ordinary paste.
 */

const sample = demoContracts[0];

test("an unedited built-in sample is recorded as a demo", () => {
  expect(resolvePasteProvenance({ contractText: sample.text, demoId: sample.id })).toEqual({
    type: "DEMO",
    displayName: sample.title,
  });
});

test("a pasted submission without a sample id is a plain paste", () => {
  expect(resolvePasteProvenance({ contractText: "第一条 合同标的" })).toEqual({
    type: "TEXT_PASTE",
    displayName: null,
  });
});

test("an edited sample stops being a demo", () => {
  // The operator changed the text, so it no longer reproduces the catalog
  // entry: recording DEMO would misstate where the contract came from.
  expect(
    resolvePasteProvenance({
      contractText: `${sample.text}\n补充条款：质保期为二十四个月。`,
      demoId: sample.id,
    }),
  ).toEqual({ type: "TEXT_PASTE", displayName: null });
});

test("an unknown sample id is not trusted", () => {
  expect(resolvePasteProvenance({ contractText: sample.text, demoId: "not-a-sample" })).toEqual({
    type: "TEXT_PASTE",
    displayName: null,
  });
});

test("surrounding whitespace does not defeat the match", () => {
  // The drawer trims before submitting, so a trailing newline from a paste
  // must not silently downgrade a genuine sample load.
  expect(
    resolvePasteProvenance({ contractText: `  ${sample.text}  \n`, demoId: sample.id }),
  ).toEqual({ type: "DEMO", displayName: sample.title });
});

/**
 * The enabled/disabled overlay is applied when a snapshot is assembled, not
 * when it is read: a rule disabled by an operator must not appear in a new
 * submission's assessments, while an enabled one still does.
 */

const advancePaymentRule = {
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
};

/** A contract with an advance-payment term, so the rule's assessment is armed. */
const ADVANCE_CONTRACT = "第一条 甲方于合同签订后七日内支付合同总价70%的预付款。";

/** Submits a paste and returns the rule codes the created snapshot assessed. */
async function ruleCodesForNewCase(app: AuditApp, contractText: string): Promise<string[]> {
  const created = await app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText }),
    }),
  );
  expect(created.status).toBe(202);
  const { id } = (await created.json()) as { id: string };
  const detail = await app.handle(new Request(`http://localhost/api/audit-cases/${id}`));
  const { ruleAssessments } = (await detail.json()) as {
    ruleAssessments: Array<{ ruleCode: string }>;
  };
  return ruleAssessments.map((assessment) => assessment.ruleCode);
}

test("omits a disabled rule's assessment from the created snapshot", async () => {
  const rules = new InMemoryRuleRepository();
  const { rule } = await rules.createRule(advancePaymentRule);
  const app = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: rules.asRepository(),
  });

  // Control: while the rule is enabled its assessment is present, so the
  // absence below is the overlay taking effect rather than an empty snapshot.
  expect(await ruleCodesForNewCase(app, ADVANCE_CONTRACT)).toContain("ADVANCE_PAYMENT_LIMIT");

  await rules.disableRule(rule.id, { reason: "演示关闭", actor: "规则管理员" });

  expect(await ruleCodesForNewCase(app, ADVANCE_CONTRACT)).not.toContain("ADVANCE_PAYMENT_LIMIT");
});

/**
 * Reassessment and retry are different actions. A retry reruns the agent
 * against the snapshot the case already holds; a reassessment first rebuilds
 * that snapshot from the rules in force now, then requeues the case.
 */

interface CreatedCase {
  id: string;
}

const createCase = async (app: AuditApp, contractText = ADVANCE_CONTRACT): Promise<string> => {
  const created = await app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText }),
    }),
  );
  expect(created.status).toBe(202);
  const body: CreatedCase = await created.json();
  return body.id;
};

const reassess = (app: AuditApp, id: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api/audit-cases/${encodeURIComponent(id)}/reassess`, {
      method: "POST",
    }),
  );

const setup = () => {
  const repository = new InMemoryAuditCaseRepository();
  const dispatcher = new FakeDispatcher();
  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });
  return { repository, dispatcher, app };
};

test("reassessing a failed case appends a snapshot and requeues it", async () => {
  const { repository, dispatcher, app } = setup();
  const id = await createCase(app);
  await repository.updateCaseStatus(id, "FAILED", "FAILED");
  const original = await repository.getSnapshotByCase(id);
  const enqueuedBefore = dispatcher.enqueued.length;

  const response = await reassess(app, id);

  expect(response.status).toBe(202);
  const body: { case: { id: string; status: string; stage: string } } = await response.json();
  expect(body.case).toMatchObject({ id, status: "PENDING", stage: "QUEUED" });
  expect(await repository.getCase(id)).toMatchObject({ status: "PENDING", stage: "QUEUED" });
  expect(dispatcher.enqueued).toHaveLength(enqueuedBefore + 1);
  expect(dispatcher.enqueued.at(-1)).toBe(id);

  // A new generation was appended rather than overwriting the original, and
  // the read now resolves to that newest one.
  const latest = await repository.getSnapshotByCase(id);
  expect(repository.cases.get(id)?.snapshots.length).toBe(2);
  expect(latest).not.toBe(original);
  const stored = repository.cases.get(id)?.snapshots.at(-1) ?? null;
  expect(latest).toEqual(stored);
});

for (const status of ["COMPLETED", "RUNNING", "PENDING"] as const) {
  test(`reassessing a ${status} case is refused with 409`, async () => {
    const { repository, dispatcher, app } = setup();
    const id = await createCase(app);
    await repository.updateCaseStatus(id, status, status);
    const enqueuedBefore = dispatcher.enqueued.length;

    const response = await reassess(app, id);

    expect(response.status).toBe(409);
    const body: { error: string } = await response.json();
    expect(body).toEqual({ error: "case_not_reassessable" });
    expect(dispatcher.enqueued).toHaveLength(enqueuedBefore);
    // The refused reassessment left no second snapshot behind.
    expect(repository.cases.get(id)?.snapshots.length).toBe(1);
  });
}

test("reassessing a case that does not exist is a 404", async () => {
  const { app } = setup();

  const response = await reassess(app, "no-such-case");

  expect(response.status).toBe(404);
  const body: { error: string } = await response.json();
  expect(body).toEqual({ error: "audit_case_not_found" });
});
