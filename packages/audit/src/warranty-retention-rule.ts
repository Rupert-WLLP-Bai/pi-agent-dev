import { clauseEvidence, extractDuration, findClause, numberParam } from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment, RuleParamSet } from "./model";
import { buildRatioLimitFacts } from "./ratio-limit-rule";

export const WARRANTY_RETENTION_RULE_CODE = "WARRANTY_RETENTION_RATIO_LIMIT" as const;

/** 《建设工程质量保证金管理办法》（建质〔2017〕138 号）第七条。 */
export const DEFAULT_WARRANTY_RETENTION_MAX_RATIO = 0.03;
export const DEFAULT_DEFECT_LIABILITY_PERIOD_MAX_MONTHS = 24;

const EVIDENCE_ID = "contract-warranty-retention";
const PERIOD_EVIDENCE_ID = "contract-defect-period";
const KEYWORD = /质量保证金|质保金|质量保修金|工程质量保证金/u;
const DENOMINATOR = /工程价款结算总额|结算总额|工程价款|合同金额|合同总价/u;
const PERIOD_KEYWORD = /缺陷责任期|质量保证期|保修期|质保期/u;

export interface WarrantyRetentionFacts {
  /** Whether the contract reserves a quality retention sum. */
  hasRetentionClause: boolean;
  /** Retention ratio as a 0–1 fraction; null when no usable number was found. */
  ratio: number | null;
  denominatorMissing: boolean;
  /** 缺陷责任期 in months; null when the contract states none. */
  defectPeriodMonths: number | null;
  label: string;
}

export interface WarrantyRetentionAnalysis {
  facts: WarrantyRetentionFacts;
  evidence: EvidenceLocator[];
}

export function buildWarrantyRetentionFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): WarrantyRetentionAnalysis {
  const bond = buildRatioLimitFacts({
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    keyword: KEYWORD,
    denominator: DENOMINATOR,
    evidenceId: EVIDENCE_ID,
    label: "质量保证金",
  });

  const periodHit = findClause(input.document, PERIOD_KEYWORD);
  const duration = periodHit === null ? null : extractDuration(periodHit.window);
  const defectPeriodMonths =
    duration === null
      ? null
      : duration.months > 0
        ? Math.round(duration.months)
        : Math.round(duration.days / 30);

  return {
    facts: {
      hasRetentionClause: bond.facts.hasClause,
      ratio: bond.facts.ratio,
      denominatorMissing: bond.facts.denominatorMissing,
      defectPeriodMonths,
      label: "质量保证金",
    },
    evidence: [
      ...bond.evidence,
      ...(periodHit === null
        ? []
        : [
            clauseEvidence({
              id: PERIOD_EVIDENCE_ID,
              sourceRecordId: input.sourceRecordId,
              document: input.document,
              hit: periodHit,
            }),
          ]),
    ],
  };
}

export function evaluateWarrantyRetentionRule(
  facts: WarrantyRetentionFacts,
  params?: RuleParamSet,
): RuleAssessment {
  const maxRatio = numberParam(params, "maxRatio", DEFAULT_WARRANTY_RETENTION_MAX_RATIO);
  const maxMonths = numberParam(
    params,
    "defectLiabilityPeriodMaxMonths",
    DEFAULT_DEFECT_LIABILITY_PERIOD_MAX_MONTHS,
  );
  const limitPercent = Math.round(maxRatio * 100);
  const periodExceeded =
    facts.defectPeriodMonths !== null && facts.defectPeriodMonths > maxMonths;
  const ratioExceeded = facts.ratio !== null && facts.ratio > maxRatio;

  if (!facts.hasRetentionClause && !periodExceeded) {
    return {
      id: "assessment-warranty-retention",
      ruleCode: WARRANTY_RETENTION_RULE_CODE,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: `合同未预留质量保证金，且缺陷责任期未超过 ${maxMonths} 个月，不涉及 ${limitPercent}% 上限。`,
    };
  }

  if (ratioExceeded) {
    return {
      id: "assessment-warranty-retention",
      ruleCode: WARRANTY_RETENTION_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [EVIDENCE_ID],
      basis: `质量保证金预留比例 ${Math.round((facts.ratio ?? 0) * 100)}% 高于法定上限 ${limitPercent}%。`,
    };
  }

  if (periodExceeded) {
    return {
      id: "assessment-warranty-retention",
      ruleCode: WARRANTY_RETENTION_RULE_CODE,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [PERIOD_EVIDENCE_ID],
      basis: `缺陷责任期 ${facts.defectPeriodMonths} 个月超过法定最长 ${maxMonths} 个月。`,
    };
  }

  if (facts.ratio === null) {
    return {
      id: "assessment-warranty-retention",
      ruleCode: WARRANTY_RETENTION_RULE_CODE,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [EVIDENCE_ID],
      basis: facts.denominatorMissing
        ? "检出质量保证金金额，但合同未载明工程价款结算总额等计算基数，无法确定比例，需人工确认。"
        : "检出质量保证金条款，但未能提取预留比例或金额，需人工确认。",
    };
  }

  return {
    id: "assessment-warranty-retention",
    ruleCode: WARRANTY_RETENTION_RULE_CODE,
    disposition: "COMPLIANT",
    evidenceIds: [EVIDENCE_ID],
    basis: `质量保证金预留比例 ${Math.round(facts.ratio * 100)}% 未超过法定上限 ${limitPercent}%。`,
  };
}
