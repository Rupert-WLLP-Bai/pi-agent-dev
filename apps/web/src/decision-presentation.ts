import type {
  DecisionAdvice,
  DecisionConfidenceType,
  DecisionFeedbackChoice,
  DecisionMode,
  DecisionProviderName,
  DecisionStatus,
  DecisionTaskType,
} from "@contract-audit/audit/decision";

/**
 * Presentation rules for 辅助决策（影子建议）.
 *
 * The invariants this module exists to enforce:
 * - A shadow advice is never a formal risk: no label may read as a confirmed
 *   finding, a rule assessment or a human review outcome.
 * - Confidence is never accuracy. `confidence` is a concentration or an
 *   answer self-score whose meaning depends on `confidenceType`; an
 *   uncalibrated advice reports "未经校准" rather than a percentage.
 * - Missing values stay missing. Nothing invents 0%, a fake distribution or a
 *   fallback reason for an advice that never failed.
 */

/** Every shadow surface carries this wording; the contract makes it mandatory. */
export const SHADOW_DISCLAIMER = "影子建议仅用于评估，不改变审计结论";

export const shadowDisclaimerHint =
  "影子建议来自辅助模型通道，与 19 条确定性规则、人工复核相互独立；它不能确认风险，也不能判定误报。";

/** Status labels, keyed by the canonical enum. An unmapped value falls back. */
export const decisionStatusLabels: Record<DecisionStatus, string> = {
  PENDING: "等待执行",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  SKIPPED: "已跳过",
};

/** Which advice states are still in flight (no answer exists yet). */
export const DECISION_IN_FLIGHT_STATUSES: Record<string, true> = {
  PENDING: true,
  RUNNING: true,
};

export const decisionTaskTypeLabels: Record<DecisionTaskType, string> = {
  clause_category: "条款分类",
  review_routing: "复核分流",
  clause_score: "条款评分",
};

/** Provider display names. `disabled` is a configuration state, not a provider. */
export const decisionProviderLabels: Record<DecisionProviderName, string> = {
  disabled: "未启用",
  fake: "离线演示（Fake）",
  "laya-cpu": "本地 Laya CPU",
};

/** How a provider's identity reads on a detail view. */
export function describeDecisionProvider(advice: DecisionAdvice): string {
  return `${decisionProviderLabels[advice.provider]} · 模型版本 ${advice.modelVersion}`;
}

export const decisionModeLabels: Record<DecisionMode, string> = {
  off: "已关闭",
  shadow: "影子模式",
};

export const decisionConfidenceTypeLabels: Record<DecisionConfidenceType, string> = {
  laya_entropy_concentration: "Laya 熵集中度",
  answer_confidence: "答案自评分",
  none: "无置信度",
};

export const decisionFeedbackLabels: Record<DecisionFeedbackChoice, string> = {
  accepted: "有帮助",
  rejected: "无帮助",
  needs_review: "需人工再看",
};

export interface DecisionAnswerView {
  /** The answer as text; null when the advice never produced one. */
  text: string | null;
  /** What the number means, so a score is not read as a probability. */
  kind: "choice" | "score" | "noul" | null;
}

/** Renders a typed answer, or null when the advice carries none. */
export function describeDecisionAnswer(advice: DecisionAdvice): DecisionAnswerView {
  const answer = advice.answer;
  if (answer === null) return { text: null, kind: null };
  if (answer.type === "choice") return { text: answer.choice, kind: "choice" };
  if (answer.type === "score") return { text: String(answer.score), kind: "score" };
  return { text: String(answer.noul), kind: "noul" };
}

/** Raw distribution as ordered pairs; an absent one stays empty, never zeroed. */
export function describeRawProbabilities(
  probabilities: Record<string, number> | null,
): Array<{ key: string; value: number }> {
  if (probabilities === null) return [];
  return Object.entries(probabilities).map(([key, value]) => ({ key, value }));
}

export interface DecisionConfidenceView {
  /** What to show in the confidence slot. Never a bare percentage. */
  label: string;
  /** Why this label was chosen; shown beside it, not hidden in a tooltip. */
  detail: string;
  tone: "neutral" | "warning" | "info";
  /** True only when a calibrated threshold actually applies. */
  hasThreshold: boolean;
}

/**
 * Confidence, described in terms of what it is rather than what it is not.
 *
 * The contract forbids presenting concentration or an answer score as accuracy,
 * so the label always names the metric, and a threshold is shown only when the
 * advice is calibrated with a threshold policy version.
 */
export function describeDecisionConfidence(advice: DecisionAdvice): DecisionConfidenceView {
  const type = decisionConfidenceTypeLabels[advice.confidenceType];
  if (advice.uncertainty === "calibrated" && advice.calibrated) {
    const threshold =
      advice.threshold === null
        ? null
        : `阈值 ${advice.threshold}（策略版本 ${advice.thresholdPolicyVersion ?? "未提供"}）`;
    return {
      label: threshold ?? `已校准 · ${type}`,
      detail:
        threshold === null
          ? `已校准（校准版本 ${advice.calibrationVersion ?? "未提供"}）；${type}不是正确率。`
          : `${type}不是正确率；阈值来自策略版本 ${advice.thresholdPolicyVersion ?? "未提供"}。`,
      tone: "info",
      hasThreshold: advice.threshold !== null,
    };
  }
  if (advice.uncertainty === "unavailable") {
    return {
      label: "置信度不可用",
      detail: `该次执行未产生可解释的置信度（${type}），不作为质量依据。`,
      tone: "neutral",
      hasThreshold: false,
    };
  }
  return {
    label: "未经校准",
    detail: `${type}尚未经校准验证，不能作为准确率或通过率使用。`,
    tone: "warning",
    hasThreshold: false,
  };
}

