import { expect, test } from "bun:test";
import type { ContractParty, EvidenceLocator } from "./model";
import type { SubjectVerificationPort } from "./ports";
import { runSubjectVerification } from "./subject-verification";
import { createFixtureSubjectVerificationPort } from "./subject-verification-fixture";

const party = (id: string, name: string): ContractParty => ({
  id,
  label: "乙方",
  name,
  evidenceId: `${id}-name`,
});

const recordTypesIn = (evidence: EvidenceLocator[]) =>
  evidence.flatMap((item) =>
    item.location.kind === "EXTERNAL_RECORD" ? [item.location.recordType] : [],
  );

test("anchors one external record per factor the provider reported with a count", async () => {
  const run = await runSubjectVerification({
    parties: [party("party-1", "深圳精工科技有限公司")],
    port: createFixtureSubjectVerificationPort(),
  });

  const [verification] = run.verifications;
  const reportedFactors = verification.dimensions
    .filter((dimension) => dimension.count > 0)
    .map((dimension) => dimension.factor);

  expect(verification.status).toBe("RESOLVED");
  expect(reportedFactors.length).toBeGreaterThan(0);
  expect(recordTypesIn(run.evidence).sort()).toEqual([...reportedFactors].sort());
  expect(recordTypesIn(run.evidence)).not.toContain("失信信息");
  expect(run.evidence.every((item) => item.location.kind === "EXTERNAL_RECORD")).toBe(true);
});

test("cites the source record that answered the verification", async () => {
  const run = await runSubjectVerification({
    parties: [party("party-1", "深圳精工科技有限公司")],
    port: createFixtureSubjectVerificationPort(),
  });

  const [verification] = run.verifications;
  const sourceRecordId = verification.sourceRecordId;
  if (sourceRecordId === null)
    throw new Error("expected a source record id for a resolved subject");
  const citedRecordIds = new Set(run.evidence.map((item) => item.sourceRecordId));

  for (const record of run.sourceRecords) {
    expect(citedRecordIds.has(record.id)).toBe(true);
  }
  expect(run.evidence.map((item) => item.sourceRecordId)).toEqual(
    run.evidence.map(() => sourceRecordId),
  );
  expect(verification.evidenceIds).toEqual(run.evidence.map((item) => item.id));
});

test("produces no external record when the provider cannot choose a subject", async () => {
  const run = await runSubjectVerification({
    parties: [party("party-1", "重庆华盛贸易")],
    port: createFixtureSubjectVerificationPort(),
  });

  const [verification] = run.verifications;

  expect(verification.status).toBe("AMBIGUOUS");
  expect(verification.candidates.length).toBeGreaterThan(0);
  expect(verification.evidenceIds).toEqual([]);
  expect(run.evidence).toEqual([]);
});

test("reports an unavailable verification when the provider throws", async () => {
  const port: SubjectVerificationPort = {
    provider: "qcc-fixture",
    tool: "get_company_risk_scan",
    async verify() {
      throw new Error("核验服务不可用");
    },
  };

  const run = await runSubjectVerification({
    parties: [party("party-1", "深圳精工科技有限公司")],
    port,
  });

  const [verification] = run.verifications;

  expect(verification.status).toBe("UNAVAILABLE");
  expect(verification.failureReason).toBe("核验服务不可用");
  expect(verification.matched).toBeNull();
  expect(typeof verification.sourceRecordId).toBe("string");
  expect(run.evidence).toEqual([]);
  expect(run.sourceRecords[0].outcome.failureReason).toBe("核验服务不可用");
});
