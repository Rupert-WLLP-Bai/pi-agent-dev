import { expect, test } from "bun:test";
import type { AuditSnapshot } from "@contract-audit/audit/model";
import { buildAuditReportDocx } from "./audit-report";

const minimalSnapshot = {
  id: "snap-1",
  auditCaseId: "case-1",
  ruleVersionId: "rv-1",
  createdAt: new Date().toISOString(),
  contractDocument: { blocks: [{ id: "b1", text: "测试合同" }] },
  parties: [],
  ruleAssessments: [
    {
      id: "a1",
      ruleCode: "PAYMENT_TERM",
      disposition: "COMPLIANT",
      basis: "账期 30 天",
    },
  ],
  evidence: [],
} as unknown as AuditSnapshot;

test("buildAuditReportDocx returns a non-empty docx buffer", async () => {
  const bytes = await buildAuditReportDocx({
    caseId: "case-1",
    contractTitle: "测试合同",
    status: "COMPLETED",
    snapshot: minimalSnapshot,
    findings: [],
    remediations: [],
    revisionDiffs: [],
  });
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);
});
