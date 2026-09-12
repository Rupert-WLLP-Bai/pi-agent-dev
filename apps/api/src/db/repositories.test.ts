import { beforeAll, expect, test } from "bun:test";
import type { FindingProposal, HumanReview } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuditCaseRepository, contractTitleFromFirstBlock } from "./repositories";
import { auditCases, schema } from "./schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit";

const canConnect = await postgres(databaseUrl, { connect_timeout: 3 })`SELECT 1`
  .then(() => true)
  .catch(() => false);

const maybeTest = canConnect ? test : test.skip;

let repository: AuditCaseRepository;

const uniqueSourceRecordId = (): string => crypto.randomUUID();

const seedSnapshot = (sourceRecordId: string) =>
  createAuditSnapshot({
    sourceRecordId,
    document: normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。"),
    policyLimitRatio: 0.3,
  });

const seedProposal: FindingProposal = {
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  severity: "HIGH",
  rationale: "Advance payment exceeds the policy limit",
  evidenceIds: ["contract-payment"],
  remediation: "Reduce the advance payment ratio",
};

const seedReview: HumanReview = {
  decision: "ACCEPTED",
  reviewerId: "anonymous",
  reviewedAt: new Date().toISOString(),
};

beforeAll(async () => {
  if (!canConnect) return;
  const client = postgres(databaseUrl);
  const db = drizzle({ client, schema });
  // Keep claim ordering deterministic: neutralize leftover PENDING cases.
  await db
    .update(auditCases)
    .set({ status: "INTERRUPTED" })
    .where(eq(auditCases.status, "PENDING"));
  repository = new AuditCaseRepository(db);
});

maybeTest("claims only one pending audit case", async () => {
  const { caseId } = await repository.createPendingCase(
    uniqueSourceRecordId(),
    seedSnapshot(uniqueSourceRecordId()),
  );

  const claimed = await repository.claimNextPendingCase();
  expect(claimed?.caseId).toBe(caseId);
  expect(await repository.getCase(caseId)).toMatchObject({ status: "RUNNING" });

  // The only pending case was claimed; nothing else is claimable.
  expect(await repository.claimNextPendingCase()).toBeNull();
});

maybeTest("claims the requested case only while it is pending", async () => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));

  const claimed = await repository.claimCase(caseId);
  expect(claimed).toMatchObject({ caseId });

  const reclaimed = await repository.claimCase(caseId);
  expect(reclaimed).toBeNull();
});

maybeTest("lists pending case ids", async () => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));

  const pending = await repository.getPendingCaseIds();
  expect(pending).toContain(caseId);
});

maybeTest(
  "appends a human review as a superseding revision without overwriting the proposal",
  async () => {
    const id = uniqueSourceRecordId();
    const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
    const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);

    const reviewId = await repository.appendReviewRevision(proposalId, seedReview);

    const original = await repository.getFinding(proposalId);
    const reviewRevision = await repository.getFinding(reviewId);
    expect(original?.review).toBeNull();
    expect(reviewRevision?.supersedesId).toBe(proposalId);
    expect(reviewRevision?.review).toMatchObject({ decision: "ACCEPTED" });
    expect(reviewRevision?.proposal).toEqual(seedProposal);

    // Only the chain head is exposed per case.
    const findings = await repository.getFindingsByCase(caseId);
    expect(findings.map((finding) => finding.id)).toEqual([reviewId]);
  },
);

maybeTest("rejects a second review of the same finding", async () => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);
  await repository.appendReviewRevision(proposalId, seedReview);

  await expect(
    repository.appendReviewRevision(proposalId, { ...seedReview, decision: "REJECTED" }),
  ).rejects.toThrow(/FINDING_ALREADY_REVIEWED/);
});

maybeTest("marks stale running cases interrupted", async () => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  await repository.claimCase(caseId);

  const count = await repository.markStaleRunsInterrupted();

  expect(count).toBeGreaterThanOrEqual(1);
  expect(await repository.getCase(caseId)).toMatchObject({
    status: "INTERRUPTED",
    stage: "INTERRUPTED",
  });
});

maybeTest("pings the database", async () => {
  expect(await repository.ping()).toBe(true);
});

// ── Source provenance ─────────────────────────────────────────────

maybeTest("records the provenance it was given and reports it back", async () => {
  const id = uniqueSourceRecordId();
  await repository.createPendingCase(id, seedSnapshot(id), {
    type: "FILE_UPLOAD",
    displayName: "设备采购合同.docx",
  });

  const [row] = (await repository.getCasesWithContractTitle()).filter(
    (summary) => summary.sourceRecordId === id,
  );

  expect(row.sourceProvenance).toEqual({
    type: "FILE_UPLOAD",
    displayName: "设备采购合同.docx",
  });
});

