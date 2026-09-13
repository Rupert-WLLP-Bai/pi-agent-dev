import { expect, test } from "bun:test";
import type { RuleListItem, RuleVersionRecord, ValidationRunRecord } from "@contract-audit/api";
import {
  contractTypeOptions,
  describeLastValidation,
  describePublishGate,
  describeRuleIo,
  failedValidationCases,
  filterRules,
  parseParamValue,
  type RuleFilters,
  ruleVersionStatusLabels,
  summarizeValidation,
  validationOutcomeText,
} from "./rule-presentation";

const runAt = (
  status: ValidationRunRecord["status"],
  failed: number,
  passed = 4,
): ValidationRunRecord => ({
  id: "run-1",
  ruleVersionId: "rv-1",
  ruleCode: "ADVANCE_PAYMENT_LIMIT",
  triggeredBy: "规则管理员",
  startedAt: "2026-09-13T08:00:00.000Z",
  finishedAt: "2026-09-13T08:00:01.000Z",
  status,
  summary: {
    total: passed + failed,
    passed,
    failed,
    byCaseType: {
      POSITIVE: {
        total: 2,
        passed: status === "passed" ? 2 : 1,
        failed: status === "passed" ? 0 : 1,
      },
      NEGATIVE: { total: 2, passed: 2, failed: 0 },
      BOUNDARY: { total: 0, passed: 0, failed: 0 },
    },
  },
  details: [
    {
      caseName: "bench-02",
      caseType: "POSITIVE",
      expected: "COMPLIANT",
      actual: status === "passed" ? "COMPLIANT" : "POLICY_CONFLICT",
      passed: status === "passed",
      note: status === "passed" ? "" : "期望 COMPLIANT，实际 POLICY_CONFLICT",
    },
  ],
});

const draftAt = (lastValidationRunId: string | null): RuleVersionRecord => ({
  id: "rv-1",
  ruleId: "rule-1",
  version: 2,
  params: { limitRatio: 0.3 },
  stances: { preferred: "", acceptableRetreat: "", unacceptable: "", exceptionApproval: "" },
  status: "draft",
  publishedBy: null,
  publishedAt: null,
  lastValidationRunId,
  createdAt: "2026-09-13T08:00:00.000Z",
});

test("labels every rule version status in Chinese", () => {
  expect(ruleVersionStatusLabels).toEqual({
    published: "已发布",
    draft: "草稿",
    retired: "已停用",
  });
});

test("summarises validation totals per case type", () => {
  const run = runAt("failed", 1);
  const chips = summarizeValidation(run.summary);

  expect(chips.map((chip) => chip.label)).toEqual(["正例", "反例", "边界例"]);
  expect(chips[0]).toMatchObject({ total: 2, passed: 1, failed: 1, tone: "error" });
  expect(chips[1]).toMatchObject({ total: 2, passed: 2, failed: 0, tone: "success" });
  expect(chips[2]).toMatchObject({ total: 0, tone: "success" });
});

test("reads an empty validation summary as no chips", () => {
  expect(summarizeValidation(null)).toEqual([]);
});

test("words the validation outcome by what failed, not by a score", () => {
  expect(validationOutcomeText(runAt("passed", 0).summary)).toBe("全部通过（共 4 例）");
  expect(validationOutcomeText(runAt("failed", 2).summary)).toBe("2 例失败 / 共 6 例");
});

test("lists only the failed cases with their difference note", () => {
  expect(failedValidationCases(runAt("passed", 0))).toEqual([]);
  expect(failedValidationCases(runAt("failed", 1))).toEqual([
    expect.objectContaining({ passed: false, note: "期望 COMPLIANT，实际 POLICY_CONFLICT" }),
  ]);
});

