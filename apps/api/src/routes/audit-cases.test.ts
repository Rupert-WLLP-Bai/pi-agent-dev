import { expect, test } from "bun:test";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { type AuditApp, createApp } from "../app";
import { ensureRunSnapshot } from "../audit/assemble-run-snapshot";
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
async function ruleCodesForNewCase(
  app: AuditApp,
  repository: InMemoryAuditCaseRepository,
  rules: InMemoryRuleRepository,
  contractText: string,
): Promise<string[]> {
  const created = await app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText }),
    }),
  );
  expect(created.status).toBe(202);
  const { id } = (await created.json()) as { id: string };
  await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());
  const detail = await app.handle(new Request(`http://localhost/api/audit-cases/${id}`));
  const { ruleAssessments } = (await detail.json()) as {
    ruleAssessments: Array<{ ruleCode: string }>;
  };
  return ruleAssessments.map((assessment) => assessment.ruleCode);
}

test("omits a disabled rule's assessment from the created snapshot", async () => {
  const rules = new InMemoryRuleRepository();
  const repository = new InMemoryAuditCaseRepository();
  const { rule } = await rules.createRule(advancePaymentRule);
  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: rules.asRepository(),
  });

  // Control: while the rule is enabled its assessment is present, so the
  // absence below is the overlay taking effect rather than an empty snapshot.
  expect(await ruleCodesForNewCase(app, repository, rules, ADVANCE_CONTRACT)).toContain(
    "ADVANCE_PAYMENT_LIMIT",
  );

  await rules.disableRule(rule.id, { reason: "演示关闭", actor: "规则管理员" });

  expect(await ruleCodesForNewCase(app, repository, rules, ADVANCE_CONTRACT)).not.toContain(
    "ADVANCE_PAYMENT_LIMIT",
  );
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
  const rules = new InMemoryRuleRepository();
  const dispatcher = new FakeDispatcher();
  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: rules.asRepository(),
  });
  return { repository, rules, dispatcher, app };
};

test("reassessing a failed case appends a snapshot and requeues it", async () => {
  const { repository, rules, dispatcher, app } = setup();
  const id = await createCase(app);
  await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());
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

  await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());

  const latest = await repository.getSnapshotByCase(id);
  expect(repository.cases.get(id)?.snapshots.length).toBe(2);
  expect(latest).not.toEqual(original);
  const stored = repository.cases.get(id)?.snapshots.at(-1) ?? null;
  expect(latest).toEqual(stored);
});

