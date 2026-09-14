import type { Severity } from "@contract-audit/audit/model";
import type { ReviewQueueItem } from "./types";

/**
 * Derives a display title from a contract document's first block.
 *
 * Evaluation fixtures frequently start with a clause rather than a heading, so
 * the first block is only accepted when it reads like a title: short and not a
 * finished sentence. Callers fall back to an explicit "unnamed" label so a
 * clause is never presented as the contract's name.
 */
export function contractTitleFromFirstBlock(firstBlock: string | null | undefined): string | null {
  if (firstBlock === null || firstBlock === undefined) return null;
  const candidate = firstBlock.trim();
  if (candidate.length === 0 || candidate.length > 40) return null;
  if (/[。；;！!？?]$/.test(candidate)) return null;
  return candidate;
}

const severityOrder: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Queue order: evidence conflicts first (a human must intervene), then the
 * worst severity, then the soonest deadline. Shared with the web client's own
 * sort so the server's order and a re-sort converge on the same list.
 */
export function compareReviewQueueItems(left: ReviewQueueItem, right: ReviewQueueItem): number {
  if (left.evidenceConflict !== right.evidenceConflict) return left.evidenceConflict ? -1 : 1;
  const leftRank = left.severity === null ? 0 : severityOrder[left.severity];
  const rightRank = right.severity === null ? 0 : severityOrder[right.severity];
  if (leftRank !== rightRank) return rightRank - leftRank;
  return Date.parse(left.dueAt) - Date.parse(right.dueAt);
}