test("blocks publish with the reason until a green run exists", () => {
  expect(describePublishGate({ activeDraft: null, draftValidationRun: null })).toEqual({
    enabled: false,
    reason: "没有待发布的草稿版本",
  });
  expect(describePublishGate({ activeDraft: draftAt(null), draftValidationRun: null })).toEqual({
    enabled: false,
    reason: "尚未运行验证",
  });
  expect(
    describePublishGate({ activeDraft: draftAt("run-1"), draftValidationRun: runAt("failed", 2) }),
  ).toEqual({ enabled: false, reason: "验证未通过：2 例失败" });
  expect(
    describePublishGate({ activeDraft: draftAt("run-1"), draftValidationRun: runAt("passed", 0) }),
  ).toEqual({ enabled: true, reason: null });
});

test("renders the last validation cell with time and outcome", () => {
  const base = {
    id: "rule-1",
    code: "ADVANCE_PAYMENT_LIMIT",
    name: "预付款上限规则",
    contractType: "采购类",
    description: "",
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
    currentVersion: 1,
    status: "published" as const,
    publishedBy: "系统初始化",
  };

  expect(describeLastValidation({ ...base, lastValidation: null }).tone).toBe("none");
  expect(
    describeLastValidation({
      ...base,
      lastValidation: {
        status: "passed",
        finishedAt: "2026-09-13T08:00:00.000Z",
        summary: runAt("passed", 0).summary,
      },
    }),
  ).toMatchObject({ tone: "success" });
  expect(
    describeLastValidation({
      ...base,
      lastValidation: {
        status: "failed",
        finishedAt: "2026-09-13T08:00:00.000Z",
        summary: runAt("failed", 1).summary,
      },
    }),
  ).toMatchObject({ tone: "error" });
});

const ruleListItem = (
  id: string,
  code: string,
  name: string,
  contractType: string,
  status: RuleListItem["status"],
): RuleListItem => ({
  id,
  code,
  name,
  contractType,
  description: "",
  createdAt: "2026-09-13T08:00:00.000Z",
  updatedAt: "2026-09-13T08:00:00.000Z",
  currentVersion: 1,
  status,
  lastValidation: null,
  publishedBy: null,
});

test("filters rules by name, code, status and contract type", () => {
  const rules = [
    ruleListItem("1", "ADVANCE_PAYMENT_LIMIT", "预付款上限规则", "采购类", "published"),
    ruleListItem("2", "PENALTY_RATIO_LIMIT", "违约金比例规则", "全部", "draft"),
  ];
  const ids = (search: string, status: RuleFilters["status"], contractType: string) =>
    filterRules(rules, { search, status, contractType }).map((rule) => rule.id);

  expect(ids("预付款", "ALL", "ALL")).toEqual(["1"]);
  expect(ids("penalty", "ALL", "ALL")).toEqual(["2"]);
  expect(ids("", "draft", "ALL")).toEqual(["2"]);
  expect(ids("", "ALL", "采购类")).toEqual(["1"]);
  expect(ids("nothing", "ALL", "ALL")).toEqual([]);
});

test("offers 全部 plus the distinct contract types", () => {
  const rules = [
    ruleListItem("1", "A", "a", "采购类", "published"),
    ruleListItem("2", "B", "b", "服务类", "draft"),
    ruleListItem("3", "C", "c", "采购类", "draft"),
  ];
  expect(contractTypeOptions(rules)).toEqual(["全部", "服务类", "采购类"]);
});

test("declares the deterministic input and output of a rule", () => {
  expect(describeRuleIo("ADVANCE_PAYMENT_LIMIT")).toEqual({
    input: "facts.advancePaymentRatio",
    output: "POLICY_CONFLICT | COMPLIANT",
  });
  expect(describeRuleIo("UNKNOWN_RULE")).toEqual({ input: "未声明", output: "未声明" });
});

test("parses parameter-editor strings into typed values", () => {
  expect(parseParamValue("0.3")).toBe(0.3);
  expect(parseParamValue("-2")).toBe(-2);
  expect(parseParamValue("重庆")).toBe("重庆");
  expect(parseParamValue("true")).toBe(true);
  expect(parseParamValue("false")).toBe(false);
});
