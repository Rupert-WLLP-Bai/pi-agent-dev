import type { AuditSnapshot, FindingProposal, RuleAssessment } from "@contract-audit/audit/model";

/**
 * Deterministic stand-in for the Pi agent, used whenever `AUDIT_AGENT_MODE=fake`
 * (every acceptance run). It reports a finding for each violated dimension
 * rather than only the worst one: a contract can breach the payment ceiling and
 * the jurisdiction clause at once, and a reviewer must see both.
 *
 * Precedence decides ordering, not which findings exist:
 *
 * 1. settled POLICY_CONFLICTs, subject red lines first (a bad counterparty is
 *    the most fundamental risk), then clause conflicts in rule order;
 * 2. NEEDS_HUMAN_REVIEW from a clause-absence rule (penalty, termination,
 *    dispute) — these signal missing protective clauses;
 * 3. subject verification that could not settle a party.
 *
 * A clean contract yields no proposals at all, which is what lets the case
 * complete as "通过" instead of carrying a token low-severity finding.
 */
const CONFLICT_PRIORITY: Array<{
  ruleCode: RuleAssessment["ruleCode"];
  findingType: FindingProposal["findingType"];
  severity: FindingProposal["severity"];
  rationale: string;
  remediation: string;
}> = [
  {
    ruleCode: "SUBJECT_RED_LINE_RISK",
    findingType: "SUBJECT_RED_LINE_RISK",
    severity: "HIGH",
    rationale: "",
    remediation: "签约前要求相对方处理失信记录，或增加履约担保、缩短付款周期。",
  },
  {
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "预付款比例高于制度上限",
    remediation: "调整预付款比例至制度上限以内",
  },
  {
    ruleCode: "PENALTY_RATIO_LIMIT",
    findingType: "PENALTY_RATIO_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "违约金比例高于制度上限",
    remediation: "调整违约金比例至制度上限以内",
  },
  {
    ruleCode: "DISPUTE_JURISDICTION",
    findingType: "DISPUTE_JURISDICTION_CONFLICT",
    severity: "MEDIUM",
    rationale: "争议管辖地与我方所在地不一致",
    remediation: "协商将争议管辖地修改为我方所在地。",
  },
  {
    ruleCode: "PERFORMANCE_BOND_RATIO_LIMIT",
    findingType: "PERFORMANCE_BOND_RATIO_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "履约保证金比例超过法定上限",
    remediation: "将履约保证金比例降至合同金额的10%以内，或以银行保函替代。",
  },
  {
    ruleCode: "PAYMENT_TERM_LIMIT",
    findingType: "PAYMENT_TERM_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "付款期限超过法定最长60日",
    remediation: "将付款期限缩短至60日以内（建议30日）。",
  },
  {
    ruleCode: "BACK_TO_BACK_PAYMENT_CLAUSE",
    findingType: "BACK_TO_BACK_PAYMENT_CLAUSE",
    severity: "HIGH",
    rationale: "合同约定以收到第三方付款为付款前提",
    remediation: "删除背靠背付款条件，改为按验收节点无条件付款。",
  },
  {
    ruleCode: "DEPOSIT_RATIO_LIMIT",
    findingType: "DEPOSIT_RATIO_POLICY_CONFLICT",
    severity: "MEDIUM",
    rationale: "定金比例超过主合同标的额的20%",
    remediation: "将定金比例降至20%以内，或将超额部分改为预付款。",
  },
  {
    ruleCode: "WARRANTY_RETENTION_RATIO_LIMIT",
    findingType: "WARRANTY_RETENTION_RATIO_POLICY_CONFLICT",
    severity: "MEDIUM",
    rationale: "质量保证金比例或缺陷责任期超过法定上限",
    remediation: "将质量保证金降至3%以内，缺陷责任期缩短至24个月以内。",
  },
  {
    ruleCode: "DISPUTE_RESOLUTION_CONFLICT",
    findingType: "DISPUTE_RESOLUTION_CONFLICT",
    severity: "HIGH",
    rationale: "约定仲裁与诉讼并列，仲裁协议无效",
    remediation: "保留单一仲裁或单一诉讼约定，删除或裁或诉表述。",
  },
  {
    ruleCode: "BID_BOND_RATIO_LIMIT",
    findingType: "BID_BOND_RATIO_POLICY_CONFLICT",
    severity: "MEDIUM",
    rationale: "投标保证金比例超过招标项目估算价的2%",
    remediation: "将投标保证金降至项目估算价的2%以内。",
  },
  {
    ruleCode: "IP_OWNERSHIP_MISSING",
    findingType: "IP_OWNERSHIP_MISSING",
    severity: "HIGH",
    rationale: "开发/定制类合同未约定知识产权归属",
    remediation: "补充知识产权条款，明确成果归甲方（采购人）所有。",
  },
  {
    ruleCode: "GUARANTEE_MODE_AMBIGUOUS",
    findingType: "GUARANTEE_MODE_AMBIGUOUS",
    severity: "MEDIUM",
    rationale: "保证担保未明确保证方式",
    remediation: "明确约定为连带责任保证，避免被推定为一般保证。",
  },
  {
    ruleCode: "CONFIDENTIALITY_PERIOD_MISSING",
    findingType: "CONFIDENTIALITY_PERIOD_MISSING",
    severity: "MEDIUM",
    rationale: "保密条款未约定保密期限",
    remediation: "补充保密期限约定（建议不超过5年）。",
  },
  {
    ruleCode: "FORCE_MAJEURE_OVERBROAD",
    findingType: "FORCE_MAJEURE_OVERBROAD",
    severity: "MEDIUM",
    rationale: "不可抗力范围过宽或免责过度",
    remediation: "按法定三要件定义不可抗力，并约定通知与证明义务。",
  },
  {
    ruleCode: "LIABILITY_CAP_MISSING",
    findingType: "LIABILITY_CAP_MISSING",
    severity: "MEDIUM",
    rationale: "赔偿责任上限缺失或不对等",
    remediation: "约定对等的赔偿责任限额，排除法定无效情形。",
  },
];

