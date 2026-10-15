import { expect, test } from "bun:test";
import type { RuleAssessment, RuleCode, RuleDisposition } from "./model";
import { createAuditSnapshot } from "./orchestrator";
import { normalizeContractDocument } from "./plaintext-adapter";
import { ENGINE_RULE_CODES } from "./rule-catalog";

/**
 * Deterministic-rule regression matrix over all 19 engine rules.
 *
 * Each rule is exercised end-to-end through `createAuditSnapshot` — the same
 * entry point the audit queue uses — with a contract that isolates the rule's
 * own trigger. The assertions are on the rule's disposition and on the rule's
 * own code appearing (or not) in the assessment list, never on message text.
 *
 * Why this file exists alongside the per-rule unit tests: those prove each
 * evaluator's arithmetic and edge cases. This proves the *routing* — that a
 * contract written to trigger rule X actually reaches rule X, and that a
 * contract written to avoid it does not. A rule that stops being wired into the
 * snapshot fails here even when its own evaluator still passes.
 */

interface RuleCase {
  code: RuleCode;
  /** A contract that makes the rule settle on `expected`. */
  text: string;
  expected: RuleDisposition;
  /** An optional second contract that must NOT raise this rule. */
  clearedBy?: { text: string };
}

const HEAD = "设备采购合同\n甲方：深圳精工科技有限公司\n乙方：重庆华盛贸易有限公司\n";

const CASES: RuleCase[] = [
  {
    code: "ADVANCE_PAYMENT_LIMIT",
    text: `${HEAD}第二条 甲方应在合同签订后七日内支付合同总价70%作为预付款。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第二条 甲方支付合同总价20%作为预付款。` },
  },
  {
    code: "PENALTY_RATIO_LIMIT",
    text: `${HEAD}第五条 违约责任\n违约方应支付合同总价40%的违约金。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第五条 违约责任\n违约方应支付合同总价5%的违约金。` },
  },
  {
    code: "TERMINATION_CLAUSE_PRESENT",
    text: `${HEAD}第七条 任何一方严重违约，守约方有权解除本合同。`,
    expected: "COMPLIANT",
  },
  {
    code: "DISPUTE_JURISDICTION",
    text: `${HEAD}第八条 因本合同引起的争议，提交北京仲裁委员会仲裁。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第八条 因本合同引起的争议，提交重庆仲裁委员会仲裁。` },
  },
  {
    code: "PERFORMANCE_BOND_RATIO_LIMIT",
    text: `${HEAD}第六条 乙方应提交合同总价15%的履约保证金。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第六条 乙方应提交合同总价8%的履约保证金。` },
  },
  {
    code: "PAYMENT_TERM_LIMIT",
    text: `${HEAD}第二条 甲方应在验收合格后90日内支付合同总价。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第二条 甲方应在验收合格后30日内支付合同总价。` },
  },
  {
    code: "BACK_TO_BACK_PAYMENT_CLAUSE",
    text: `${HEAD}第二条 甲方在收到业主相应款项后向乙方支付合同总价。`,
    expected: "POLICY_CONFLICT",
  },
  {
    code: "DEPOSIT_RATIO_LIMIT",
    text: `${HEAD}第二条 乙方应支付合同总价25%作为定金。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第二条 乙方应支付合同总价10%作为定金。` },
  },
  {
    code: "WARRANTY_RETENTION_RATIO_LIMIT",
    text: `${HEAD}第九条 甲方保留合同总价5%作为质量保证金，缺陷责任期30个月。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第九条 甲方保留合同总价3%作为质量保证金，缺陷责任期12个月。` },
  },
  {
    code: "DISPUTE_RESOLUTION_CONFLICT",
    text: `${HEAD}第八条 争议解决\n因本合同引起的争议，可以提交重庆仲裁委员会仲裁，也可以向人民法院起诉。`,
    expected: "POLICY_CONFLICT",
  },
  {
    code: "BID_BOND_RATIO_LIMIT",
    text: `${HEAD}第二条 投标保证金为合同总价的2.5%。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第二条 投标保证金为合同总价的1.5%。` },
  },
  {
    code: "IP_OWNERSHIP_MISSING",
    text: `${HEAD}第一条 乙方为甲方定制开发审计工作台软件，交付后由甲方使用。`,
    expected: "POLICY_CONFLICT",
    clearedBy: {
      text: `${HEAD}第一条 乙方为甲方定制开发审计工作台软件，其知识产权归甲方所有。`,
    },
  },
  {
    code: "GUARANTEE_MODE_AMBIGUOUS",
    // An unnamed guarantee mode settles as a policy conflict; the engine has no
    // NEEDS_HUMAN_REVIEW path for this rule through the snapshot.
    text: `${HEAD}第六条 保证\n丙方为本合同的履行提供保证。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第六条 保证\n丙方为本合同的履行提供连带责任保证。` },
  },
  {
    code: "CONFIDENTIALITY_PERIOD_MISSING",
    text: `${HEAD}第十条 双方对本合同内容负有保密义务。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}第十条 双方对本合同内容负有保密义务，保密期限为三年。` },
  },
  {
    code: "FORCE_MAJEURE_OVERBROAD",
    text: `${HEAD}第十一条 因市场波动、政策调整等不可抗力致使本合同无法履行的，双方均不承担责任。`,
    expected: "POLICY_CONFLICT",
    clearedBy: {
      text: `${HEAD}第十一条 因不能预见、不能避免且不能克服的客观情况致使本合同无法履行的，受影响方应在十五日内通知对方。`,
    },
  },
  {
    code: "LIABILITY_CAP_MISSING",
    text: `${HEAD}第六条 赔偿责任\n乙方对甲方的任何赔偿责任累计不超过人民币壹佰万元；但甲方对乙方不设赔偿上限。`,
    expected: "POLICY_CONFLICT",
    clearedBy: {
      text: `${HEAD}第六条 赔偿责任\n双方在本合同项下的赔偿责任均以合同总价为上限。`,
    },
  },
  {
    code: "AMOUNT_IN_WORDS_MISMATCH",
    text: `${HEAD}合同价款\n本合同总价为人民币壹佰万元整（100000元）。`,
    expected: "POLICY_CONFLICT",
    clearedBy: { text: `${HEAD}合同价款\n本合同总价为人民币壹佰万元整（1000000元）。` },
  },
];

