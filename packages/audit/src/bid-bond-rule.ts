import { numberParam } from "./clause-numeric";
import type { ContractDocument, RuleAssessment, RuleParamSet } from "./model";
import {
  buildRatioLimitFacts,
  type RatioClauseAnalysis,
  evaluateRatioLimit,
} from "./ratio-limit-rule";

export const BID_BOND_RULE_CODE = "BID_BOND_RATIO_LIMIT" as const;

/** 《招标投标法实施条例》第二十六条 / 《政府采购法实施条例》第三十三条。 */
export const DEFAULT_BID_BOND_MAX_RATIO = 0.02;

const EVIDENCE_ID = "contract-bid-bond";
const KEYWORD = /投标保证金|响应保证金|参选保证金/u;
const DENOMINATOR = /招标项目估算价|采购项目预算金额|项目预算|估算价|预算金额|招标控制价/u;

export type BidBondAnalysis = RatioClauseAnalysis;

export function buildBidBondFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
}): BidBondAnalysis {
  return buildRatioLimitFacts({
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    keyword: KEYWORD,
    denominator: DENOMINATOR,
    evidenceId: EVIDENCE_ID,
    label: "投标保证金",
  });
}

export function evaluateBidBondRule(
  facts: BidBondAnalysis["facts"],
  params?: RuleParamSet,
): RuleAssessment {
  return evaluateRatioLimit({
    code: BID_BOND_RULE_CODE,
    assessmentId: "assessment-bid-bond",
    limit: numberParam(params, "maxRatio", DEFAULT_BID_BOND_MAX_RATIO),
    facts,
    evidenceIds: [EVIDENCE_ID],
  });
}
