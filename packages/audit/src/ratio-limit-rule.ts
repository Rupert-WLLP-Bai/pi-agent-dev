import {
  clauseEvidence,
  extractMoney,
  extractRatio,
  findClause,
  findMoneyNear,
  formatRatio,
} from "./clause-numeric";
import type { ContractDocument, EvidenceLocator, RuleAssessment, RuleCode } from "./model";

/**
 * The disposition every clause-ratio rule shares: a ratio above the ceiling is
 * a settled policy conflict, one at or below it is compliant, and a clause
 * whose ratio cannot be settled degrades to a human review instead of being
 * scored as compliant. Keeping the comparison in one place is what makes the
 * boundary rule (`>` not `>=`) true for every ratio at once.
 */
export interface RatioLimitFacts {
  /** Whether the clause keyword appeared in the contract at all. */
  hasClause: boolean;
  /** The ratio as a 0–1 fraction; null when the clause states no usable number. */
  ratio: number | null;
  /** True when an amount was found but the contract states no denominator. */
  denominatorMissing: boolean;
  /** Human label of the clause, e.g. 履约保证金. */
  label: string;
}

export interface RatioClauseAnalysis {
  facts: RatioLimitFacts;
  evidence: EvidenceLocator[];
}

/**
 * Reads a bond/deposit/retention ratio from a contract. An explicit percentage
 * wins; a bare amount is only comparable once the document states the base it
 * is a fraction of, so a contract that never names its total yields
 * `denominatorMissing` and a human review rather than a fabricated ratio.
 */
export function buildRatioLimitFacts(input: {
  sourceRecordId: string;
  document: ContractDocument;
  keyword: RegExp;
  denominator: RegExp;
  evidenceId: string;
  label: string;
}): RatioClauseAnalysis {
  const hit = findClause(input.document, input.keyword);
  if (hit === null) {
    return {
      facts: { hasClause: false, ratio: null, denominatorMissing: false, label: input.label },
      evidence: [],
    };
  }

  const evidence = clauseEvidence({
    id: input.evidenceId,
    sourceRecordId: input.sourceRecordId,
    document: input.document,
    hit,
  });

  const explicit = extractRatio(hit.window);
  if (explicit !== null) {
    return {
      facts: {
        hasClause: true,
        ratio: explicit.ratio,
        denominatorMissing: false,
        label: input.label,
      },
      evidence: [evidence],
    };
  }

  const amount = extractMoney(hit.window);
  if (amount !== null) {
    const denominator = findMoneyNear(input.document, input.denominator);
    if (denominator !== null && denominator.amount > 0) {
      return {
        facts: {
          hasClause: true,
          ratio: amount.amount / denominator.amount,
          denominatorMissing: false,
          label: input.label,
        },
        evidence: [evidence],
      };
    }
    return {
      facts: { hasClause: true, ratio: null, denominatorMissing: true, label: input.label },
      evidence: [evidence],
    };
  }

  return {
    facts: { hasClause: true, ratio: null, denominatorMissing: false, label: input.label },
    evidence: [evidence],
  };
}

export function evaluateRatioLimit(input: {
  code: RuleCode;
  assessmentId: string;
  /** The ratio ceiling as a 0–1 fraction. */
  limit: number;
  facts: RatioLimitFacts;
  evidenceIds: string[];
}): RuleAssessment {
  const { facts } = input;
  const limitPercent = Math.round(input.limit * 100);

  if (!facts.hasClause) {
    return {
      id: input.assessmentId,
      ruleCode: input.code,
      disposition: "COMPLIANT",
      evidenceIds: [],
      basis: `合同未约定${facts.label}，不涉及 ${limitPercent}% 法定上限。`,
    };
  }

  if (facts.ratio === null) {
    return {
      id: input.assessmentId,
      ruleCode: input.code,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: input.evidenceIds,
      basis: facts.denominatorMissing
        ? `检出${facts.label}金额，但合同未载明计算基数（合同总额/结算总额等），无法确定比例，需人工确认。`
        : `检出${facts.label}条款，但未能提取比例或金额，需人工确认。`,
    };
  }

  const conflict = facts.ratio > input.limit;
  const diff = Math.round((facts.ratio - input.limit) * 10000) / 100;

  return {
    id: input.assessmentId,
    ruleCode: input.code,
    disposition: conflict ? "POLICY_CONFLICT" : "COMPLIANT",
    evidenceIds: input.evidenceIds,
    basis: conflict
      ? `${facts.label}比例 ${formatRatio(facts.ratio)} 高于法定上限 ${limitPercent}%（超出 ${diff} 个百分点）。`
      : `${facts.label}比例 ${formatRatio(facts.ratio)} 未超过法定上限 ${limitPercent}%。`,
  };
}
