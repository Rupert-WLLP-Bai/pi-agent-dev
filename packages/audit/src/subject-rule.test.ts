import { expect, test } from "bun:test";
import type { ContractParty, SubjectVerification } from "./model";
import { classifySubjectDimensions, evaluateSubjectRiskRule } from "./subject-rule";

const party = (id: string, name: string): ContractParty => ({
  id,
  label: "乙方",
  name,
  evidenceId: `${id}-name`,
});

const resolved = "深圳精工科技有限公司";

const verification = (overrides: Partial<SubjectVerification> = {}): SubjectVerification => ({
  id: "verification-party-1",
  partyId: "party-1",
  status: "RESOLVED",
  candidates: [],
  matched: {
    name: resolved,
    unifiedSocialCreditCode: "91440300MA5F1PQR7X",
    registrationStatus: "存续",
  },
  dimensions: [],
  providerSummary: "",
  evidenceIds: [],
  sourceRecordId: "record-1",
  capturedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-08T00:00:00.000Z",
  failureReason: null,
  ...overrides,
});

const assessmentFor = (subject: SubjectVerification) =>
  evaluateSubjectRiskRule({
    parties: [party("party-1", resolved)],
    verifications: [subject],
  });

test("asks a human to review a contract that names no parties", () => {
  const assessment = evaluateSubjectRiskRule({ parties: [], verifications: [] });

  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
  expect(assessment.evidenceIds).toEqual([]);
});

test("ignores factors reported against a subject the provider could not settle", () => {
  const assessment = assessmentFor(verification({
    status: "AMBIGUOUS",
    matched: null,
    candidates: [
      { name: "深圳精工科技有限公司", unifiedSocialCreditCode: "91440300MA5F1PQR7X", registrationStatus: "存续" },
      { name: "深圳精工智能科技有限公司", unifiedSocialCreditCode: "91440300MA5F1PQR7Y", registrationStatus: "存续" },
    ],
    dimensions: classifySubjectDimensions([{ factor: "失信信息", count: 2, detailTool: "get_dishonest_info" }]),
  }));

  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("asks a human to review a subject the provider could not reach", () => {
  const assessment = assessmentFor(verification({
    status: "UNAVAILABLE",
    matched: null,
    dimensions: classifySubjectDimensions([{ factor: "被执行人", count: 1, detailTool: "get_judgment_debtor_info" }]),
    failureReason: "核验来源连接超时",
  }));

  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("flags a policy conflict when a red-line factor has records", () => {
  const subject = verification({
    dimensions: classifySubjectDimensions([{ factor: "被执行人", count: 1, detailTool: "get_judgment_debtor_info" }]),
    evidenceIds: ["party-1-被执行人"],
  });

  const assessment = assessmentFor(subject);

  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.evidenceIds).toEqual(["party-1-name", "party-1-被执行人"]);
});

test("stays compliant when only background factors have records", () => {
  const subject = verification({
    dimensions: classifySubjectDimensions([
      { factor: "裁判文书", count: 9999, detailTool: "get_judicial_documents" },
      { factor: "开庭公告", count: 400, detailTool: "get_hearing_notice" },
    ]),
  });

  expect(assessmentFor(subject).disposition).toBe("COMPLIANT");
});

test("stays compliant when every factor count is zero", () => {
  const subject = verification({
    dimensions: classifySubjectDimensions([
      { factor: "失信信息", count: 0, detailTool: "get_dishonest_info" },
      { factor: "裁判文书", count: 0, detailTool: "get_judicial_documents" },
    ]),
  });

  expect(assessmentFor(subject).disposition).toBe("COMPLIANT");
});

test("reports a settled red line even when another party could not be resolved", () => {
  const assessment = evaluateSubjectRiskRule({
    parties: [party("party-1", resolved), party("party-2", "恒昌建筑")],
    verifications: [
      verification({
        dimensions: classifySubjectDimensions([
          { factor: "失信信息", count: 2, detailTool: "get_dishonest_info" },
        ]),
        evidenceIds: ["party-1-失信信息"],
      }),
      verification({
        id: "verification-party-2",
        partyId: "party-2",
        status: "AMBIGUOUS",
        matched: null,
        evidenceIds: [],
      }),
    ],
  });

  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.evidenceIds).toContain("party-1-失信信息");
  expect(assessment.basis).toContain("失信信息");
  expect(assessment.basis).toContain("尚未确认");
});

test("never calls a party compliant before it has been verified", () => {
  const assessment = evaluateSubjectRiskRule({
    parties: [party("party-1", resolved)],
    verifications: [],
  });

  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
  expect(assessment.basis).toContain("尚未核验");
});
