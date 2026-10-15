import { describe, expect, test } from "bun:test";
import type { DecisionRequest } from "@contract-audit/audit/decision";
import { buildDecisionModelState, decisionInputHash, redactClauseExcerpt } from "./redaction";

const request: DecisionRequest = {
  schemaVersion: 1,
  auditCaseId: "case-1",
  snapshotId: "snapshot-1",
  agentRunId: "run-1",
  contractDocumentHash: "doc-hash",
  taskType: "clause_category",
  questionKey: "clause-category",
  question: { type: "choice", criteria: "条款类型？", options: ["payment", "dispute"] },
  questionVersion: "v1",
  policyVersion: "p1",
  redactionVersion: "r1",
  contractStance: null,
  structuredSignals: { ratio: 0.7 },
  maskedClauseExcerpt: "甲方北京示例科技有限公司应在合同签订后支付预付款。",
  evidenceRefs: [],
  ruleAssessments: [],
  // The comparison block is the label leakage vector: it must never reach the
  // model state.
  comparison: {
    assessmentId: "assessment-1",
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    baselineAnswer: { type: "noul", noul: 1 },
  },
  dataClassification: "SYNTHETIC",
  traceId: "trace-1",
};

describe("decision redaction", () => {
  test("redacts party names from the clause", () => {
    const masked = redactClauseExcerpt("甲方北京示例科技有限公司应付款。", [
      "北京示例科技有限公司",
    ]);
    expect(masked).not.toContain("北京示例科技有限公司");
    expect(masked).toContain("〔已脱敏〕");
  });

  test("redacts credit codes, accounts, phones and emails", () => {
    const masked = redactClauseExcerpt(
      "编码 91110108MA01ABCD1X，账号 6222021234567890123，电话 13800138000，邮箱 contact@example.com。",
      [],
    );
    expect(masked).not.toContain("91110108MA01ABCD1X");
    expect(masked).not.toContain("6222021234567890123");
    expect(masked).not.toContain("13800138000");
    expect(masked).not.toContain("contact@example.com");
  });

  test("the model state excludes every identity and comparison field", () => {
    const state = buildDecisionModelState(request, ["北京示例科技有限公司"]);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("case-1");
    expect(serialized).not.toContain("snapshot-1");
    expect(serialized).not.toContain("run-1");
    expect(serialized).not.toContain("trace-1");
    expect(serialized).not.toContain("doc-hash");
    expect(serialized).not.toContain("assessment-1");
    expect(serialized).not.toContain("ADVANCE_PAYMENT_LIMIT");
    // The masked clause itself is present, and the party name is not.
    expect(state.clause).not.toContain("北京示例科技有限公司");
    expect(state.clause.length).toBeGreaterThan(0);
  });

  test("the model state carries the question and the signals", () => {
    const state = buildDecisionModelState(request);
    expect(state.instructions).toBe("条款类型？");
    expect(state.signals).toEqual({ ratio: 0.7 });
    expect(state.dataClassification).toBe("SYNTHETIC");
  });

  test("an empty excerpt stays empty rather than becoming a placeholder", () => {
    const state = buildDecisionModelState({ ...request, maskedClauseExcerpt: null });
    expect(state.clause).toBe("");
  });
});

describe("decision input hash", () => {
  test("is stable for the same frozen request", () => {
    expect(decisionInputHash(request)).toBe(decisionInputHash(request));
  });

  test("changes when the masked excerpt changes", () => {
    expect(decisionInputHash(request)).not.toBe(
      decisionInputHash({ ...request, maskedClauseExcerpt: "另一段条款。" }),
    );
  });

  test("changes when the question version changes", () => {
    expect(decisionInputHash(request)).not.toBe(
      decisionInputHash({ ...request, questionVersion: "v2" }),
    );
  });

  test("ignores run identity, so a restart re-derives the same hash", () => {
    expect(decisionInputHash(request)).toBe(
      decisionInputHash({
        ...request,
        auditCaseId: "other",
        agentRunId: "other",
        traceId: "other",
      }),
    );
  });
});
