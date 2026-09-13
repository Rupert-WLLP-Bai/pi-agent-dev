import { beforeAll, expect, test } from "bun:test";
import type { FindingProposal, HumanReview } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuditCaseRepository, contractTitleFromFirstBlock, type DrizzleDB } from "./repositories";
import { auditCases, schema } from "./schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit";

const canConnect = await postgres(databaseUrl, { connect_timeout: 3 })`SELECT 1`
  .then(() => true)
  .catch(() => false);

const maybeTest = canConnect ? test : test.skip;

/** Thrown to force the transaction to roll back a body that succeeded. */
class Rollback extends Error {}

/**
 * Runs one case in a transaction that always rolls back.
 *
 * These cases exercise a repository against whatever `DATABASE_URL` points at —
 * locally, the same database the app is serving from. Handing it a real
 * connection would leave seeded cases, runs and findings behind on every run;
 * confining the work to a transaction that never commits keeps the suite
 * hermetic. `tx` implements the same surface as the pooled database, including
 * nested transactions (as savepoints), so the repository is unaware.
 */
const withRollback = async (
  body: (repository: AuditCaseRepository) => Promise<void>,
): Promise<void> => {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await drizzle({ client, schema }).transaction(async (tx) => {
      // Claiming picks the oldest PENDING case, so a case left pending by the
      // running app would decide what this case under test claims. Neutralize
      // them here: the update rolls back with everything else.
      await tx
        .update(auditCases)
        .set({ status: "INTERRUPTED" })
        .where(eq(auditCases.status, "PENDING"));

      await body(new AuditCaseRepository(tx as unknown as DrizzleDB));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await client.end();
  }
};

const dbTest = (name: string, body: (repository: AuditCaseRepository) => Promise<void>) =>
  maybeTest(name, () => withRollback(body));

const uniqueSourceRecordId = (): string => crypto.randomUUID();

const seedSnapshot = (sourceRecordId: string) =>
  createAuditSnapshot({
    sourceRecordId,
    document: normalizeContractDocument("乙方签订后支付合同金额的70%作为预付款。"),
    policyLimitRatio: 0.3,
  });

/** A contract that names its parties, which the clause-only seed does not. */
const PARTY_CONTRACT = [
  "甲方：重庆华盛贸易有限公司",
  "乙方：成都建工集团有限公司",
  "乙方签订后支付合同金额的70%作为预付款。",
].join("\n");

const seedPartySnapshot = (sourceRecordId: string) =>
  createAuditSnapshot({
    sourceRecordId,
    document: normalizeContractDocument(PARTY_CONTRACT),
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

beforeAll(() => {
  if (!canConnect) {
    console.warn("repositories.test: DATABASE_URL unreachable, database cases skipped");
  }
});

dbTest("claims only one pending audit case", async (repository) => {
  const sourceId = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(sourceId, seedSnapshot(sourceId));

  const claimed = await repository.claimNextPendingCase();
  expect(claimed?.caseId).toBe(caseId);
  expect(await repository.getCase(caseId)).toMatchObject({ status: "RUNNING" });

  // The only pending case was claimed; nothing else is claimable.
  expect(await repository.claimNextPendingCase()).toBeNull();
});

dbTest("claims the requested case only while it is pending", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));

  const claimed = await repository.claimCase(caseId);
  expect(claimed).toMatchObject({ caseId });

  const reclaimed = await repository.claimCase(caseId);
  expect(reclaimed).toBeNull();
});

dbTest("lists pending case ids", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));

  const pending = await repository.getPendingCaseIds();
  expect(pending).toContain(caseId);
});

dbTest(
  "appends a human review as a superseding revision without overwriting the proposal",
  async (repository) => {
    const id = uniqueSourceRecordId();
    const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
    const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);

    const { findingId: reviewId } = await repository.appendReviewRevision(proposalId, seedReview);

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

dbTest("rejects a second review of the same finding", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);
  await repository.appendReviewRevision(proposalId, seedReview);

  await expect(
    repository.appendReviewRevision(proposalId, { ...seedReview, decision: "REJECTED" }),
  ).rejects.toThrow(/FINDING_ALREADY_REVIEWED/);
});

dbTest("accepting a finding opens one pending remediation", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);

  const { remediationId } = await repository.appendReviewRevision(proposalId, seedReview);
  expect(remediationId).not.toBeNull();

  const board = await repository.getRemediationBoard();
  const card = board.columns
    .flatMap((column) => column.items)
    .find((item) => item.id === remediationId);
  expect(card).toMatchObject({
    caseId,
    summary: "预付款比例超过制度上限",
    severity: "HIGH",
    owner: null,
    dueAt: null,
    overdue: false,
  });
});

dbTest("rejecting a finding opens no remediation", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);

  const result = await repository.appendReviewRevision(proposalId, {
    ...seedReview,
    decision: "REJECTED",
    reason: "误报",
  });
  expect(result.remediationId).toBeNull();

  const board = await repository.getRemediationBoard();
  const cards = board.columns.flatMap((column) => column.items);
  expect(cards.some((item) => item.caseId === caseId)).toBe(false);
});