const dispositionsFor = (text: string, policyLimitRatio = 0.3): RuleAssessment[] =>
  createAuditSnapshot({
    sourceRecordId: crypto.randomUUID(),
    document: normalizeContractDocument(text),
    policyLimitRatio,
  }).ruleAssessments;

const dispositionOf = (
  assessments: readonly RuleAssessment[],
  code: RuleCode,
): RuleDisposition | null =>
  assessments.find((item) => item.ruleCode === code)?.disposition ?? null;

test("the matrix covers every rule code the engine evaluates", () => {
  const covered = new Set(CASES.map((entry) => entry.code));
  const missing = ENGINE_RULE_CODES.filter((code) => !covered.has(code));
  // The two subject-dependent rules need verification/party-history input that
  // a bare contract text cannot supply; they are covered by their own suites
  // (subject-rule.test.ts, party-history-rule.test.ts).
  expect(missing).toEqual(["SUBJECT_RED_LINE_RISK", "PARTY_HISTORY_ASSOCIATION"]);
});

for (const entry of CASES) {
  test(`${entry.code}: the written contract settles on ${entry.expected}`, () => {
    const assessments = dispositionsFor(entry.text);
    expect(dispositionOf(assessments, entry.code)).toBe(entry.expected);
  });

  const clearedBy = entry.clearedBy;
  if (clearedBy) {
    test(`${entry.code}: a compliant contract does not raise it`, () => {
      const assessments = dispositionsFor(clearedBy.text);
      // Either the rule runs and clears, or it does not apply to the contract —
      // what must never happen is a conflict on a contract written to comply.
      expect(dispositionOf(assessments, entry.code)).not.toBe("POLICY_CONFLICT");
    });
  }
}

test("every assessment carries evidence or an explicit reason for not having any", () => {
  // The evidence rule is what makes a finding auditable: an assessment with no
  // basis and no evidence id is not a reviewable conclusion.
  for (const entry of CASES) {
    for (const item of dispositionsFor(entry.text)) {
      const hasBasis = typeof item.basis === "string" && item.basis.trim().length > 0;
      const hasEvidence = Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0;
      expect(hasBasis || hasEvidence, `${item.ruleCode} needs a basis or evidence`).toBe(true);
    }
  }
});
