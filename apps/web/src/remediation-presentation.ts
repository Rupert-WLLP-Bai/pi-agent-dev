import type { RemediationCard } from "@contract-audit/api";
import type { RemediationStatus, Severity } from "@contract-audit/audit/model";
import { nextRemediationStatus } from "@contract-audit/audit/remediation";
import { type AuditTone, severityLabels } from "./audit-presentation";

/**
 * Board vocabulary and read-time derivations for 整改跟踪. The lifecycle order
 * itself lives in the domain package so the board and the API share one state
 * machine; this module only turns it into words, tones, and the counts a column
 * header needs.
 */
export const remediationStatusLabels: Record<RemediationStatus, string> = {
  pending: "待整改",
  in_progress: "整改中",
  awaiting_review: "待复核",
  closed: "已关闭",
};

export const remediationStatusTones: Record<RemediationStatus, AuditTone> = {
  pending: "warning",
  in_progress: "info",
  awaiting_review: "info",
  closed: "success",
};

/** A one-word stage note under each column title, so meaning is never colour-only. */
export const remediationColumnFlags: Record<RemediationStatus, string> = {
  pending: "待处理",
  in_progress: "进行中",
  awaiting_review: "等待复核人确认",
  closed: "已归档",
};

export const remediationSeverityLabels: Record<Severity, string> = severityLabels;

export const remediationSeverityTones: Record<Severity, AuditTone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
};

/**
 * The advance affordance. Derived from the shared state machine so the board
 * cannot offer a move the API would reject, and `null` marks the two stages
 * that cannot advance — the waiting-to-close and terminal stages.
 */
export function describeAdvance(status: RemediationStatus): {
  next: RemediationStatus | null;
  label: string;
} {
  const next = nextRemediationStatus(status);
  if (next === null) {
    return { next: null, label: status === "closed" ? "已关闭" : "等待复核关闭" };
  }
  return { next, label: `推进至${remediationStatusLabels[next]}` };
}

/**
 * Overdue is recomputed on render from the deadline, because a card's clock
 * keeps running while the page is open. A closed item is never overdue: the
 * missed deadline is history by then, not a live escalation.
 */
export function isRemediationOverdue(
  card: Pick<RemediationCard, "dueAt">,
  status: RemediationStatus,
  now: number = Date.now(),
): boolean {
  return status !== "closed" && card.dueAt !== null && Date.parse(card.dueAt) < now;
}

export interface RemediationDue {
  label: string;
  overdue: boolean;
}

const dueDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });

/** Card due line: states the fact, and spells out "已逾期" rather than relying on red. */
export function formatRemediationDue(
  card: Pick<RemediationCard, "dueAt">,
  status: RemediationStatus,
  now: number = Date.now(),
): RemediationDue {
  if (card.dueAt === null) return { label: "未设定截止", overdue: false };
  const overdue = isRemediationOverdue(card, status, now);
  return {
    label: overdue ? `已逾期 · 截止 ${dueDate(card.dueAt)}` : `截止 ${dueDate(card.dueAt)}`,
    overdue,
  };
}

const SUMMARY_MAX = 40;

/**
 * Card summary: one scannable line. Whitespace is collapsed and the tail is
 * elided, because the summary is stored from the finding title and a policy
 * sentence can run long; the full text stays available in the drawer.
 */
export function formatRemediationSummary(summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim();
  return clean.length > SUMMARY_MAX ? `${clean.slice(0, SUMMARY_MAX)}…` : clean;
}