export interface DecisionUncertaintyView {
  label: string;
  detail: string;
  tone: "neutral" | "warning" | "info";
}

/** The uncalibrated/unavailable/calibrated state, stated separately from confidence. */
export function describeDecisionUncertainty(advice: DecisionAdvice): DecisionUncertaintyView {
  if (advice.uncertainty === "calibrated") {
    return {
      label: "已校准",
      detail:
        advice.calibrationVersion === null
          ? "已标记为已校准，但未提供校准版本。"
          : `校准版本 ${advice.calibrationVersion}。`,
      tone: "info",
    };
  }
  if (advice.uncertainty === "unavailable") {
    return {
      label: "校准信息不可用",
      detail: "本次执行没有可用于判断可靠性的校准信息。",
      tone: "neutral",
    };
  }
  return {
    label: "未经校准",
    detail: "未经过校准验证，只能作为辅助参考，不能作为准确率。",
    tone: "warning",
  };
}

/** Stable codes the shadow pipeline reports; each maps to a Chinese reason. */
const decisionFallbackReasons: Record<string, string> = {
  disabled: "影子模式未启用或未配置提供方。",
  provider_timeout: "辅助提供方响应超时。",
  provider_unavailable: "辅助提供方当前不可用。",
  invalid_request: "构造的辅助请求不合法，未调用提供方。",
  invalid_response: "辅助提供方返回内容不符合契约，未采用。",
  unsupported_schema: "辅助数据版本不受支持，未采用。",
  forbidden_outbound: "出网策略拒绝了该辅助调用。",
  aborted: "该次辅助执行被取消。",
  DECISION_MODE_OFF: "影子模式已关闭，未生成建议。",
  PROVIDER_DISABLED: "未配置辅助提供方，未生成建议。",
  SNAPSHOT_IDENTITY_MISSING: "缺少快照或运行身份，未派生建议。",
  RUN_NOT_SUCCESSFUL: "仅对已成功完成的运行派生建议。",
};

/**
 * The failure reason as an operator reads it. An unrecognised code is shown
 * verbatim beside the raw code rather than replaced by a generic sentence:
 * a reason we cannot explain is still better than a reason we invent.
 */
export function describeDecisionFallbackReason(reason: string | null): string | null {
  if (reason === null) return null;
  return decisionFallbackReasons[reason] ?? reason;
}

/** Data classification as the DTO states it; never widened into a privacy claim. */
export const decisionDataClassificationLabels: Record<string, string> = {
  SYNTHETIC: "合成数据",
  MASKED: "脱敏片段",
  INTERNAL: "内部数据",
};

/**
 * Whether an advice shows a 规则冲突 entry. Conflicts are only reported for
 * the same proposition, so each entry is a comparable disagreement rather than
 * a general "模型不同意".
 */
export function describeDecisionConflicts(
  advice: DecisionAdvice,
  ruleLabel: (code: string) => string,
): Array<{ key: string; headline: string; detail: string }> {
  return advice.ruleConflicts.map((conflict) => ({
    key: `${conflict.assessmentId}-${conflict.conflictType}`,
    headline: `${ruleLabel(conflict.ruleCode)} · 与规则判断不一致`,
    detail: `规则基准答案 ${formatConflictAnswer(conflict.baselineAnswer)}；影子答案 ${formatConflictAnswer(conflict.shadowAnswer)}。`,
  }));
}

function formatConflictAnswer(
  answer: {
    type: "choice" | "score" | "noul";
  } & Record<string, unknown>,
): string {
  if (answer.type === "choice" && typeof answer.choice === "string") return answer.choice;
  if (answer.type === "score" && typeof answer.score === "number") return String(answer.score);
  if (answer.type === "noul" && typeof answer.noul === "number") return String(answer.noul);
  return "未提供";
}

/** Evidence anchors, or an explicit "none" rather than an empty list. */
export function describeDecisionEvidence(advice: DecisionAdvice): {
  count: number;
  blocks: Array<{ key: string; text: string }>;
} {
  return {
    count: advice.evidenceRefs.length,
    blocks: advice.evidenceRefs.map((reference) => ({
      key: reference.evidenceId,
      text:
        reference.startOffset === null || reference.endOffset === null
          ? `${reference.evidenceId} · 区块 ${reference.blockId ?? "未提供"}`
          : `${reference.evidenceId} · 区块 ${reference.blockId ?? "未提供"} · 偏移 ${reference.startOffset}–${reference.endOffset}`,
    })),
  };
}

/**
 * Feedback eligibility. Feedback is independent of the formal review chain, so
 * a terminal advice can be rated however the audit itself is going; an advice
 * that never produced a result has nothing to rate.
 */
export function canSubmitDecisionFeedback(advice: DecisionAdvice): boolean {
  return advice.status === "SUCCEEDED" || advice.status === "FAILED" || advice.status === "SKIPPED";
}

/** A case with no advice at all, stated with the reason the list carries. */
export function describeDecisionListState(list: {
  mode: "off" | "shadow";
  provider: DecisionProviderName;
  items: unknown[];
}): { empty: boolean; reason: string } {
  if (list.mode === "off" && list.provider === "disabled") {
    return { empty: true, reason: "影子模式未开启，暂无辅助建议。" };
  }
  if (list.items.length === 0) {
    return { empty: true, reason: "该案件暂无影子建议记录。" };
  }
  return { empty: false, reason: "" };
}
