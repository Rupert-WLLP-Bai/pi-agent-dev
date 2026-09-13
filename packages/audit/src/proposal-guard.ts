import { getFindingTypeLabel } from "./finding-labels";
import type { FindingProposal, FindingType, RuleAssessment, RuleCode, Severity } from "./model";

/** Severity ordering; a larger rank is more severe. */
const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** An inclusive `[least severe, most severe]` pair. */
export type SeverityRange = readonly [Severity, Severity];

/** A finding the model may choose when a rule cannot settle its own dimension. */
export interface OpenFindingChoice {
  readonly findingType: FindingType;
  readonly severity: SeverityRange;
}

/**
 * What may be proposed for one rule code, and what may not.
 *
 * A rule that settles a conflict names the one finding it justifies and locks
 * its severity: the rule already decided the outcome, so the model has no say
 * in how serious it is. A rule that abstains opens a set of findings with a
 * severity range, because judging an inconclusive dimension is exactly the
 * work the model is there to do.
 */
export interface RuleFindingContract {
  readonly ruleCode: RuleCode;
  /** The finding justified when the rule settles a POLICY_CONFLICT, or null. */
  readonly policyConflict: {
    readonly findingType: FindingType;
    readonly severity: Severity;
  } | null;
  /** The findings justified when the rule returns NEEDS_HUMAN_REVIEW. */
  readonly needsHumanReview: readonly OpenFindingChoice[];
  /**
   * Substring the agent searches the contract for when it reviews this rule.
   * Kept beside the finding contract so the reading trace and the submission
   * boundary stay derived from one table rather than two that can drift.
   */
  readonly searchKeyword: string;
}

/**
 * The submission boundary, one entry per RuleCode.
 *
 * This table — not the skill prompt — is the authority on what a proposal may
 * say. Every deterministic rule that can settle a conflict locks the finding
 * type and its severity; every rule that can abstain opens a finding with a
 * severity range. `RULE_CONTRACT_TABLE_IS_COMPLETE` makes a rule code added to
 * the domain without a row here a compile error.
 */
export const RULE_FINDING_CONTRACTS = [
  {
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    policyConflict: { findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT", severity: "HIGH" },
    needsHumanReview: [],
    searchKeyword: "预付款",
  },
  {
    ruleCode: "SUBJECT_RED_LINE_RISK",
    policyConflict: { findingType: "SUBJECT_RED_LINE_RISK", severity: "HIGH" },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["MEDIUM", "HIGH"] }],
    searchKeyword: "失信",
  },
  {
    ruleCode: "TERMINATION_CLAUSE_PRESENT",
    policyConflict: null,
    needsHumanReview: [{ findingType: "TERMINATION_CLAUSE_MISSING", severity: ["MEDIUM", "HIGH"] }],
    searchKeyword: "终止",
  },
  {
    ruleCode: "PENALTY_RATIO_LIMIT",
    policyConflict: { findingType: "PENALTY_RATIO_POLICY_CONFLICT", severity: "HIGH" },
    needsHumanReview: [{ findingType: "PENALTY_CLAUSE_MISSING", severity: ["MEDIUM", "HIGH"] }],
    searchKeyword: "违约金",
  },
  {
    ruleCode: "DISPUTE_JURISDICTION",
    policyConflict: { findingType: "DISPUTE_JURISDICTION_CONFLICT", severity: "MEDIUM" },
    needsHumanReview: [{ findingType: "DISPUTE_CLAUSE_MISSING", severity: ["MEDIUM", "HIGH"] }],
    searchKeyword: "管辖",
  },
  {
    ruleCode: "PERFORMANCE_BOND_RATIO_LIMIT",
    policyConflict: {
      findingType: "PERFORMANCE_BOND_RATIO_POLICY_CONFLICT",
      severity: "HIGH",
    },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "履约保证金",
  },
  {
    ruleCode: "PAYMENT_TERM_LIMIT",
    policyConflict: { findingType: "PAYMENT_TERM_POLICY_CONFLICT", severity: "HIGH" },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "付款",
  },
  {
    ruleCode: "BACK_TO_BACK_PAYMENT_CLAUSE",
    policyConflict: { findingType: "BACK_TO_BACK_PAYMENT_CLAUSE", severity: "HIGH" },
    needsHumanReview: [],
    searchKeyword: "背靠背",
  },
  {
    ruleCode: "DEPOSIT_RATIO_LIMIT",
    policyConflict: { findingType: "DEPOSIT_RATIO_POLICY_CONFLICT", severity: "MEDIUM" },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "定金",
  },
  {
    ruleCode: "WARRANTY_RETENTION_RATIO_LIMIT",
    policyConflict: {
      findingType: "WARRANTY_RETENTION_RATIO_POLICY_CONFLICT",
      severity: "MEDIUM",
    },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "质量保证金",
  },
  {
    ruleCode: "DISPUTE_RESOLUTION_CONFLICT",
    policyConflict: { findingType: "DISPUTE_RESOLUTION_CONFLICT", severity: "HIGH" },
    needsHumanReview: [],
    searchKeyword: "仲裁",
  },
  {
    ruleCode: "BID_BOND_RATIO_LIMIT",
    policyConflict: { findingType: "BID_BOND_RATIO_POLICY_CONFLICT", severity: "MEDIUM" },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "投标保证金",
  },
  {
    ruleCode: "IP_OWNERSHIP_MISSING",
    policyConflict: { findingType: "IP_OWNERSHIP_MISSING", severity: "HIGH" },
    needsHumanReview: [],
    searchKeyword: "知识产权",
  },
  {
    ruleCode: "GUARANTEE_MODE_AMBIGUOUS",
    policyConflict: { findingType: "GUARANTEE_MODE_AMBIGUOUS", severity: "MEDIUM" },
    needsHumanReview: [],
    searchKeyword: "保证",
  },
  {
    ruleCode: "CONFIDENTIALITY_PERIOD_MISSING",
    policyConflict: { findingType: "CONFIDENTIALITY_PERIOD_MISSING", severity: "MEDIUM" },
    needsHumanReview: [],
    searchKeyword: "保密",
  },
  {
    ruleCode: "FORCE_MAJEURE_OVERBROAD",
    policyConflict: { findingType: "FORCE_MAJEURE_OVERBROAD", severity: "MEDIUM" },
    needsHumanReview: [],
    searchKeyword: "不可抗力",
  },
  {
    ruleCode: "LIABILITY_CAP_MISSING",
    policyConflict: { findingType: "LIABILITY_CAP_MISSING", severity: "MEDIUM" },
    needsHumanReview: [{ findingType: "NEEDS_HUMAN_REVIEW", severity: ["LOW", "MEDIUM"] }],
    searchKeyword: "赔偿",
  },
] as const satisfies readonly RuleFindingContract[];

