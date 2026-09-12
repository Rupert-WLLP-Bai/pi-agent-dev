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
