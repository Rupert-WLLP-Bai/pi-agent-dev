import { expect, test } from "bun:test";
import type { ReviewQueueItem } from "@contract-audit/api";
import {
  filterReviewQueue,
  formatRemaining,
  isOverdue,
  matchesQueueFilter,
  priorityLabels,
  priorityTones,
  reviewSeverityLabels,
  reviewSeverityTones,
  sortReviewQueue,
} from "./review-presentation";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

const item = (overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
  caseId: "case-1",
  contractTitle: "设备采购合同",
  findingId: "finding-1",
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  title: "预付款比例超过制度上限",
  severity: "HIGH",
  evidenceConflict: false,
  assignee: null,
  priority: null,
  dueAt: new Date(NOW + 3_600_000).toISOString(),
  remainingMs: 3_600_000,
  updatedAt: "2026-09-13T10:00:00.000Z",
  ...overrides,
});

test("formatRemaining states the countdown and marks overdue explicitly", () => {
  expect(formatRemaining(90_000)).toEqual({ label: "剩余 1 分钟", overdue: false });
  expect(formatRemaining(30_000)).toEqual({ label: "剩余 不足 1 分钟", overdue: false });
  expect(formatRemaining(2 * 3_600_000)).toEqual({ label: "剩余 2 小时", overdue: false });
  expect(formatRemaining(50 * 3_600_000)).toEqual({ label: "剩余 2 天", overdue: false });
  // Overdue is a word, not only a color.
  expect(formatRemaining(-90_000)).toEqual({ label: "已逾期 1 分钟", overdue: true });
});

test("isOverdue reads the deadline, not the value frozen at fetch time", () => {
  // The row arrived with time left, but the deadline has since passed.
  const past = item({ dueAt: new Date(NOW - 1000).toISOString(), remainingMs: 5_000 });
  expect(isOverdue(past, NOW)).toBe(true);
  expect(isOverdue(item(), NOW)).toBe(false);
});

test("sortReviewQueue orders by evidence conflict, then severity, then deadline", () => {
  const healthyHigh = item({
    caseId: "healthy-high",
    severity: "HIGH",
    dueAt: new Date(NOW + 60_000).toISOString(),
  });
  const conflictLow = item({
    caseId: "conflict-low",
    severity: "LOW",
    evidenceConflict: true,
    dueAt: new Date(NOW + 10 * 60_000).toISOString(),
  });
  const healthyMedium = item({ caseId: "healthy-medium", severity: "MEDIUM" });

  const sorted = sortReviewQueue([healthyHigh, healthyMedium, conflictLow]).map(
    (row) => row.caseId,
  );
  expect(sorted).toEqual(["conflict-low", "healthy-high", "healthy-medium"]);
});

test("matchesQueueFilter maps each tab to its own predicate", () => {
  const mine = item({ caseId: "mine", assignee: "我" });
  const theirs = item({ caseId: "theirs", assignee: "张三" });
  const overdue = item({ caseId: "overdue", dueAt: new Date(NOW - 60_000).toISOString() });
  const conflicted = item({ caseId: "conflicted", evidenceConflict: true });

  expect(matchesQueueFilter(mine, "MINE", "我", NOW)).toBe(true);
  expect(matchesQueueFilter(theirs, "MINE", "我", NOW)).toBe(false);
  // 已转交 is what left this operator's desk, not everything assigned.
  expect(matchesQueueFilter(theirs, "ASSIGNED", "我", NOW)).toBe(true);
  expect(matchesQueueFilter(mine, "ASSIGNED", "我", NOW)).toBe(false);
  expect(matchesQueueFilter(overdue, "OVERDUE", "我", NOW)).toBe(true);
  expect(matchesQueueFilter(conflicted, "EVIDENCE", "我", NOW)).toBe(true);
  expect(matchesQueueFilter(theirs, "ALL", "我", NOW)).toBe(true);
});

test("filterReviewQueue narrows by tab and search and keeps what survives", () => {
  const rows = [
    item({ caseId: "a", contractTitle: "设备采购合同", assignee: "我" }),
    item({ caseId: "b", contractTitle: "技术服务协议", assignee: "张三" }),
    item({ caseId: "c", contractTitle: "框架采购合同" }),
  ];

  // A no-match search leaves the filter in force; the caller keeps its controls.
  expect(
    filterReviewQueue(rows, { filter: "MINE", operator: "我", search: "不存在" }, NOW),
  ).toEqual([]);
  expect(
    filterReviewQueue(rows, { filter: "ALL", operator: "我", search: "服务" }, NOW).map(
      (row) => row.caseId,
    ),
  ).toEqual(["b"]);
  expect(
    filterReviewQueue(rows, { filter: "MINE", operator: "我", search: "" }, NOW).map(
      (row) => row.caseId,
    ),
  ).toEqual(["a"]);
});

test("priority and severity labels and tones cover every value", () => {
  for (const priority of ["high", "normal", "low"] as const) {
    expect(priorityLabels[priority]).toBeTruthy();
    expect(priorityTones[priority]).toBeTruthy();
  }
  for (const severity of ["LOW", "MEDIUM", "HIGH"] as const) {
    expect(reviewSeverityLabels[severity]).toBeTruthy();
    expect(reviewSeverityTones[severity]).toBeTruthy();
  }
});
