import { numberParam } from "./clause-numeric";
import type { ContractDocument, RuleAssessment, RuleParamSet } from "./model";
import {
  buildRatioLimitFacts,
  type RatioClauseAnalysis,
  evaluateRatioLimit,
} from "./ratio-limit-rule";

export const DEPOSIT_RULE_CODE = "DEPOSIT_RATIO_LIMIT" as const;

/** 《民法典》第五百八十六条：定金不得超过主合同标的额的 20%。 */
export const DEFAULT_DEPOSIT_MAX_RATIO = 0.2;

const EVIDENCE_ID = "contract-deposit";
/**
 * Only 定金 is regulated by Article 586. 订金 / 预付款 / 押金 name different
 * money and must not match — the keyword is deliberately this narrow.
 */
const KEYWORD = /定金/u;
const DENOMINATOR = /主合同标的额|合同总价|合同金额|标的额|合同价款/u;

export type DepositAnalysis = RatioClauseAnalysis;

export function buildDepositFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): DepositAnalysis {
  return buildRatioLimitFacts({
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    keyword: KEYWORD,
    denominator: DENOMINATOR,
    evidenceId: EVIDENCE_ID,
    label: "定金",
  });
}

export function evaluateDepositRule(
  facts: DepositAnalysis["facts"],
  params?: RuleParamSet,
): RuleAssessment {
  return evaluateRatioLimit({
    code: DEPOSIT_RULE_CODE,
    assessmentId: "assessment-deposit",
    limit: numberParam(params, "maxRatio", DEFAULT_DEPOSIT_MAX_RATIO),
    facts,
    evidenceIds: [EVIDENCE_ID],
  });
}
