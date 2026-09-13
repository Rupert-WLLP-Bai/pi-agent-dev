import { expect, test } from "bun:test";
import {
  canAdvanceRemediation,
  nextRemediationStatus,
  remediationStatusOrder,
} from "@contract-audit/audit/remediation";
import {
  describeAdvance,
  formatRemediationDue,
  formatRemediationSummary,
  isRemediationOverdue,
  remediationStatusLabels,
} from "./remediation-presentation";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

test("advances exactly one step and stops before closed", () => {
  expect(nextRemediationStatus("pending")).toBe("in_progress");
  expect(nextRemediationStatus("in_progress")).toBe("awaiting_review");
  // 待复核 does not advance to 已关闭: closing is the reviewer's separate action.
  expect(nextRemediationStatus("awaiting_review")).toBeNull();
  expect(nextRemediationStatus("closed")).toBeNull();
});

test("accepts only the single legal next step", () => {
  expect(canAdvanceRemediation("pending", "in_progress")).toBe(true);
  expect(canAdvanceRemediation("in_progress", "awaiting_review")).toBe(true);

  // Skipping a column, jumping to close, or moving backwards is refused.
  expect(canAdvanceRemediation("pending", "awaiting_review")).toBe(false);
  expect(canAdvanceRemediation("pending", "closed")).toBe(false);
  expect(canAdvanceRemediation("in_progress", "closed")).toBe(false);
  expect(canAdvanceRemediation("in_progress", "pending")).toBe(false);
  expect(canAdvanceRemediation("awaiting_review", "closed")).toBe(false);
  expect(canAdvanceRemediation("closed", "in_progress")).toBe(false);
});

test("the four columns follow the lifecycle order", () => {
  expect([...remediationStatusOrder]).toEqual(["pending", "in_progress", "awaiting_review", "closed"]);
  for (const status of remediationStatusOrder) expect(remediationStatusLabels[status]).toBeTruthy();
});

test("describeAdvance maps each stage to its button state", () => {
  expect(describeAdvance("pending")).toEqual({ next: "in_progress", label: "推进至整改中" });
  expect(describeAdvance("in_progress")).toEqual({ next: "awaiting_review", label: "推进至待复核" });
  expect(describeAdvance("awaiting_review")).toEqual({ next: null, label: "等待复核关闭" });
  expect(describeAdvance("closed")).toEqual({ next: null, label: "已关闭" });
});

test("overdue is only for open cards past their deadline", () => {
  const past = { dueAt: new Date(NOW - 60_000).toISOString() };
  const future = { dueAt: new Date(NOW + 60_000).toISOString() };

  expect(isRemediationOverdue(past, "pending", NOW)).toBe(true);
  expect(isRemediationOverdue(past, "in_progress", NOW)).toBe(true);
  // A closed item's missed deadline is history, not a live escalation.
  expect(isRemediationOverdue(past, "closed", NOW)).toBe(false);
  expect(isRemediationOverdue(future, "pending", NOW)).toBe(false);
  expect(isRemediationOverdue({ dueAt: null }, "pending", NOW)).toBe(false);
});

test("the due line spells overdue out in words, not only colour", () => {
  const past = { dueAt: new Date(NOW - 60_000).toISOString() };
  expect(formatRemediationDue({ dueAt: null }, "pending", NOW)).toEqual({
    label: "未设定截止",
    overdue: false,
  });
  expect(formatRemediationDue(past, "pending", NOW).overdue).toBe(true);
  expect(formatRemediationDue(past, "pending", NOW).label).toContain("已逾期");
  const closedPast = formatRemediationDue(past, "closed", NOW);
  expect(closedPast.overdue).toBe(false);
  expect(closedPast.label).not.toContain("已逾期");
});

test("summary collapses whitespace and elides a long tail", () => {
  expect(formatRemediationSummary("  预付款比例\n超过制度上限 ")).toBe("预付款比例 超过制度上限");
  const long = "这是一个非常长的风险摘要".repeat(5);
  const formatted = formatRemediationSummary(long);
  expect(formatted.endsWith("…")).toBe(true);
  expect(formatted.length).toBeLessThanOrEqual(41);
});
