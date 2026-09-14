import type { FindingType, RuleCode, Severity } from "./model";

/** One accepted chain-head finding on a Contract Revision, keyed by Rule Code. */
export interface RevisionFindingPin {
  ruleCode: RuleCode;
  findingType: FindingType;
  severity: Severity;
}

export interface RevisionFindingDiff {
  introduced: RevisionFindingPin[];
  resolved: RevisionFindingPin[];
  persisting: RevisionFindingPin[];
}

/**
 * Compares findings between two adjacent Contract Revisions by Rule Code.
 * Only pins listed in `prior` / `next` participate — callers supply accepted
 * findings or the full chain-head set they want compared.
 */
export function diffAdjacentRevisionFindings(
  prior: RevisionFindingPin[],
  next: RevisionFindingPin[],
): RevisionFindingDiff {
  const priorByCode = new Map(prior.map((item) => [item.ruleCode, item]));
  const nextByCode = new Map(next.map((item) => [item.ruleCode, item]));

  const introduced: RevisionFindingPin[] = [];
  const resolved: RevisionFindingPin[] = [];
  const persisting: RevisionFindingPin[] = [];

  for (const [code, pin] of nextByCode) {
    if (!priorByCode.has(code)) introduced.push(pin);
    else persisting.push(pin);
  }
  for (const [code, pin] of priorByCode) {
    if (!nextByCode.has(code)) resolved.push(pin);
  }

  return { introduced, resolved, persisting };
}
