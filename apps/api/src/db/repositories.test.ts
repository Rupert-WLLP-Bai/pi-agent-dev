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