maybeTest("reports unknown provenance as null instead of inventing a paste", async () => {
  // Records written before provenance was tracked carry no source type. The
  // queue must show that gap as unknown: claiming "文本粘贴" would mislabel
  // every file uploaded before provenance existed.
  const id = uniqueSourceRecordId();
  await repository.createPendingCase(id, seedSnapshot(id));

  const [row] = (await repository.getCasesWithContractTitle()).filter(
    (summary) => summary.sourceRecordId === id,
  );

  expect(row.sourceProvenance).toBeNull();
});

// ── Contract title heuristic ──────────────────────────────────────

test("accepts a short heading as the contract title", () => {
  expect(contractTitleFromFirstBlock("设备采购合同")).toBe("设备采购合同");
});

test("rejects a clause that reads as a finished sentence", () => {
  // Fixtures often start with a clause; presenting it as the contract name
  // would mislabel every row in the queue.
  expect(contractTitleFromFirstBlock("乙方签订后支付合同金额的70%作为预付款。")).toBeNull();
  expect(contractTitleFromFirstBlock("甲方应在验收合格后10日内付款；")).toBeNull();
});

test("rejects an over-long block and absent input", () => {
  expect(contractTitleFromFirstBlock("甲".repeat(41))).toBeNull();
  expect(contractTitleFromFirstBlock(null)).toBeNull();
  expect(contractTitleFromFirstBlock("   ")).toBeNull();
});

// ── Agent trace persistence ──────────────────────────────────────

maybeTest("round-trips a trace run with ordered steps", async () => {
  const sourceId = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(sourceId, seedSnapshot(sourceId));

  const runId = await repository.beginAgentRun({
    auditCaseId: caseId,
    provider: "fake",
    model: "fake-agent",
    version: "0",
  });

  const steps: import("@contract-audit/audit/model").AgentTraceStep[] = [
    {
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
    },
    {
      runId,
      sequence: 1,
      kind: "TOOL_CALL",
      at: new Date().toISOString(),
      label: "get_rule_assessments",
      ref: "call-1",
      input: { evidenceIds: ["a"] },
      output: null,
      isError: false,
      durationMs: null,
      tokens: null,
    },
    {
      runId,
      sequence: 2,
      kind: "TOOL_RESULT",
      at: new Date().toISOString(),
      label: "get_rule_assessments",
      ref: "call-1",
      input: null,
      output: { assessments: [] },
      isError: false,
      durationMs: 25,
      tokens: null,
    },
    {
      runId,
      sequence: 3,
      kind: "MESSAGE",
      at: new Date().toISOString(),
      label: "assistant",
      ref: null,
      input: null,
      output: "分析完毕",
      isError: false,
      durationMs: null,
      tokens: { input: 100, output: 20 },
    },
  ];

  for (const step of steps) {
    await repository.appendAgentTraceStep(caseId, step);
  }

  await repository.finishAgentRun(runId, {
    usage: { input: 100, output: 20 },
    durationMs: 500,
    error: null,
  });

  const traces = await repository.getTracesByCase(caseId);
  expect(traces).toHaveLength(1);
  expect(traces[0].run.id).toBe(runId);
  expect(traces[0].run.usage).toEqual({ input: 100, output: 20 });
  expect(traces[0].run.durationMs).toBe(500);
  expect(traces[0].run.error).toBeNull();

  const traceSteps = traces[0].steps;
  expect(traceSteps).toHaveLength(4);
  expect(traceSteps.map((s) => s.sequence)).toEqual([0, 1, 2, 3]);
  expect(traceSteps.map((s) => s.label)).toEqual([
    "RUN_STARTED",
    "get_rule_assessments",
    "get_rule_assessments",
    "assistant",
  ]);
  expect(traceSteps[1]?.input).toEqual({ evidenceIds: ["a"] });
  expect(traceSteps[2]?.output).toEqual({ assessments: [] });
  expect(traceSteps[2]?.durationMs).toBe(25);
  expect(traceSteps[3]?.tokens).toEqual({ input: 100, output: 20 });
});

maybeTest("getRecentRuns lists runs with step counts and contract titles", async () => {
  const sourceId = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(sourceId, seedSnapshot(sourceId));

  const runId = await repository.beginAgentRun({
    auditCaseId: caseId,
    provider: "pi",
    model: "deepseek-v4-flash",
    version: "0.85.1",
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
  await repository.finishAgentRun(runId, {
    usage: null,
    durationMs: 300,
    error: null,
  });

  const recent = await repository.getRecentRuns(50);
  const found = recent.find((r) => r.id === runId);
  expect(found).toBeDefined();
  expect(found?.stepCount).toBe(1);
  expect(found?.provider).toBe("pi");
  expect(found?.caseStatus).toBe("PENDING");
});
