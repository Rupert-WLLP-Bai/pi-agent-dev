import type {
  ValidationCaseListItem,
  ValidationDiffEntry,
  ValidationRunListItem,
  ValidationRunRecord,
} from "@contract-audit/api";
import { formatRuleTime } from "./rule-presentation";

/**
 * Presentation helpers for 案例验证: the Chinese vocabulary for the five case
 * shapes, the per-case result chips, and the regression-diff labels. Anything
 * derived (card totals, movement filtering) lives here so the component stays a
 * rendering shell and the rules stay testable.
 */

export type ValidationCaseType = ValidationCaseListItem["caseType"];
export type ValidationOutcome = NonNullable<ValidationCaseListItem["latest"]>["outcome"];
export type ValidationCaseResult = ValidationRunRecord["details"][number];

export const validationCaseTypeLabels: Record<ValidationCaseType, string> = {
  positive: "正例",
  negative: "反例",
  boundary: "边界例",
  false_positive: "历史误报",
  missing_evidence: "证据缺失",
};

/** Fixed order so cards and filters never reshuffle between runs. */
export const validationCaseTypeOrder: ValidationCaseType[] = [
  "positive",
  "negative",
  "boundary",
  "false_positive",
  "missing_evidence",
];

export const validationCaseTypeTagColors: Record<ValidationCaseType, string> = {
  positive: "error",
  negative: "success",
  boundary: "warning",
  false_positive: "default",
  missing_evidence: "warning",
};

export const validationOutcomeLabels: Record<ValidationOutcome, string> = {
  pass: "通过",
  fail: "失败",
  needs_review: "待复核",
};

export const validationOutcomeTagColors: Record<ValidationOutcome, string> = {
  pass: "success",
  fail: "error",
  needs_review: "warning",
};

/**
 * What one case's result counts as, mirroring the server's classification: a
 * run that deferred to a human is neither a pass nor a fail.
 */
export function caseResultOutcome(
  result: Pick<ValidationCaseResult, "actual" | "passed">,
): ValidationOutcome {
  if (result.actual === "NEEDS_HUMAN_REVIEW") return "needs_review";
  return result.passed ? "pass" : "fail";
}

export type ValidationChange = ValidationDiffEntry["change"];

export const validationChangeLabels: Record<ValidationChange, string> = {
  regression: "新增回归",
  fixed: "已修复",
  unchanged: "未变化",
  new: "新增",
};

export const validationChangeTagColors: Record<ValidationChange, string> = {
  regression: "error",
  fixed: "success",
  unchanged: "default",
  new: "processing",
};

/** Only real movement between runs is worth listing; unchanged/noise is not. */
export function movementDiffEntries(diff: readonly ValidationDiffEntry[]): ValidationDiffEntry[] {
  return diff.filter((entry) => entry.change === "regression" || entry.change === "fixed");
}

export interface ValidationCaseCardChip {
  text: string;
  tone: "success" | "error" | "warning" | "default";
}

export interface ValidationCaseCard {
  key: string;
  label: string;
  total: number;
  passed: number;
  failed: number;
  needsReview: number;
  chips: ValidationCaseCardChip[];
}

/**
 * The four summary cards. A group with no recorded result yet shows its raw
 * count; once a run exists the chips read as outcomes, with deferrals reported
 * separately so a "证据缺失" case is never mistaken for a pass or a failure.
 */
export function summarizeCaseCards(cases: readonly ValidationCaseListItem[]): ValidationCaseCard[] {
  const groups: Array<{ key: string; label: string; types: ValidationCaseType[] }> = [
    { key: "positive", label: "正例", types: ["positive"] },
    { key: "negative", label: "反例", types: ["negative"] },
    { key: "boundary", label: "边界例", types: ["boundary"] },
    {
      key: "false_positive",
      label: "历史误报 / 证据缺失",
      types: ["false_positive", "missing_evidence"],
    },
  ];

  return groups.map((group) => {
    const rows = cases.filter((item) => group.types.includes(item.caseType));
    const results = rows.flatMap((item) => (item.latest ? [item.latest.outcome] : []));
    const passed = results.filter((outcome) => outcome === "pass").length;
    const failed = results.filter((outcome) => outcome === "fail").length;
    const needsReview = results.filter((outcome) => outcome === "needs_review").length;

    const chips: ValidationCaseCardChip[] = [];
    if (results.length === 0) {
      chips.push({ text: `共 ${rows.length} 例`, tone: "default" });
    } else {
      if (failed > 0) chips.push({ text: `${failed} / ${rows.length} 失败`, tone: "error" });
      if (needsReview > 0) chips.push({ text: `复现 ${needsReview}`, tone: "warning" });
      if (failed === 0 && needsReview === 0) {
        chips.push({ text: `${passed} / ${rows.length} 通过`, tone: "success" });
      }
    }

    return {
      key: group.key,
      label: group.label,
      total: rows.length,
      passed,
      failed,
      needsReview,
      chips,
    };
  });
}

/** 规则 · 版本 · 最近运行时间 · 触发人, the line under the header. */
export function describeRunMeta(run: ValidationRunListItem | null): string {
  if (!run) return "尚未运行验证";
  const time = formatRuleTime(run.finishedAt) ?? "—";
  return `${run.ruleName} · v${run.ruleVersion} · 最近运行 ${time} · 触发人 ${run.triggeredBy}`;
}
