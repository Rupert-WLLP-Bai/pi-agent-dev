import { expect, test } from "bun:test";
import { type ContractDetailView, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

/**
 * The contract detail wire shape carries both a case's machine status and its
 * finer-grained stage: the UI resolves an "awaiting review" display from the
 * stage while the status still reads COMPLETED, so losing either value would
 * mislabel a case that is finished but not yet signed off.
 */

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
  return { repository, app };
};

test("detail reports both the case status and its stage", async () => {
  const { repository, app } = setup();
  const { caseId } = await repository.createQueuedCase("source-1", "第一条 合同标的");
  // A case that has finished its machine lifecycle but still awaits human review:
  // status COMPLETED, stage AWAITING_REVIEW — the pairing the UI renders as 待复核.
  await repository.updateCaseStatus(caseId, "COMPLETED", "AWAITING_REVIEW");
  const contractId = await repository.contractIdForCase(caseId);
  expect(contractId).not.toBeNull();

  const response = await app.handle(new Request(`http://localhost/api/contracts/${contractId}`));

  expect(response.status).toBe(200);
  const body = (await response.json()) as ContractDetailView;
  expect(body.revisions).toHaveLength(1);
  expect(body.revisions[0]).toMatchObject({
    auditCaseId: caseId,
    caseStatus: "COMPLETED",
    caseStage: "AWAITING_REVIEW",
  });
});

test("an unknown contract id is a 404", async () => {
  const { app } = setup();

  const response = await app.handle(new Request("http://localhost/api/contracts/no-such-contract"));

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "contract_not_found" });
});
