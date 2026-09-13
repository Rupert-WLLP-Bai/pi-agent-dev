import type {
  RuleDetail,
  RuleListItem,
  RuleVersionRecord,
  ValidationRunRecord,
} from "@contract-audit/api";

/**
 * Presentation helpers for rule governance: the Chinese vocabulary the UI
 * uses, and the derived states — validation totals, the publish gate — that
 * must not be recomputed ad hoc in components.
 */

export type RuleVersionStatus = RuleVersionRecord["status"];
export type ValidationRunStatus = ValidationRunRecord["status"];
export type ValidationSummary = ValidationRunRecord["summary"];
export type ValidationCaseResult = ValidationRunRecord["details"][number];
export type GoldenCaseType = ValidationCaseResult["caseType"];

/** A flat rule parameter set: the values a rule version declares. */
export type RuleParamValue = string | number | boolean;
export type RuleParams = Record<string, RuleParamValue>;

export const ruleVersionStatusLabels: Record<RuleVersionStatus, string> = {
  published: "已发布",
  draft: "草稿",
  retired: "已退役",
};

/** Ant Design v6 Tag status presets. */
export const ruleVersionStatusTagColors: Record<RuleVersionStatus, string> = {
  published: "success",
  draft: "warning",
  retired: "default",
};

/** The rule's runtime toggle, distinct from a version's lifecycle status. */
export const ruleRuntimeLabels: { enabled: string; disabled: string } = {
  enabled: "运行中",
  disabled: "已停用",
};

export const validationRunStatusLabels: Record<ValidationRunStatus, string> = {
  passed: "通过",
  failed: "未通过",
};

export const validationRunStatusTagColors: Record<ValidationRunStatus, string> = {
  passed: "success",
  failed: "error",
};

export const goldenCaseTypeLabels: Record<GoldenCaseType, string> = {
  POSITIVE: "正例",
  NEGATIVE: "反例",
  BOUNDARY: "边界例",
};

/** Fixed display order so the chips do not reshuffle between runs. */
export const goldenCaseTypeOrder: GoldenCaseType[] = ["POSITIVE", "NEGATIVE", "BOUNDARY"];

export interface ValidationSummaryChip {
  key: GoldenCaseType;
  label: string;
  total: number;
  passed: number;
  failed: number;
  tone: "success" | "error";
}

/** Per-case-type chips: a type with any failure reads as an error, not a rate. */
export function summarizeValidation(summary: ValidationSummary | null): ValidationSummaryChip[] {
  if (!summary) return [];
  return goldenCaseTypeOrder.map((key) => {
    const bucket = summary.byCaseType[key];
    return {
      key,
      label: goldenCaseTypeLabels[key],
      total: bucket.total,
      passed: bucket.passed,
      failed: bucket.failed,
      tone: bucket.failed > 0 ? "error" : "success",
    };
  });
}

/** The cases that failed, for the failures list under the summary chips. */
export function failedValidationCases(run: ValidationRunRecord | null): ValidationCaseResult[] {
  return (run?.details ?? []).filter((detail) => !detail.passed);
}

export function validationOutcomeText(summary: ValidationSummary): string {
  return summary.failed === 0
    ? `全部通过（共 ${summary.total} 例）`
    : `${summary.failed} 例失败 / 共 ${summary.total} 例`;
}

export interface PublishGate {
  enabled: boolean;
  /** Why publishing is blocked; null when it is allowed. */
  reason: string | null;
}

/**
 * Whether the open draft may be published, and why not. The button renders
 * disabled with this reason rather than letting the click fail.
 */
export function describePublishGate(
  detail: Pick<RuleDetail, "activeDraft" | "draftValidationRun"> & { rule?: { code: string } },
): PublishGate {
  const draft = detail.activeDraft;
  if (!draft) return { enabled: false, reason: "没有待发布的草稿版本" };
  if (!draft.lastValidationRunId) return { enabled: false, reason: "尚未运行验证" };
  const run = detail.draftValidationRun;
  if (run?.status !== "passed") {
    return { enabled: false, reason: `验证未通过：${run?.summary.failed ?? 0} 例失败` };
  }
  // A green run with zero cases means the golden set is empty — there is
  // nothing to validate. SUBJECT_RED_LINE_RISK is exempt: its subject dimension
  // comes from external verification, not contract cases.
  if (run.summary.total === 0 && detail.rule?.code !== "SUBJECT_RED_LINE_RISK") {
    return { enabled: false, reason: "没有可验证的案例，不能发布" };
  }
  return { enabled: true, reason: null };
}

