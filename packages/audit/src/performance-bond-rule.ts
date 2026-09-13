import { numberParam } from "./clause-numeric";
import type { ContractDocument, RuleAssessment, RuleParamSet } from "./model";
import {
  buildRatioLimitFacts,
  evaluateRatioLimit,
  type RatioClauseAnalysis,
} from "./ratio-limit-rule";

export const PERFORMANCE_BOND_RULE_CODE = "PERFORMANCE_BOND_RATIO_LIMIT" as const;

/** 《招标投标法实施条例》第五十八条 / 《政府采购法实施条例》第四十八条。 */
export const DEFAULT_PERFORMANCE_BOND_MAX_RATIO = 0.1;

const EVIDENCE_ID = "contract-performance-bond";
const KEYWORD = /履约保证金|履约担保|履约保函/u;
const DENOMINATOR = /合同金额|中标合同金额|中标金额|中标价|合同总价|合同价款/u;

export type PerformanceBondAnalysis = RatioClauseAnalysis;

export function buildPerformanceBondFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): PerformanceBondAnalysis {
  return buildRatioLimitFacts({
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    keyword: KEYWORD,
    denominator: DENOMINATOR,
    evidenceId: EVIDENCE_ID,
    label: "履约保证金",
  });
}

export function evaluatePerformanceBondRule(
  facts: PerformanceBondAnalysis["facts"],
  params?: RuleParamSet,
): RuleAssessment {
  return evaluateRatioLimit({
    code: PERFORMANCE_BOND_RULE_CODE,
    assessmentId: "assessment-performance-bond",
    limit: numberParam(params, "maxRatio", DEFAULT_PERFORMANCE_BOND_MAX_RATIO),
    facts,
    evidenceIds: [EVIDENCE_ID],
  });
}
