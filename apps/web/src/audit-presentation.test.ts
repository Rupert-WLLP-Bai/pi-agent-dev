import { expect, test } from "bun:test";
import type { AuditCase } from "@contract-audit/audit/model";
import {
  deriveQueueStats,
  filterAndSortCases,
  getAuditDisplayState,
  getAvailableCaseActions,
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
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt,
});

test("awaiting review wins over the completed machine status", () => {
  const auditCase = caseAt("review", "COMPLETED", "AWAITING_REVIEW", "2026-09-11T09:00:00.000Z");
  expect(getAuditDisplayState(auditCase)).toMatchObject({ key: "AWAITING_REVIEW", label: "待复核" });
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
