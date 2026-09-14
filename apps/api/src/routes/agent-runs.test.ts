import { expect, test } from "bun:test";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

const snapshot = () =>
  createAuditSnapshot({
    sourceRecordId: "source-runs",
    document: normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。"),
    policyLimitRatio: 0.3,
  });

test("GET /api/agent-runs lists recent runs with step counts", async () => {
  const repository = new InMemoryAuditCaseRepository();
  const { caseId } = await repository.createPendingCase("source-runs", snapshot());
  const runId = await repository.beginAgentRun({
    auditCaseId: caseId,
    provider: "fake",
    model: "fake-agent",
    version: "0",
  });
  await repository.appendAgentTraceStep(caseId, {
    runId,
    sequence: 0,
    kind: "STAGE",
    at: new Date().toISOString(),
    label: "RUN_STARTED",
    ref: null,
    input: null,
    output: null,
    isError: false,
    durationMs: null,
    tokens: null,
  });
  await repository.finishAgentRun(runId, { usage: null, durationMs: 120, error: null });

  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });

  const response = await app.handle(new Request("http://localhost/api/agent-runs?limit=10"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({
    id: runId,
    auditCaseId: caseId,
    provider: "fake",
    stepCount: 1,
    caseStatus: "PENDING",
  });
});

test("GET /api/audit-cases/:id/trace returns 404 for an unknown case", async () => {
  const app = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });

  const response = await app.handle(new Request("http://localhost/api/audit-cases/missing/trace"));
  expect(response.status).toBe(404);
});
