import { describe, expect, test } from "bun:test";
import type { ValidationCaseListItem, ValidationDiffEntry } from "@contract-audit/api";
import {
  caseResultOutcome,
  describeRunMeta,
  movementDiffEntries,
  summarizeCaseCards,
  validationCaseTypeLabels,
} from "./validation-presentation";

const caseRow = (
  caseType: ValidationCaseListItem["caseType"],
  outcome: "pass" | "fail" | "needs_review" | null,
  index = 0,
): ValidationCaseListItem => ({
  id: `${caseType}-${index}`,
  ruleCode: "ADVANCE_PAYMENT_LIMIT",
  caseType,
  name: `${caseType}-${index}`,
  input: "合同原文",
  expectedDisposition: "COMPLIANT",
  expectedNote: "",
  createdAt: "2026-09-13T08:00:00.000Z",
  latest:
    outcome === null
      ? null
      : {
          runId: "run-1",
          finishedAt: "2026-09-13T09:00:00.000Z",
          outcome,
          expected: "COMPLIANT",
          actual: outcome === "fail" ? "POLICY_CONFLICT" : "COMPLIANT",
        },
});

const diff = (change: ValidationDiffEntry["change"], caseName: string): ValidationDiffEntry => ({
  caseName,
  caseType: "POSITIVE",
  previous: change === "new" ? null : "pass",
  previousActual: "COMPLIANT",
  current: change === "regression" ? "fail" : "pass",
  currentActual: "COMPLIANT",
  change,
  note: "",
});

describe("caseResultOutcome", () => {
  test("reads a matched disposition as a pass", () => {
    expect(caseResultOutcome({ actual: "COMPLIANT", passed: true })).toBe("pass");
  });

  test("reads a mismatch as a failure", () => {
    expect(caseResultOutcome({ actual: "POLICY_CONFLICT", passed: false })).toBe("fail");
  });

  test("counts a deferral as neither pass nor fail, even against its label", () => {
    expect(caseResultOutcome({ actual: "NEEDS_HUMAN_REVIEW", passed: true })).toBe("needs_review");
    expect(caseResultOutcome({ actual: "NEEDS_HUMAN_REVIEW", passed: false })).toBe("needs_review");
  });
});

test("movementDiffEntries keeps only regressions and fixes", () => {
  const entries = [
    diff("unchanged", "unchanged"),
    diff("new", "new"),
    diff("regression", "regression"),
    diff("fixed", "fixed"),
  ];
  expect(movementDiffEntries(entries).map((entry) => entry.caseName)).toEqual([
    "regression",
    "fixed",
  ]);
});

test("labels every case shape in Chinese", () => {
  expect(validationCaseTypeLabels).toEqual({
    positive: "正例",
    negative: "反例",
    boundary: "边界例",
    false_positive: "历史误报",
    missing_evidence: "证据缺失",
  });
});

describe("summarizeCaseCards", () => {
  test("counts each group and words its chips by outcome", () => {
    const cards = summarizeCaseCards([
      caseRow("positive", "pass"),
      caseRow("positive", "pass", 1),
      caseRow("negative", "pass"),
      caseRow("negative", "fail", 1),
      caseRow("boundary", null),
      caseRow("false_positive", "needs_review"),
      caseRow("missing_evidence", "needs_review", 1),
    ]);

    expect(cards.map((card) => card.label)).toEqual([
      "正例",
      "反例",
      "边界例",
      "历史误报 / 证据缺失",
    ]);

    const [positive, negative, boundary, deferrals] = cards;
    expect(positive).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(positive.chips).toEqual([{ text: "2 / 2 通过", tone: "success" }]);

    expect(negative).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(negative.chips).toEqual([{ text: "1 / 2 失败", tone: "error" }]);

    // A group that has never been run shows its raw count, not a fake rate.
    expect(boundary.chips).toEqual([{ text: "共 1 例", tone: "default" }]);

    // A deferral is reported as a reproduction, never as a pass or a failure.
    expect(deferrals).toMatchObject({ needsReview: 2, failed: 0 });
    expect(deferrals.chips).toEqual([{ text: "复现 2", tone: "warning" }]);
  });

  test("reports a deferral and a failure separately", () => {
    const cards = summarizeCaseCards([
      caseRow("missing_evidence", "needs_review"),
      caseRow("missing_evidence", "fail", 1),
    ]);
    expect(cards[3].chips).toEqual([
      { text: "1 / 2 失败", tone: "error" },
      { text: "复现 1", tone: "warning" },
    ]);
  });
});

test("describeRunMeta names the rule, version, time and trigger", () => {
  expect(describeRunMeta(null)).toBe("尚未运行验证");
  const meta = describeRunMeta({
    id: "run-1",
    ruleId: "rule-1",
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    ruleName: "预付款上限规则",
    ruleVersion: 2,
    versionStatus: "draft",
    status: "failed",
    summary: { total: 0, passed: 0, failed: 0, byCaseType: {} as never },
    triggeredBy: "规则管理员",
    startedAt: "2026-09-13T09:00:00.000Z",
    finishedAt: "2026-09-13T09:00:01.000Z",
  });
  expect(meta).toContain("预付款上限规则 · v2");
  expect(meta).toContain("最近运行");
  expect(meta).toContain("触发人 规则管理员");
});
