import { expect, test } from "bun:test";
import type { RuleListItem } from "@contract-audit/api";
import { summarizeRules } from "./demo-presentation";

const summary = (failed: number): RuleListItem["lastValidation"] => ({
  status: failed === 0 ? "passed" : "failed",
  finishedAt: "2026-09-13T08:00:01.000Z",
  summary: {
    total: 4,
    passed: 4 - failed,
    failed,
    byCaseType: {
      POSITIVE: { total: 2, passed: 2 - failed, failed },
      NEGATIVE: { total: 2, passed: 2, failed: 0 },
      BOUNDARY: { total: 0, passed: 0, failed: 0 },
    },
  },
});

const rule = (overrides: Partial<RuleListItem> = {}): RuleListItem => ({
  id: "rule-1",
  code: "ADVANCE_PAYMENT_LIMIT",
  name: "预付款上限规则",
  contractType: "采购合同",
  description: "",
  enabled: true,
  disabledReason: null,
  disabledBy: null,
  disabledAt: null,
  currentVersion: 1,
  status: "published",
  lastValidation: null,
  publishedBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("counts total, enabled, and validated rules", () => {
  const stats = summarizeRules([
    rule({ id: "a", lastValidation: summary(0) }),
    rule({ id: "b", enabled: false, lastValidation: summary(1) }),
    rule({ id: "c" }),
  ]);

  // The disabled rule still counts toward the total, but not toward 运行中.
  expect(stats).toEqual({ total: 3, enabled: 2, validated: 2 });
});

test("an empty rule list summarises to zeroes", () => {
  expect(summarizeRules([])).toEqual({ total: 0, enabled: 0, validated: 0 });
});
