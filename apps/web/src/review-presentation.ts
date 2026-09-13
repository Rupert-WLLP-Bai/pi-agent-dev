import type { ReviewQueueItem } from "@contract-audit/api";
import type { Severity } from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import { type AuditTone, severityLabels } from "./audit-presentation";

/** Queue filters are framed around the reviewer's work rhythm, not case fields. */
export type ReviewQueueFilter = "ALL" | "MINE" | "OVERDUE" | "EVIDENCE" | "ASSIGNED";

export const queueFilterOptions: ReadonlyArray<{ value: ReviewQueueFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "MINE", label: "待我处理" },
  { value: "OVERDUE", label: "临近超时" },
  { value: "EVIDENCE", label: "证据不足" },
  { value: "ASSIGNED", label: "已转交" },
];

export const priorityLabels: Record<ReviewPriority, string> = {
  high: "高优先级",
  normal: "中优先级",
  low: "低优先级",
};

export const priorityTones: Record<ReviewPriority, AuditTone> = {
  high: "danger",
  normal: "info",
  low: "neutral",
};

export const reviewSeverityLabels: Record<Severity, string> = severityLabels;

export const reviewSeverityTones: Record<Severity, AuditTone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
};

const severityRank: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Milliseconds until the item's SLA deadline; negative once it is past. */
export function remainingMs(item: ReviewQueueItem, now: number = Date.now()): number {
  return Date.parse(item.dueAt) - now;
}

export function isOverdue(item: ReviewQueueItem, now: number = Date.now()): boolean {
  return remainingMs(item, now) < 0;
}

export interface RemainingTime {
  label: string;
  overdue: boolean;
}

const durationBucket = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不足 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
};

/** Human-readable SLA countdown. Overdue is explicit, never implied by color. */
export function formatRemaining(ms: number): RemainingTime {
  if (ms < 0) return { label: `已逾期 ${durationBucket(-ms)}`, overdue: true };
  return { label: `剩余 ${durationBucket(ms)}`, overdue: false };
}

/**
 * Queue order: evidence conflicts first (a human must intervene), then the
 * worst severity, then the soonest deadline. Matches the server's ordering so a
 * client re-sort cannot disagree with the API.
 */
export function sortReviewQueue(items: readonly ReviewQueueItem[]): ReviewQueueItem[] {
  return [...items].sort((left, right) => {
    if (left.evidenceConflict !== right.evidenceConflict) return left.evidenceConflict ? -1 : 1;
    const leftRank = left.severity === null ? 0 : severityRank[left.severity];
    const rightRank = right.severity === null ? 0 : severityRank[right.severity];
    if (leftRank !== rightRank) return rightRank - leftRank;
    return Date.parse(left.dueAt) - Date.parse(right.dueAt);
  });
}

/**
 * `MINE` is the operator's own work; `ASSIGNED` is everything handed to someone
 * else, because a reviewer checking "已转交" is looking at what left their desk.
 */
export function matchesQueueFilter(
  item: ReviewQueueItem,
  filter: ReviewQueueFilter,
  operator: string,
  now: number = Date.now(),
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "MINE":
      return item.assignee === operator;
    case "OVERDUE":
      return isOverdue(item, now);
    case "EVIDENCE":
      return item.evidenceConflict;
    case "ASSIGNED":
      return item.assignee !== null && item.assignee !== operator;
  }
}

export function filterReviewQueue(
  items: readonly ReviewQueueItem[],
  options: { filter: ReviewQueueFilter; operator: string; search: string },
  now: number = Date.now(),
): ReviewQueueItem[] {
  const search = options.search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (!matchesQueueFilter(item, options.filter, options.operator, now)) return false;
    if (!search) return true;
    const haystack = [item.contractTitle, item.title, item.findingType, item.caseId, item.assignee]
      .filter((part): part is string => part !== null)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(search);
  });
}