for (const status of ["COMPLETED", "RUNNING", "PENDING"] as const) {
  test(`reassessing a ${status} case is refused with 409`, async () => {
    const { repository, rules, dispatcher, app } = setup();
    const id = await createCase(app);
    await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());
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

/**
 * A rerun is a new audit of the same contract, not a re-run of the old one.
 * Retry and reassess both act on the case they are called on, so their new
 * findings land in the case a human already reviewed — which is the loophole
 * the rerun closes by opening a fresh case instead.
 */

const rerun = (app: AuditApp, id: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api/audit-cases/${encodeURIComponent(id)}/rerun`, {
      method: "POST",
    }),
  );

const retry = (app: AuditApp, id: string): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/api/audit-cases/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    }),
  );

/** A stopped case that has been audited, so a rerun is allowed. */
const auditedCase = async (
  app: AuditApp,
  repository: InMemoryAuditCaseRepository,
  rules: InMemoryRuleRepository,
  status: "AWAITING_REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED",
): Promise<string> => {
  const id = await createCase(app);
  await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());
  await repository.updateCaseStatus(id, status, status);
  return id;
};

test("re-running an awaiting-review case opens a new case over the same revision", async () => {
  const { repository, rules, dispatcher, app } = setup();
  const id = await auditedCase(app, repository, rules, "AWAITING_REVIEW");
  const originalRevisionId = repository.contractRevisionByCase.get(id);
  const originalSnapshots = repository.cases.get(id)?.snapshots.length;
  const enqueuedBefore = dispatcher.enqueued.length;

  const response = await rerun(app, id);

  expect(response.status).toBe(202);
  const body: { id: string; status: string; sourceCaseId: string } = await response.json();
  expect(body.status).toBe("PENDING");
  // The new case is a different case id, so the old one keeps its own state.
  expect(body.id).not.toBe(id);
  expect(body.sourceCaseId).toBe(id);
  // Same Contract Revision: re-reading identical bytes is not a new version.
  expect(repository.contractRevisionByCase.get(body.id)).toBe(originalRevisionId);
  expect(repository.contractRevisions.size).toBe(1);
  // Same Source Record, so the original bytes are re-parsed.
  expect(repository.sourceRecordIdsByCase.get(body.id)).toBe(
    repository.sourceRecordIdsByCase.get(id),
  );
  // The old case is untouched: same snapshots, same status, no new findings.
  expect(repository.cases.get(id)?.snapshots.length).toBe(originalSnapshots);
  expect(await repository.getCase(id)).toMatchObject({ status: "AWAITING_REVIEW" });
  // The new case starts with no snapshot of its own.
  expect(repository.cases.get(body.id)?.snapshots.length).toBe(0);
  expect(dispatcher.enqueued.at(-1)).toBe(body.id);
  expect(dispatcher.enqueued).toHaveLength(enqueuedBefore + 1);
});

test("the new case runs against the rules in force now, not the old snapshot", async () => {
  const { repository, rules, app } = setup();
  const id = await auditedCase(app, repository, rules, "COMPLETED");
  const originalFindings = repository.cases.get(id)?.findings.length ?? 0;
  await repository.appendFindingRevision(
    id,
    {
      assessmentId: "assessment-payment",
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
      severity: "HIGH",
      rationale: "Advance payment exceeds the policy limit",
      evidenceIds: ["contract-payment"],
      remediation: "Reduce the advance payment ratio",
    },
    null,
  );
  await repository.appendReviewRevision(repository.cases.get(id)?.findings[0]?.id ?? "", {
    decision: "ACCEPTED",
    reviewerId: "reviewer-1",
    reviewedAt: new Date().toISOString(),
  });

  const response = await rerun(app, id);
  const body: { id: string } = await response.json();

  // The new case carries no findings and no reviews of its own: the audit it is
  // about to run is the only source of its output.
  expect(repository.cases.get(body.id)?.findings.length).toBe(0);
  // The old case keeps the finding and the human decision recorded on it: a
  // review is itself a revision, so the count grows by two.
  const oldFindings = repository.cases.get(id)?.findings ?? [];
  expect(oldFindings.length).toBe(originalFindings + 2);
  expect(oldFindings.some((finding) => finding.review !== null)).toBe(true);
});

test("re-running a case that is still queued or running is refused", async () => {
  for (const status of ["PENDING", "RUNNING"] as const) {
    const { repository, rules, dispatcher, app } = setup();
    const id = await createCase(app);
    await ensureRunSnapshot(repository.asRepository(), id, rules.asRepository());
    await repository.updateCaseStatus(id, status, status);
    const casesBefore = repository.cases.size;

    const response = await rerun(app, id);

    expect(response.status).toBe(409);
    const body: { error: string } = await response.json();
    expect(body).toEqual({ error: "case_active" });
    // No new case was opened and no rerun was enqueued: the create call already
    // enqueues the paste's own case once, which is the baseline.
    expect(repository.cases.size).toBe(casesBefore);
    expect(dispatcher.enqueued).toHaveLength(1);
  }
});

test("a second rerun is refused while the first is still queued or running", async () => {
  const { repository, rules, dispatcher, app } = setup();
  const id = await auditedCase(app, repository, rules, "COMPLETED");

  const first = await rerun(app, id);
  expect(first.status).toBe(202);
  const { id: firstCaseId } = (await first.json()) as { id: string };
  const enqueuedBefore = dispatcher.enqueued.length;

  const second = await rerun(app, id);

  expect(second.status).toBe(409);
  const body: { error: string } = await second.json();
  expect(body).toEqual({ error: "rerun_already_active" });
  // The first rerun is untouched, and no duplicate work was scheduled.
  expect(await repository.getCase(firstCaseId)).toMatchObject({ status: "PENDING" });
  expect(dispatcher.enqueued).toHaveLength(enqueuedBefore);
  expect(repository.cases.size).toBe(2);
});

test("re-running a case that does not exist is a 404", async () => {
  const { app } = setup();

  const response = await rerun(app, "no-such-case");

  expect(response.status).toBe(404);
  const body: { error: string } = await response.json();
  expect(body).toEqual({ error: "audit_case_not_found" });
});

/**
 * An id that is not a UUID can never address a row. The case columns are typed
 * `uuid`, so passing such a value straight to SQL makes the driver abort the
 * transaction — which the global handler would report as a 500, blaming the
 * server for the caller's malformed id. The repository answers it as not-found
 * before any statement is sent, so the route reports an honest 404.
 */
test("re-running a case with a malformed id is a 404, not a 500", async () => {
  const { app, dispatcher } = setup();

  for (const malformed of ["no-such-case", "not-a-uuid", "!!!not-a-uuid!!!"]) {
    const response = await rerun(app, malformed);

    expect(response.status).toBe(404);
    const body: { error: string } = await response.json();
    expect(body).toEqual({ error: "audit_case_not_found" });
  }
  // Nothing was created and nothing was enqueued.
  expect(dispatcher.enqueued).toHaveLength(0);
});

test("retrying an audited case is refused instead of appending into reviewed work", async () => {
  const { repository, rules, dispatcher, app } = setup();
  const id = await auditedCase(app, repository, rules, "AWAITING_REVIEW");
  const enqueuedBefore = dispatcher.enqueued.length;

  const response = await retry(app, id);

  expect(response.status).toBe(409);
  const body: { error: string } = await response.json();
  expect(body).toEqual({ error: "case_not_retryable" });
  expect(dispatcher.enqueued).toHaveLength(enqueuedBefore);
});

test("retrying a failed case is still accepted", async () => {
  const { repository, rules, dispatcher, app } = setup();
  const id = await auditedCase(app, repository, rules, "FAILED");

  const response = await retry(app, id);

  expect(response.status).toBe(202);
  const body: { id: string; status: string } = await response.json();
  expect(body).toEqual({ id, status: "PENDING" });
  expect(dispatcher.retried.at(-1)).toBe(id);
});