/**
 * The 最近验证 cell: the run's local time plus its outcome word. Eden may
 * revive a wire timestamp into a Date, so both shapes are accepted.
 */
export function describeLastValidation(item: RuleListItem): {
  text: string;
  tone: "success" | "error" | "none";
} {
  const validation = item.lastValidation;
  if (!validation) return { text: "—", tone: "none" };
  const time = formatRuleTime(validation.finishedAt);
  const outcome = validation.status === "passed" ? "通过" : "有回归";
  return {
    text: time ? `${time} ${outcome}` : outcome,
    tone: validation.status === "passed" ? "success" : "error",
  };
}

export function formatRuleTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export interface RuleFilters {
  /** Matches rule name or code, case-insensitively. */
  search: string;
  status: RuleVersionStatus | "ALL";
  contractType: string | "ALL";
}

export const ALL_RULE_STATUSES: Array<RuleVersionStatus | "ALL"> = [
  "ALL",
  "published",
  "draft",
  "retired",
];

export function filterRules(rules: RuleListItem[], filters: RuleFilters): RuleListItem[] {
  const needle = filters.search.trim().toLowerCase();
  return rules.filter((rule) => {
    if (filters.status !== "ALL" && rule.status !== filters.status) return false;
    if (filters.contractType !== "ALL" && rule.contractType !== filters.contractType) return false;
    if (needle.length === 0) return true;
    return rule.name.toLowerCase().includes(needle) || rule.code.toLowerCase().includes(needle);
  });
}

/** Contract-type filter options present in the data, with 全部 first. */
export function contractTypeOptions(rules: RuleListItem[]): { value: string; label: string }[] {
  const types = [...new Set(rules.map((rule) => rule.contractType))].sort();
  return [
    { value: "ALL", label: "全部" },
    ...types.filter((type) => type !== "全部").map((type) => ({ value: type, label: type })),
  ];
}

/** The deterministic input and output a rule declares, so it reads as testable. */
export interface RuleIo {
  input: string;
  output: string;
}

const ruleCodeIo: Record<string, RuleIo> = {
  ADVANCE_PAYMENT_LIMIT: {
    input: "facts.advancePaymentRatio",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  PENALTY_RATIO_LIMIT: {
    input: "facts.penaltyRatio",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  TERMINATION_CLAUSE_PRESENT: {
    input: "facts.hasTerminationClause",
    output: "COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  DISPUTE_JURISDICTION: {
    input: "facts.jurisdiction",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  SUBJECT_RED_LINE_RISK: {
    input: "subjectVerifications[].dimensions",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  PERFORMANCE_BOND_RATIO_LIMIT: {
    input: "facts.performanceBondRatio",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  PAYMENT_TERM_LIMIT: {
    input: "facts.paymentTermDays",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  BACK_TO_BACK_PAYMENT_CLAUSE: {
    input: "facts.backToBackClause",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  DEPOSIT_RATIO_LIMIT: {
    input: "facts.depositRatio",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  WARRANTY_RETENTION_RATIO_LIMIT: {
    input: "facts.warrantyRetentionRatio",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  DISPUTE_RESOLUTION_CONFLICT: {
    input: "facts.disputeResolutionConflict",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  BID_BOND_RATIO_LIMIT: {
    input: "facts.bidBondRatio",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
  IP_OWNERSHIP_MISSING: {
    input: "facts.hasIpClause",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  GUARANTEE_MODE_AMBIGUOUS: {
    input: "facts.hasJointGuarantee",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  CONFIDENTIALITY_PERIOD_MISSING: {
    input: "facts.confidentialityPeriodYears",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  FORCE_MAJEURE_OVERBROAD: {
    input: "facts.forceMajeureBroadeners",
    output: "POLICY_CONFLICT | COMPLIANT",
  },
  LIABILITY_CAP_MISSING: {
    input: "facts.liabilityCap",
    output: "POLICY_CONFLICT | COMPLIANT | NEEDS_HUMAN_REVIEW",
  },
};

export function describeRuleIo(code: string): RuleIo {
  return ruleCodeIo[code] ?? { input: "未声明", output: "未声明" };
}

/** Parses a parameter-editor string back into the value a rule stores. */
export function parseParamValue(input: string): RuleParamValue {
  const trimmed = input.trim();
  if (trimmed.length > 0 && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return input;
}