dbTest("advances a remediation one step at a time", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);
  const { remediationId } = await repository.appendReviewRevision(proposalId, seedReview);
  if (remediationId === null) throw new Error("expected a remediation");

  // Skipping 整改中 land on 待复核 is not a legal move.
  await expect(
    repository.updateRemediation(remediationId, { status: "awaiting_review" }),
  ).rejects.toThrow(/REMEDIATION_ILLEGAL_TRANSITION/);

  const inProgress = await repository.updateRemediation(remediationId, {
    owner: "张工",
    status: "in_progress",
  });
  expect(inProgress).toMatchObject({ status: "in_progress", owner: "张工" });

  const awaiting = await repository.updateRemediation(remediationId, { status: "awaiting_review" });
  expect(awaiting.status).toBe("awaiting_review");

  // Closing is the reviewer's separate action, never a transition target.
  await expect(repository.updateRemediation(remediationId, { status: "closed" })).rejects.toThrow(
    /REMEDIATION_ILLEGAL_TRANSITION/,
  );
});

dbTest("closing needs awaiting review and a reviewer other than the owner", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);
  const { remediationId } = await repository.appendReviewRevision(proposalId, seedReview);
  if (remediationId === null) throw new Error("expected a remediation");

  await expect(repository.closeRemediation(remediationId, "李复核")).rejects.toThrow(
    /REMEDIATION_NOT_AWAITING_REVIEW/,
  );

  await repository.updateRemediation(remediationId, { owner: "张工", status: "in_progress" });
  await repository.updateRemediation(remediationId, { status: "awaiting_review" });

  // The person who owned the fix may not confirm it themselves.
  await expect(repository.closeRemediation(remediationId, "张工")).rejects.toThrow(
    /REMEDIATION_SELF_CLOSE/,
  );

  const closed = await repository.closeRemediation(remediationId, "李复核");
  expect(closed).toMatchObject({ status: "closed", closedBy: "李复核", owner: "张工" });
  expect(closed.closedAt).not.toBeNull();

  // Closed is terminal: no further edits.
  await expect(repository.updateRemediation(remediationId, { owner: "王" })).rejects.toThrow(
    /REMEDIATION_CLOSED/,
  );
});

dbTest("marks an open remediation overdue once its deadline has passed", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const proposalId = await repository.appendFindingRevision(caseId, seedProposal, null);
  const { remediationId } = await repository.appendReviewRevision(proposalId, seedReview);
  if (remediationId === null) throw new Error("expected a remediation");

  await repository.updateRemediation(remediationId, {
    dueAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const board = await repository.getRemediationBoard();
  const card = board.columns
    .flatMap((column) => column.items)
    .find((item) => item.id === remediationId);
  expect(card?.overdue).toBe(true);
});

dbTest("marks stale running cases interrupted", async (repository) => {
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

dbTest("pings the database", async (repository) => {
  expect(await repository.ping()).toBe(true);
});

dbTest("appends a snapshot generation and reads the newest back", async (repository) => {
  const id = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(id, seedSnapshot(id));
  const original = await repository.getSnapshotByCase(caseId);

  // A reassessment rebuilds under different parameters; the appended
  // generation must become the one every reader sees.
  const rebuilt = createAuditSnapshot({
    sourceRecordId: id,
    document: normalizeContractDocument("乙方签订后支付合同金额的50%作为预付款。"),
    policyLimitRatio: 0.5,
  });
  await repository.appendSnapshot(caseId, rebuilt);

  const latest = await repository.getSnapshotByCase(caseId);
  expect(latest?.facts).toEqual(rebuilt.facts);
  expect(latest?.facts).not.toEqual(original?.facts);

  // Claiming hands the runner the newest snapshot's row, not the original.
  const claimed = await repository.claimCase(caseId);
  if (claimed === null) throw new Error("expected the pending case to be claimable");
  const claimedSnapshot = await repository.getSnapshot(claimed.snapshotId);
  expect(claimedSnapshot?.facts).toEqual(rebuilt.facts);
});

// ── Source provenance ─────────────────────────────────────────────

dbTest("records the provenance it was given and reports it back", async (repository) => {
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

dbTest("reports unknown provenance as null instead of inventing a paste", async (repository) => {
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

dbTest("round-trips a trace run with ordered steps", async (repository) => {
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

dbTest("getRecentRuns lists runs with step counts and contract titles", async (repository) => {
  const sourceId = uniqueSourceRecordId();
  const { caseId } = await repository.createPendingCase(sourceId, seedPartySnapshot(sourceId));

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

  // The row has to say who the contract is between, not just what it is called.
  expect(found?.parties).toEqual([
    { id: "party-1", label: "甲方", name: "重庆华盛贸易有限公司", evidenceId: "party-1-name" },
    { id: "party-2", label: "乙方", name: "成都建工集团有限公司", evidenceId: "party-2-name" },
  ]);
});

dbTest("stores an uploaded original's path and reads it back by name", async (repository) => {
  const id = uniqueSourceRecordId();
  await repository.createPendingCase(id, seedSnapshot(id), {
    type: "FILE_UPLOAD",
    displayName: "设备采购合同.docx",
  });

  await repository.updateSourceOriginalPath(id, `var/uploads/${id}.docx`);

  const record = await repository.getSourceRecord(id);
  expect(record?.originalPath).toBe(`var/uploads/${id}.docx`);
  expect(record?.name).toBe("设备采购合同.docx");
});

dbTest("a pasted source record carries no original", async (repository) => {
  const id = uniqueSourceRecordId();
  await repository.createPendingCase(id, seedSnapshot(id), {
    type: "TEXT_PASTE",
    displayName: null,
  });

  const record = await repository.getSourceRecord(id);
  expect(record?.originalPath).toBeNull();
});