const ABSENCE_FINDINGS: Array<{
  ruleCode: RuleAssessment["ruleCode"];
  findingType: FindingProposal["findingType"];
  severity: FindingProposal["severity"];
  remediation: string;
}> = [
  {
    ruleCode: "PENALTY_RATIO_LIMIT",
    findingType: "PENALTY_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充违约责任条款，明确违约金比例。",
  },
  {
    ruleCode: "TERMINATION_CLAUSE_PRESENT",
    findingType: "TERMINATION_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充合同终止/解除条款，明确终止条件和程序。",
  },
  {
    ruleCode: "DISPUTE_JURISDICTION",
    findingType: "DISPUTE_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充争议解决条款，明确管辖法院或仲裁机构。",
  },
  {
    ruleCode: "PERFORMANCE_BOND_RATIO_LIMIT",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "确认履约保证金金额并补全计算基数，必要时重新发起审核。",
  },
  {
    ruleCode: "PAYMENT_TERM_LIMIT",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "补充明确的付款期限（建议不超过60日）。",
  },
  {
    ruleCode: "DEPOSIT_RATIO_LIMIT",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "确认定金金额与合同总额，必要时补全计算基数。",
  },
  {
    ruleCode: "WARRANTY_RETENTION_RATIO_LIMIT",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "确认质量保证金预留比例与工程价款结算总额。",
  },
  {
    ruleCode: "BID_BOND_RATIO_LIMIT",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "确认投标保证金金额与项目估算价，必要时补全计算基数。",
  },
  {
    ruleCode: "LIABILITY_CAP_MISSING",
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "MEDIUM",
    remediation: "评估高价值合同的赔偿责任范围，必要时约定责任上限。",
  },
];

const assessmentBy = (snapshot: AuditSnapshot, ruleCode: string): RuleAssessment | undefined =>
  snapshot.ruleAssessments.find((item) => item.ruleCode === ruleCode);

export function demoProposalsFor(snapshot: AuditSnapshot): FindingProposal[] {
  const proposals: FindingProposal[] = [];

  for (const entry of CONFLICT_PRIORITY) {
    const assessment = assessmentBy(snapshot, entry.ruleCode);
    if (assessment?.disposition === "POLICY_CONFLICT") {
      proposals.push({
        findingType: entry.findingType,
        severity: entry.severity,
        rationale: entry.rationale || assessment.basis,
        evidenceIds: assessment.evidenceIds,
        remediation: entry.remediation,
      });
    }
  }

  for (const entry of ABSENCE_FINDINGS) {
    const assessment = assessmentBy(snapshot, entry.ruleCode);
    if (assessment?.disposition === "NEEDS_HUMAN_REVIEW") {
      proposals.push({
        findingType: entry.findingType,
        severity: entry.severity,
        rationale: assessment.basis,
        evidenceIds: assessment.evidenceIds,
        remediation: entry.remediation,
      });
    }
  }

  const subject = assessmentBy(snapshot, "SUBJECT_RED_LINE_RISK");
  if (subject?.disposition === "NEEDS_HUMAN_REVIEW") {
    proposals.push({
      findingType: "NEEDS_HUMAN_REVIEW",
      severity: "MEDIUM",
      rationale: subject.basis,
      evidenceIds: subject.evidenceIds,
      remediation: "确认合同当事人对应的主体后重新发起核验。",
    });
  }

  return proposals;
}
