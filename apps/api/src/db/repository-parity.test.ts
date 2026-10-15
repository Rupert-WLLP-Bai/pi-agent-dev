import { expect, test } from "bun:test";
import type { FindingProposal, HumanReview } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuditCaseRepository, type DrizzleDB } from "../db/repositories";
import { schema } from "../db/schema";
import { InMemoryAuditCaseRepository } from "../testing/fakes";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit";

const canConnect = await postgres(databaseUrl, { connect_timeout: 3 })`SELECT 1`
  .then(() => true)
  .catch(() => false);

const maybeTest = canConnect ? test : test.skip;

class Rollback extends Error {}

const withReal = async (
  body: (repository: AuditCaseRepository) => Promise<void>,
): Promise<void> => {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await drizzle({ client, schema }).transaction(async (tx) => {
      await body(new AuditCaseRepository(tx as unknown as DrizzleDB));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await client.end();
  }
};

const snapshot = (sourceRecordId: string) =>
  createAuditSnapshot({
    sourceRecordId,
    document: normalizeContractDocument(
      ["甲方：重庆华盛贸易有限公司", "乙方：测试相对方有限公司", "预付款 70%。"].join("\n"),
    ),
    policyLimitRatio: 0.3,
  });

const proposal: FindingProposal = {
  assessmentId: "assessment-payment",
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  severity: "HIGH",
  rationale: "超限",
  evidenceIds: ["contract-payment"],
  remediation: "下调",
};

const review: HumanReview = {
  decision: "ACCEPTED",
  reviewerId: "parity",
  reviewedAt: new Date().toISOString(),
};

/**
 * Shared scenario exercised against both the in-memory fake and the real
 * Postgres repository. Drift between the two surfaces fails this file.
 */
async function exerciseOverviewAndRuns(repository: {
  createPendingCase: AuditCaseRepository["createPendingCase"];
  updateCaseStatus: AuditCaseRepository["updateCaseStatus"];
  appendFindingRevision: AuditCaseRepository["appendFindingRevision"];
  appendReviewRevision: AuditCaseRepository["appendReviewRevision"];
  beginAgentRun: AuditCaseRepository["beginAgentRun"];
  appendAgentTraceStep: AuditCaseRepository["appendAgentTraceStep"];
  finishAgentRun: AuditCaseRepository["finishAgentRun"];
  getOverview: AuditCaseRepository["getOverview"];
  getRecentRuns: AuditCaseRepository["getRecentRuns"];
}): Promise<{ totalCases: number; stepCount: number; acceptedFindings: number }> {
  const sourceId = crypto.randomUUID();
  const { caseId } = await repository.createPendingCase(sourceId, snapshot(sourceId));
  await repository.updateCaseStatus(caseId, "AWAITING_REVIEW", "AWAITING_REVIEW");
  const findingId = await repository.appendFindingRevision(caseId, proposal, null);
  await repository.appendReviewRevision(findingId, review);

  const runId = await repository.beginAgentRun({
    auditCaseId: caseId,
    provider: "parity",
    model: "parity-model",
    version: "0",
  });
  await repository.appendAgentTraceStep(caseId, {
    runId,
    sequence: 0,
    kind: "STAGE",
    at: new Date().toISOString(),
    label: "RUN_STARTED",
    ref: null,
    parentRef: null,
    input: null,
    output: null,
    isError: false,
    durationMs: null,
    tokens: null,
  });
  await repository.finishAgentRun(runId, { usage: null, durationMs: 50, error: null });

  const overview = await repository.getOverview();
  const runs = await repository.getRecentRuns(10);
  const found = runs.find((run) => run.id === runId);
  expect(found?.stepCount).toBe(1);
  expect(overview.acceptedFindings).toBeGreaterThanOrEqual(1);
  return {
    totalCases: overview.totalCases,
    stepCount: found?.stepCount ?? 0,
    acceptedFindings: overview.acceptedFindings,
  };
}

test("fake repository covers overview and recent runs", async () => {
  const fake = new InMemoryAuditCaseRepository();
  const result = await exerciseOverviewAndRuns(fake);
  expect(result.totalCases).toBe(1);
  expect(result.stepCount).toBe(1);
  expect(result.acceptedFindings).toBe(1);
});

/**
 * Shared rerun scenario: an audited case gains a new case over the same Source
 * Record and Contract Revision, the old case is left exactly as it was, and the
 * guards refuse an active source case and a duplicate in-flight rerun. Drift
 * between the fake and the real repository fails this file.
 */
async function exerciseRerun(repository: {
  createPendingCase: AuditCaseRepository["createPendingCase"];
  updateCaseStatus: AuditCaseRepository["updateCaseStatus"];
  appendFindingRevision: AuditCaseRepository["appendFindingRevision"];
  appendReviewRevision: AuditCaseRepository["appendReviewRevision"];
  createRerunCase: AuditCaseRepository["createRerunCase"];
  getCase: AuditCaseRepository["getCase"];
  getSnapshotByCase: AuditCaseRepository["getSnapshotByCase"];
}): Promise<{ rerunCaseId: string; sourceCaseId: string }> {
  const sourceId = crypto.randomUUID();
  const { caseId } = await repository.createPendingCase(sourceId, snapshot(sourceId));
  await repository.updateCaseStatus(caseId, "AWAITING_REVIEW", "AWAITING_REVIEW");
  const findingId = await repository.appendFindingRevision(caseId, proposal, null);
  await repository.appendReviewRevision(findingId, review);

  // The old case's snapshot and reviewed finding are what history must keep.
  const snapshotBefore = await repository.getSnapshotByCase(caseId);

  const created = await repository.createRerunCase(caseId);
  expect(created.status).toBe("created");
  if (created.status !== "created") throw new Error("unreachable");

  const { caseId: rerunCaseId, sourceCaseId } = created;
  const sourceBefore = await repository.getCase(caseId);

  // The new case is queued and has no snapshot of its own yet.
  const rerunCase = await repository.getCase(rerunCaseId);
  expect(rerunCase).toMatchObject({ status: "PENDING", stage: "QUEUED" });
  expect(await repository.getSnapshotByCase(rerunCaseId)).toBeNull();
  // Same Source Record: the original bytes are re-read, not copied.
  expect(rerunCase?.sourceRecordId).toBe(sourceBefore?.sourceRecordId);

  // The source case keeps its snapshot and its status; nothing was rewritten.
  expect(await repository.getCase(sourceCaseId)).toEqual(sourceBefore);
  expect(await repository.getSnapshotByCase(sourceCaseId)).toEqual(snapshotBefore);

  // A source case that never stopped cannot be rerun.
  const pending = await repository.createPendingCase(crypto.randomUUID(), snapshot(sourceId));
  expect(await repository.createRerunCase(pending.caseId)).toEqual({ status: "case_active" });

  // A case that does not exist is reported as such rather than created.
  expect(await repository.createRerunCase(crypto.randomUUID())).toEqual({ status: "not_found" });

  return { rerunCaseId, sourceCaseId };
}

test("fake repository reruns an audited case as a new case", async () => {
  const fake = new InMemoryAuditCaseRepository();
  const { rerunCaseId, sourceCaseId } = await exerciseRerun(fake);
  expect(rerunCaseId).not.toBe(sourceCaseId);
  // The fake tracks the revision per case; the rerun reuses the source's.
  expect(fake.contractRevisionByCase.get(rerunCaseId)).toBe(
    fake.contractRevisionByCase.get(sourceCaseId),
  );
  expect(fake.contractRevisions.size).toBe(2);
  // Still only one case in flight for that revision, so a second rerun refuses.
  expect(await fake.createRerunCase(sourceCaseId)).toEqual({ status: "rerun_active" });
});

maybeTest("real repository reruns an audited case as a new case", async () => {
  await withReal(async (repository) => {
    const { rerunCaseId, sourceCaseId } = await exerciseRerun(repository);
    expect(rerunCaseId).not.toBe(sourceCaseId);
    // A second rerun is refused while the first is still queued.
    expect(await repository.createRerunCase(sourceCaseId)).toEqual({ status: "rerun_active" });
  });
});

/**
 * A malformed id must be answered as not-found, not raised. The case columns
 * are typed `uuid`, so sending a non-UUID string straight to SQL makes the
 * driver abort the whole transaction — which the HTTP layer would report as a
 * 500, blaming the server for the caller's bad id. Only the real repository can
 * catch that, so this case is Postgres-only.
 */
maybeTest("real repository answers a malformed rerun id as not found", async () => {
  await withReal(async (repository) => {
    for (const malformed of ["no-such-case", "not-a-uuid", "!!!"]) {
      expect(await repository.createRerunCase(malformed)).toEqual({ status: "not_found" });
    }
  });
});

maybeTest("real repository matches fake overview and recent-run semantics", async () => {
  await withReal(async (repository) => {
    const result = await exerciseOverviewAndRuns(repository);
    // Shared DB may already hold rows; assert the scenario's contributions.
    expect(result.totalCases).toBeGreaterThanOrEqual(1);
    expect(result.stepCount).toBe(1);
    expect(result.acceptedFindings).toBeGreaterThanOrEqual(1);
  });
});
