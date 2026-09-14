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

maybeTest("real repository matches fake overview and recent-run semantics", async () => {
  await withReal(async (repository) => {
    const result = await exerciseOverviewAndRuns(repository);
    // Shared DB may already hold rows; assert the scenario's contributions.
    expect(result.totalCases).toBeGreaterThanOrEqual(1);
    expect(result.stepCount).toBe(1);
    expect(result.acceptedFindings).toBeGreaterThanOrEqual(1);
  });
});
