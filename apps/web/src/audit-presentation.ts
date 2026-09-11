import type { AuditCase, AuditCaseStatus, AuditStage } from "@contract-audit/audit/model";

export type AuditLifecycleFilter =
  | "ALL"
  | "AWAITING_REVIEW"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "ABNORMAL";
export type AuditCaseAction = "VIEW" | "CANCEL" | "RETRY";
export type AuditTone = "neutral" | "info" | "warning" | "danger" | "success";
export type AuditDisplayKey = AuditCaseStatus | "AWAITING_REVIEW";

export interface AuditDisplayState {
  key: AuditDisplayKey;
  label: string;
  tone: AuditTone;
}

export interface AuditQueueStats {
  awaitingReview: number;
  processing: number;
  abnormal: number;
  completedToday: number;
}

const displayStates: Record<AuditDisplayKey, Omit<AuditDisplayState, "key">> = {
  PENDING: { label: "排队中", tone: "info" },
  RUNNING: { label: "审计中", tone: "warning" },
  AWAITING_REVIEW: { label: "待复核", tone: "info" },
  COMPLETED: { label: "已完成", tone: "success" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  INTERRUPTED: { label: "已中断", tone: "warning" },
};

export function getAuditDisplayState(auditCase: AuditCase): AuditDisplayState {
  const key: AuditDisplayKey = auditCase.stage === "AWAITING_REVIEW"
    ? "AWAITING_REVIEW"
    : auditCase.status;
  return { key, ...displayStates[key] };
}

export const getAuditStageLabel = (stage: AuditStage): string => ({
  QUEUED: "等待处理",
  NORMALIZING: "合同规范化",
  RULE_ASSESSMENT: "规则评估",
  AGENT_RUNNING: "Agent 分析",
  AWAITING_REVIEW: "人工复核",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断",
})[stage];

export function getAuditStep(auditCase: AuditCase): number {
  if (auditCase.stage === "COMPLETED") return 4;
  if (auditCase.stage === "AWAITING_REVIEW") return 3;
  if (auditCase.stage === "AGENT_RUNNING") return 2;
  if (auditCase.stage === "RULE_ASSESSMENT" || auditCase.stage === "NORMALIZING") return 1;
  return 0;
}

const retryableStatuses = new Set<AuditCaseStatus>(["FAILED", "CANCELLED", "INTERRUPTED"]);

export function getAvailableCaseActions(auditCase: AuditCase): AuditCaseAction[] {
  if (auditCase.stage === "AWAITING_REVIEW" || auditCase.stage === "COMPLETED") return ["VIEW"];
  if (auditCase.status === "PENDING" || auditCase.status === "RUNNING") return ["VIEW", "CANCEL"];
  if (retryableStatuses.has(auditCase.status)) return ["VIEW", "RETRY"];
  return ["VIEW"];
}

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

export function deriveQueueStats(cases: AuditCase[], now = new Date()): AuditQueueStats {
  return cases.reduce<AuditQueueStats>((stats, auditCase) => {
    const displayKey = getAuditDisplayState(auditCase).key;
    if (displayKey === "AWAITING_REVIEW") stats.awaitingReview += 1;
    if (displayKey === "PENDING" || displayKey === "RUNNING") stats.processing += 1;
    if (displayKey === "FAILED" || displayKey === "INTERRUPTED") stats.abnormal += 1;
    if (
      displayKey === "COMPLETED"
      && sameLocalDay(new Date(auditCase.updatedAt), now)
    ) {
      stats.completedToday += 1;
    }
    return stats;
  }, { awaitingReview: 0, processing: 0, abnormal: 0, completedToday: 0 });
}

const matchesLifecycle = (auditCase: AuditCase, filter: AuditLifecycleFilter): boolean => {
  const displayKey = getAuditDisplayState(auditCase).key;
  switch (filter) {
    case "ALL": return true;
    case "AWAITING_REVIEW": return displayKey === "AWAITING_REVIEW";
    case "PROCESSING": return displayKey === "PENDING" || displayKey === "RUNNING";
    case "COMPLETED": return displayKey === "COMPLETED";
    case "CANCELLED": return displayKey === "CANCELLED";
    case "ABNORMAL": return displayKey === "FAILED" || displayKey === "INTERRUPTED";
  }
};

export function filterAndSortCases(
  cases: AuditCase[],
  filter: AuditLifecycleFilter,
  search: string,
): AuditCase[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return cases
    .filter((auditCase) =>
      matchesLifecycle(auditCase, filter)
      && auditCase.id.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

/** Compact, stable label for an audit ID: full slug when short, 8-char prefix for UUIDs. */
export const shortAuditId = (id: string): string =>
  id.length <= 12 ? id : `${id.slice(0, 8)}…`;
