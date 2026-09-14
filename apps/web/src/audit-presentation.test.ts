import { expect, test } from "bun:test";
import { ENGINE_RULE_CODES } from "@contract-audit/audit";
import type { AuditCase, RuleAssessment } from "@contract-audit/audit/model";
import {
  canDownloadOriginal,
  deriveQueueStats,
  describeSourceProvenance,
  factCellsForFinding,
  filterAndSortCases,
  getAuditDisplayState,
  getAvailableCaseActions,
  groupAssessmentsByDisposition,
  visibleFindings,
} from "./audit-presentation";

const caseAt = (
  id: string,
  status: AuditCase["status"],
  stage: AuditCase["stage"],
  updatedAt: string,
): AuditCase => ({
  id,
  status,
  stage,
  sourceRecordId: `source-${id}`,
  contractRevisionId: null,
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt,
});

test("awaiting review wins over the completed machine status", () => {
  const auditCase = caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z");
  expect(getAuditDisplayState(auditCase)).toMatchObject({
    key: "AWAITING_REVIEW",
    label: "待复核",
  });
  expect(getAvailableCaseActions(auditCase)).toEqual(["VIEW"]);
});

test("derives only statistics available from case rows", () => {
  const cases = [
    caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z"),
    caseAt("pending", "PENDING", "QUEUED", "2026-09-11T09:10:00.000Z"),
    caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T09:20:00.000Z"),
    caseAt("failed", "FAILED", "FAILED", "2026-09-11T09:30:00.000Z"),
    caseAt("interrupted", "INTERRUPTED", "INTERRUPTED", "2026-09-10T09:30:00.000Z"),
    caseAt("done", "COMPLETED", "COMPLETED", "2026-09-11T09:40:00.000Z"),
  ];
  expect(deriveQueueStats(cases, new Date("2026-09-11T12:00:00.000Z"))).toEqual({
    awaitingReview: 1,
    processing: 2,
    abnormal: 2,
    completedToday: 1,
  });
});

test("filters by product lifecycle and sorts by latest update", () => {
  const cases = [
    caseAt("older-failure", "FAILED", "FAILED", "2026-09-11T08:00:00.000Z"),
    caseAt("newer-interruption", "INTERRUPTED", "INTERRUPTED", "2026-09-11T10:00:00.000Z"),
    caseAt("running", "RUNNING", "AGENT_RUNNING", "2026-09-11T11:00:00.000Z"),
  ];
  expect(filterAndSortCases(cases, "ABNORMAL", "").map(({ id }) => id)).toEqual([
    "newer-interruption",
    "older-failure",
  ]);
  expect(filterAndSortCases(cases, "ALL", "RUN").map(({ id }) => id)).toEqual(["running"]);
});

const findingWith = (id: string, decision: string | null) => ({
  id,
  review: decision === null ? null : { decision },
});

test("待处理 tab hides findings a reviewer has already decided", () => {
  const findings = [findingWith("a", "ACCEPTED"), findingWith("b", null), findingWith("c", null)];
  expect(visibleFindings(findings, "pending").map(({ id }) => id)).toEqual(["b", "c"]);
});

test("全部 tab keeps every finding in order", () => {
  const findings = [findingWith("a", "REJECTED"), findingWith("b", null)];
  expect(visibleFindings(findings, "all")).toBe(findings);
});

test("fact grid only applies to payment findings", () => {
  const facts = { advancePaymentRatio: 0.42, policyLimitRatio: 0.3 };
  expect(factCellsForFinding("SUBJECT_RED_LINE_RISK", facts)).toBeNull();
  expect(factCellsForFinding("TERMINATION_CLAUSE_PRESENT", facts)).toBeNull();
});

test("payment finding fact grid compares contract ratio with the policy limit", () => {
  const cells = factCellsForFinding("ADVANCE_PAYMENT_LIMIT", {
    advancePaymentRatio: 0.42,
    policyLimitRatio: 0.3,
  });
  expect(cells).toEqual([
    { label: "合同实际值", value: "42%", tone: "bad" },
    { label: "制度上限", value: "30%", tone: "ref" },
    { label: "超出", value: "+12pp", tone: "neutral" },
  ]);
});

const assessment = (
  ruleCode: RuleAssessment["ruleCode"],
  disposition: RuleAssessment["disposition"],
): RuleAssessment => ({ id: `a-${ruleCode}`, ruleCode, disposition, evidenceIds: [], basis: "" });

test("coverage groups assessments and reports unassessed engine rules", () => {
  const groups = groupAssessmentsByDisposition([
    assessment("ADVANCE_PAYMENT_LIMIT", "POLICY_CONFLICT"),
    assessment("PENALTY_RATIO_LIMIT", "COMPLIANT"),
    assessment("TERMINATION_CLAUSE_PRESENT", "NEEDS_HUMAN_REVIEW"),
  ]);
  expect(groups.conflict.map(({ ruleCode }) => ruleCode)).toEqual(["ADVANCE_PAYMENT_LIMIT"]);
  expect(groups.compliant.map(({ ruleCode }) => ruleCode)).toEqual(["PENALTY_RATIO_LIMIT"]);
  expect(groups.needsReview.map(({ ruleCode }) => ruleCode)).toEqual([
    "TERMINATION_CLAUSE_PRESENT",
  ]);
  expect(groups.notApplicable).toHaveLength(ENGINE_RULE_CODES.length - 3);
  expect(groups.notApplicable).not.toContain("ADVANCE_PAYMENT_LIMIT");
});

test("only a file upload with stored bytes can be downloaded", () => {
  expect(
    canDownloadOriginal({
      sourceProvenance: { type: "FILE_UPLOAD", displayName: "合同.docx" },
      originalDownloadable: true,
    }),
  ).toBe(true);
  expect(
    canDownloadOriginal({
      sourceProvenance: { type: "TEXT_PASTE", displayName: null },
      originalDownloadable: false,
    }),
  ).toBe(false);
  expect(
    canDownloadOriginal({
      sourceProvenance: { type: "FILE_UPLOAD", displayName: "合同.docx" },
      originalDownloadable: false,
    }),
  ).toBe(false);
});

test("file-upload provenance names object storage vs local disk", () => {
  expect(
    describeSourceProvenance({ type: "FILE_UPLOAD", displayName: "设备采购合同.docx" }, "s3"),
  ).toEqual({
    primary: "设备采购合同.docx",
    secondary: "对象存储",
  });
  expect(describeSourceProvenance({ type: "FILE_UPLOAD", displayName: null }, "local")).toEqual({
    primary: "本地文件",
    secondary: null,
  });
  expect(describeSourceProvenance({ type: "TEXT_PASTE", displayName: null }, null)).toEqual({
    primary: "文本粘贴",
    secondary: null,
  });
});