type ContractedRuleCode = (typeof RULE_FINDING_CONTRACTS)[number]["ruleCode"];
type MissingRuleCode = Exclude<RuleCode, ContractedRuleCode>;

/**
 * Compile-time exhaustiveness witness: if a RuleCode is added to the domain
 * without a row in `RULE_FINDING_CONTRACTS`, `MissingRuleCode` stops being
 * `never` and this assignment fails to compile, naming the missing code.
 */
export const RULE_CONTRACT_TABLE_IS_COMPLETE: MissingRuleCode extends never
  ? true
  : MissingRuleCode = true;

/** The contract row for a rule code, or undefined when the table has none. */
export function ruleContractFor(ruleCode: RuleCode): RuleFindingContract | undefined {
  return RULE_FINDING_CONTRACTS.find((contract) => contract.ruleCode === ruleCode);
}

/** The deterministic contract-search keyword the agent uses for a rule. */
export function searchKeywordFor(ruleCode: RuleCode): string {
  const contract = ruleContractFor(ruleCode);
  if (!contract) throw new Error(`UNCONTRACTED_RULE: ${ruleCode}`);
  return contract.searchKeyword;
}

/** Raised when a proposal falls outside the submission boundary. */
export class ProposalGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalGuardError";
  }
}

/**
 * Enforces the submission boundary.
 *
 * A proposal is legal exactly when some rule whose contract mentions its
 * finding type has an assessment that authorizes it: a POLICY_CONFLICT with
 * the locked severity, or a NEEDS_HUMAN_REVIEW with the severity inside the
 * open range. Everything else — a compliant dimension, a wrong severity, a
 * type no rule names — throws a `ProposalGuardError` so the caller cannot file
 * a finding the rules did not justify.
 */
export function assertProposalLegal(
  proposal: FindingProposal,
  assessments: readonly RuleAssessment[],
): void {
  const { findingType, severity } = proposal;
  const label = getFindingTypeLabel(findingType);
  const candidates = RULE_FINDING_CONTRACTS.filter(
    (contract) =>
      contract.policyConflict?.findingType === findingType ||
      contract.needsHumanReview.some((choice) => choice.findingType === findingType),
  );

  if (candidates.length === 0) {
    throw new ProposalGuardError(
      `发现类型「${label}」(${findingType}) 没有对应的规则契约，不能提交。`,
    );
  }

  let conflictSeverityMismatch: string | null = null;
  let reviewRangeMismatch: string | null = null;
  let sawCompliant = false;

  for (const contract of candidates) {
    const assessment = assessments.find((item) => item.ruleCode === contract.ruleCode);
    if (!assessment) continue;

    if (assessment.disposition === "POLICY_CONFLICT") {
      const locked = contract.policyConflict;
      if (locked?.findingType === findingType) {
        if (severity === locked.severity) return;
        conflictSeverityMismatch ??= `发现类型「${label}」(${findingType}) 的严重程度由规则锁定为 ${locked.severity}，不能提交 ${severity}。`;
      }
      continue;
    }

    if (assessment.disposition === "NEEDS_HUMAN_REVIEW") {
      const choice = contract.needsHumanReview.find((item) => item.findingType === findingType);
      if (!choice) continue;
      const [least, most] = choice.severity;
      if (
        SEVERITY_RANK[severity] >= SEVERITY_RANK[least] &&
        SEVERITY_RANK[severity] <= SEVERITY_RANK[most]
      ) {
        return;
      }
      reviewRangeMismatch ??= `发现类型「${label}」(${findingType}) 在需人工复核时的严重程度必须介于 ${choice.severity[0]}–${choice.severity[1]} 之间，不能提交 ${severity}。`;
      continue;
    }

    sawCompliant = true;
  }

  if (conflictSeverityMismatch) throw new ProposalGuardError(conflictSeverityMismatch);
  if (reviewRangeMismatch) throw new ProposalGuardError(reviewRangeMismatch);
  if (sawCompliant) {
    throw new ProposalGuardError(
      `发现类型「${label}」(${findingType}) 对应的规则评估为「合规」，不能提交；仅当规则判定为「制度冲突」或「需人工复核」时方可提交。`,
    );
  }
  throw new ProposalGuardError(
    `发现类型「${label}」(${findingType}) 在本次评估中没有对应的违规维度，不能提交。`,
  );
}
