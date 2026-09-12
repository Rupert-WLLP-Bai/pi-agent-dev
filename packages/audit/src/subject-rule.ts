import type {
  ContractParty,
  RuleAssessment,
  SubjectRiskDimension,
  SubjectVerification,
} from "./model";

/**
 * Subject risk policy. Factors are classified here rather than trusted from the
 * provider, because a large company legitimately accumulates thousands of
 * litigation records while a single dishonest-debtor entry is disqualifying.
 */

/** Factors that justify a Finding on their own. */
export const RED_LINE_FACTORS: ReadonlySet<string> = new Set([
  "失信信息",
  "被执行人",
  "限制高消费",
  "严重违法",
  "经营异常",
  "税务非正常户",
  "破产重整",
  "股权冻结",
  "惩戒名单",
]);

export const SUBJECT_RULE_CODE = "SUBJECT_RED_LINE_RISK" as const;

export function classifySubjectDimensions(
  raw: Array<{ factor: string; count: number; detailTool: string }>,
): SubjectRiskDimension[] {
  const dimensions: SubjectRiskDimension[] = [];
  for (const item of raw) {
    dimensions.push({
      factor: item.factor,
      count: item.count,
      detailTool: item.detailTool,
      severity: RED_LINE_FACTORS.has(item.factor) ? "RED_LINE" : "BACKGROUND",
    });
  }
  return dimensions;
}

/**
 * A Subject Verification is inconclusive when we could not settle which legal
 * person the contract names, or when the provider never answered.
 */
export function isInconclusive(verification: SubjectVerification): boolean {
  return verification.status !== "RESOLVED";
}

export function redLineHits(verification: SubjectVerification): SubjectRiskDimension[] {
  return verification.dimensions.filter(
    (dimension) => dimension.severity === "RED_LINE" && dimension.count > 0,
  );
}

/**
 * Evaluates the subject dimension of one audit case.
 *
 * The evaluation is per party, not global: a settled red line on one party is
 * reported even when another party could not be resolved. A global
 * "inconclusive wins" rule would silently swallow a confirmed fact.
 *
 * Precedence within a case:
 * 1. any settled red line            → POLICY_CONFLICT
 * 2. any party unverified or unsettled → NEEDS_HUMAN_REVIEW
 * 3. otherwise                       → COMPLIANT
 */
export function evaluateSubjectRiskRule(input: {
  parties: ContractParty[];
  verifications: SubjectVerification[];
}): RuleAssessment {
  const base = { id: "assessment-subject", ruleCode: SUBJECT_RULE_CODE } as const;

  if (input.parties.length === 0) {
    return {
      ...base,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [],
      basis: "未能从合同文本中确定性提取当事人名称，无法发起主体核验。",
    };
  }

  const partyEvidence = input.parties.map((party) => party.evidenceId);
  const byPartyId = new Map(input.verifications.map((item) => [item.partyId, item]));

  // A party with no verification at all has not been assessed — it is not the
  // same as a party that came back clean, so it must never read as compliant.
  const unverified = input.parties.filter((party) => !byPartyId.has(party.id));
  const unsettled = input.verifications.filter(isInconclusive);

  const offending = [...byPartyId.values()]
    .filter((verification) => verification.status === "RESOLVED")
    .flatMap((verification) => redLineHits(verification).map((dimension) => ({ verification, dimension })));

  if (offending.length > 0) {
    const settled = offending
      .map(({ verification, dimension }) => {
        const subject = verification.matched?.name ?? "相对方";
        return `${subject} 命中【${dimension.factor}】${dimension.count} 条（红线因子）`;
      })
      .join("；");
    const outstanding = unverified.length + unsettled.length;

    return {
      ...base,
      disposition: "POLICY_CONFLICT",
      evidenceIds: [
        ...partyEvidence,
        ...offending.flatMap(({ verification }) => verification.evidenceIds),
      ],
      basis:
        outstanding > 0
          ? `${settled}。另有 ${outstanding} 个当事人主体尚未确认，需一并人工核实。`
          : settled,
    };
  }

  if (unverified.length > 0 || unsettled.length > 0) {
    const reasons = [
      ...unverified.map((party) => `${party.label}「${party.name}」尚未核验`),
      ...unsettled.map((item) => describeInconclusive(item, input.parties)),
    ];
    return {
      ...base,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: [...partyEvidence, ...unsettled.flatMap((item) => item.evidenceIds)],
      basis: `${reasons.join("；")}，需人工确认。`,
    };
  }

  return {
    ...base,
    disposition: "COMPLIANT",
    evidenceIds: [...partyEvidence, ...input.verifications.flatMap((item) => item.evidenceIds)],
    basis: `已核验 ${input.verifications.length} 个当事人，未命中红线风险因子。`,
  };
}

function describeInconclusive(verification: SubjectVerification, parties: ContractParty[]): string {
  const party = parties.find((item) => item.id === verification.partyId);
  const who = party ? `${party.label}「${party.name}」` : verification.partyId;
  if (verification.status === "AMBIGUOUS") {
    return `${who} 匹配到 ${verification.candidates.length} 个候选主体，需人工确认`;
  }
  if (verification.status === "UNRESOLVED") {
    return `${who} 在外部来源中未匹配到主体，需人工确认`;
  }
  return `${who} 主体核验来源不可用（${verification.failureReason ?? "原因未知"}），需人工复核`;
}
