import { expect, test } from "bun:test";
import { buildBackToBackFacts, evaluateBackToBackRule } from "./back-to-back-rule";
import { buildBidBondFacts, evaluateBidBondRule } from "./bid-bond-rule";
import {
  extractDuration,
  extractMoney,
  extractRatio,
  normalizeClauseText,
  normalizeNumbers,
} from "./clause-numeric";
import {
  buildConfidentialityFacts,
  evaluateConfidentialityPeriodRule,
} from "./confidentiality-period-rule";
import { buildDepositFacts, evaluateDepositRule } from "./deposit-rule";
import {
  buildDisputeResolutionFacts,
  evaluateDisputeResolutionConflictRule,
} from "./dispute-conflict-rule";
import { buildContractDocument } from "./document-ir";
import { buildForceMajeureFacts, evaluateForceMajeureRule } from "./force-majeure-rule";
import { buildGuaranteeModeFacts, evaluateGuaranteeModeRule } from "./guarantee-mode-rule";
import { buildIpOwnershipFacts, evaluateIpOwnershipRule } from "./ip-ownership-rule";
import { buildLiabilityCapFacts, evaluateLiabilityCapRule } from "./liability-cap-rule";
import { buildPaymentTermFacts, evaluatePaymentTermRule } from "./payment-term-rule";
import { buildPerformanceBondFacts, evaluatePerformanceBondRule } from "./performance-bond-rule";
import {
  buildWarrantyRetentionFacts,
  evaluateWarrantyRetentionRule,
} from "./warranty-retention-rule";

const makeDoc = (texts: string[]) =>
  buildContractDocument(texts.map((text) => ({ text, kind: "paragraph" as const }))).document;

// ── Shared numeric extraction ─────────────────────────────────────

test("numeric extraction: Chinese numerals normalize to ASCII", () => {
  expect(normalizeNumbers("百分之二十五")).toBe("百分之25");
  expect(normalizeNumbers("壹佰伍拾万元")).toBe("1500000元");
  expect(normalizeNumbers("一百万元")).toBe("1000000元");
  expect(normalizeNumbers("二十四个月")).toBe("24个月");
});

test("numeric extraction: percent, money and duration units", () => {
  expect(extractRatio(normalizeClauseText("定金为合同总价的百分之二十"))?.ratio).toBe(0.2);
  expect(extractRatio(normalizeClauseText("比例 5％"))?.ratio).toBe(0.05);
  expect(extractRatio(normalizeNumbers("两成"))?.ratio).toBe(0.2);
  expect(extractMoney("合同总价150万元")?.amount).toBe(1_500_000);
  expect(extractDuration("60个工作日")?.days).toBe(84);
  expect(extractDuration("缺陷责任期2年")?.months).toBe(24);
  // A calendar date is not a duration.
  expect(extractDuration("于2026年10月31日前交付")).toBeNull();
  expect(extractDuration("自交付之日起30日内支付")?.days).toBe(30);
});

// ── Performance bond (10%) ────────────────────────────────────────

test("performance bond: 15% is over the 10% ceiling", () => {
  const doc = makeDoc(["履约保证金为中标合同金额的15%。"]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(facts.ratio).toBe(0.15);
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("performance bond: exactly 10% is not over", () => {
  const doc = makeDoc(["履约保证金为中标合同金额的10%。"]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("COMPLIANT");
});

test("performance bond: amount over limit when divided by the contract total", () => {
  const doc = makeDoc(["合同总价为人民币玖佰伍拾万元整。", "履约保证金人民币壹佰万元整。"]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(facts.ratio).toBeCloseTo(100 / 950, 5);
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("performance bond: amount without a contract total degrades to review", () => {
  const doc = makeDoc(["履约保证金人民币壹佰万元整。"]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(facts.denominatorMissing).toBe(true);
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("performance bond: absent clause is not a violation", () => {
  const doc = makeDoc(["甲方支付合同总价30%作为预付款。"]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("COMPLIANT");
});

test("performance bond: a ratio in another clause does not leak into the bond window", () => {
  const doc = makeDoc([
    "甲方支付合同总价30%作为预付款。",
    "乙方提交履约保证金，具体金额另行商定。",
  ]);
  const { facts } = buildPerformanceBondFacts({ sourceRecordId: "s", document: doc });
  expect(facts.ratio).toBeNull();
  expect(evaluatePerformanceBondRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});

// ── Payment term (60 days) ────────────────────────────────────────

test("payment term: 90 days is over the 60-day ceiling", () => {
  const doc = makeDoc(["甲方应于验收合格后90日内支付全部价款。"]);
  const { facts } = buildPaymentTermFacts({ sourceRecordId: "s", document: doc });
  expect(facts.days).toBe(90);
  expect(evaluatePaymentTermRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("payment term: exactly 60 days is not over", () => {
  const doc = makeDoc(["甲方自交付之日起60日内支付合同价款。"]);
  const { facts } = buildPaymentTermFacts({ sourceRecordId: "s", document: doc });
  expect(evaluatePaymentTermRule(facts).disposition).toBe("COMPLIANT");
});

test("payment term: an unfixed term asks for a human", () => {
  const doc = makeDoc(["验收合格后一次性支付全款。"]);
  const { facts } = buildPaymentTermFacts({ sourceRecordId: "s", document: doc });
  expect(facts.days).toBeNull();
  expect(evaluatePaymentTermRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("payment term: a duration in another clause does not leak into the payment clause", () => {
  const doc = makeDoc([
    "第三条 支付方式\n甲方验收合格后支付合同价款。",
    "第四条 交付\n乙方应于90日内完成交付。",
  ]);
  const { facts } = buildPaymentTermFacts({ sourceRecordId: "s", document: doc });
  expect(facts.days).toBeNull();
  expect(evaluatePaymentTermRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});

// ── Back-to-back ──────────────────────────────────────────────────

test("back-to-back: payment after receiving the owner's money is flagged", () => {
  const doc = makeDoc(["甲方在收到业主方支付的相应工程款后15日内向乙方支付本合同款项。"]);
  const { facts } = buildBackToBackFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateBackToBackRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("back-to-back: an explicit negation is not a back-to-back clause", () => {
  const doc = makeDoc(["甲方应于验收合格后30日内支付价款，不以任何第三方付款为前提。"]);
  const { facts } = buildBackToBackFacts({ sourceRecordId: "s", document: doc });
  expect(facts.hasClause).toBe(false);
  expect(evaluateBackToBackRule(facts).disposition).toBe("COMPLIANT");
});

test("back-to-back: same-proportion settlement mirrors are flagged", () => {
  const doc = makeDoc(["双方按与业主的结算进度同比例支付工程款。"]);
  const { facts } = buildBackToBackFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateBackToBackRule(facts).disposition).toBe("POLICY_CONFLICT");
});

// ── Deposit (20%) ─────────────────────────────────────────────────

test("deposit: 25% is over the 20% ceiling", () => {
  const doc = makeDoc(["乙方支付定金为合同总价的25%。"]);
  const { facts } = buildDepositFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateDepositRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("deposit: exactly 20% is not over", () => {
  const doc = makeDoc(["乙方支付定金为合同总价的20%。"]);
  const { facts } = buildDepositFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateDepositRule(facts).disposition).toBe("COMPLIANT");
});

test("deposit: 订金 and 押金 are not 定金 under Article 586", () => {
  const e = buildDepositFacts({
    sourceRecordId: "s",
    document: makeDoc(["乙方支付订金为合同总价的30%。"]),
  });
  expect(evaluateDepositRule(e.facts).disposition).toBe("COMPLIANT");
  const y = buildDepositFacts({
    sourceRecordId: "s",
    document: makeDoc(["乙方支付押金为合同总价的30%。"]),
  });
  expect(evaluateDepositRule(y.facts).disposition).toBe("COMPLIANT");
});

test("deposit: a written amount is compared against the contract total", () => {
  const doc = makeDoc(["合同总价为人民币壹佰万元整。", "乙方支付定金人民币叁拾万元整。"]);
  const { facts } = buildDepositFacts({ sourceRecordId: "s", document: doc });
  expect(facts.ratio).toBeCloseTo(0.3, 5);
  expect(evaluateDepositRule(facts).disposition).toBe("POLICY_CONFLICT");
});

// ── Warranty retention (3%, 24 months) ────────────────────────────

test("warranty retention: 5% is over the 3% ceiling", () => {
  const doc = makeDoc([
    "工程价款结算总额为人民币壹佰万元整。",
    "甲方预留工程价款结算总额5%作为质量保证金。",
  ]);
  const { facts } = buildWarrantyRetentionFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateWarrantyRetentionRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("warranty retention: 3% with a 1-year defect period is compliant", () => {
  const doc = makeDoc(["甲方预留工程价款结算总额的3%作为质量保证金，缺陷责任期1年。"]);
  const { facts } = buildWarrantyRetentionFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateWarrantyRetentionRule(facts).disposition).toBe("COMPLIANT");
});

test("warranty retention: a 30-month defect period is over the 24-month ceiling", () => {
  const doc = makeDoc(["本工程缺陷责任期为30个月。"]);
  const { facts } = buildWarrantyRetentionFacts({ sourceRecordId: "s", document: doc });
  expect(facts.defectPeriodMonths).toBe(30);
  expect(evaluateWarrantyRetentionRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("warranty retention: a retention amount without a settled total degrades to review", () => {
  const doc = makeDoc(["甲方预留质量保证金人民币贰拾万元整。"]);
  const { facts } = buildWarrantyRetentionFacts({ sourceRecordId: "s", document: doc });
  expect(facts.denominatorMissing).toBe(true);
  expect(evaluateWarrantyRetentionRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});

// ── Dispute resolution conflict ───────────────────────────────────

test("dispute resolution: arbitration or litigation voids the arbitration agreement", () => {
  const doc = makeDoc(["双方可申请仲裁，也可以向人民法院起诉。"]);
  const { facts } = buildDisputeResolutionFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateDisputeResolutionConflictRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("dispute resolution: arbitration-failed-then-litigate is a valid fallback", () => {
  const doc = makeDoc(["争议提交仲裁，仲裁不成的，可向人民法院起诉。"]);
  const { facts } = buildDisputeResolutionFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateDisputeResolutionConflictRule(facts).disposition).toBe("COMPLIANT");
});

test("dispute resolution: two arbitration bodies are not or-arbitration-or-litigation", () => {
  const doc = makeDoc(["争议提交重庆仲裁委员会或成都仲裁委员会仲裁。"]);
  const { facts } = buildDisputeResolutionFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateDisputeResolutionConflictRule(facts).disposition).toBe("COMPLIANT");
});

// ── Bid bond (2%) ─────────────────────────────────────────────────

test("bid bond: 2.5% is over the 2% ceiling", () => {
  const doc = makeDoc(["投标保证金人民币伍万元整（本项目估算价贰佰万元整）。"]);
  const { facts } = buildBidBondFacts({ sourceRecordId: "s", document: doc });
  expect(facts.ratio).toBeCloseTo(0.025, 5);
  expect(evaluateBidBondRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("bid bond: exactly 2% is not over", () => {
  const doc = makeDoc(["投标保证金为招标项目估算价的2%。"]);
  const { facts } = buildBidBondFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateBidBondRule(facts).disposition).toBe("COMPLIANT");
});

// ── IP ownership ──────────────────────────────────────────────────

test("ip ownership: custom development with no IP clause is a conflict", () => {
  const doc = makeDoc(["乙方为甲方定制开发业务系统，并交付源代码。"]);
  const { facts } = buildIpOwnershipFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateIpOwnershipRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("ip ownership: an explicit assignment clears the rule", () => {
  const doc = makeDoc([
    "乙方为甲方定制开发业务系统。",
    "本项目产生的软件著作权及专利申请权均归甲方所有。",
  ]);
  const { facts } = buildIpOwnershipFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateIpOwnershipRule(facts).disposition).toBe("COMPLIANT");
});

test("ip ownership: a plain supply contract is not in scope", () => {
  const doc = makeDoc(["乙方向甲方供应工业级碳酸锂五十吨。"]);
  const { facts } = buildIpOwnershipFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateIpOwnershipRule(facts).disposition).toBe("COMPLIANT");
});

// ── Guarantee mode ────────────────────────────────────────────────

test("guarantee mode: a suretyship with no mode named is ambiguous", () => {
  const doc = makeDoc(["丙方为乙方的全部义务提供保证。"]);
  const { facts } = buildGuaranteeModeFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateGuaranteeModeRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("guarantee mode: joint and several guarantee is clear", () => {
  const doc = makeDoc(["丙方为乙方的全部义务提供连带责任保证。"]);
  const { facts } = buildGuaranteeModeFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateGuaranteeModeRule(facts).disposition).toBe("COMPLIANT");
});

// ── Confidentiality period ────────────────────────────────────────

test("confidentiality: a clause with no term is flagged", () => {
  const doc = makeDoc(["双方对履行中知悉的信息负有保密义务。"]);
  const { facts } = buildConfidentialityFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateConfidentialityPeriodRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("confidentiality: 5 years is within the reference ceiling", () => {
  const doc = makeDoc(["保密义务自本合同签订之日起5年内有效。"]);
  const { facts } = buildConfidentialityFacts({ sourceRecordId: "s", document: doc });
  expect(facts.periodYears).toBe(5);
  expect(evaluateConfidentialityPeriodRule(facts).disposition).toBe("COMPLIANT");
});

test("confidentiality: an event-bound end is acceptable", () => {
  const doc = makeDoc(["保密期限至相关信息公开之日止。"]);
  const { facts } = buildConfidentialityFacts({ sourceRecordId: "s", document: doc });
  expect(facts.openEnded).toBe(true);
  expect(evaluateConfidentialityPeriodRule(facts).disposition).toBe("COMPLIANT");
});

test("confidentiality: 8 years is over the reference ceiling", () => {
  const doc = makeDoc(["保密期限自本合同签订之日起8年。"]);
  const { facts } = buildConfidentialityFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateConfidentialityPeriodRule(facts).disposition).toBe("POLICY_CONFLICT");
});

// ── Force majeure ─────────────────────────────────────────────────

test("force majeure: market and policy risk inside the clause is overbroad", () => {
  const doc = makeDoc(["不可抗力包括自然灾害、政府政策调整、市场价格波动、第三方原因等情形。"]);
  const { facts } = buildForceMajeureFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateForceMajeureRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("force majeure: statutory definition with notice duty is clean", () => {
  const doc = makeDoc([
    "不可抗力是指不能预见、不能避免且不能克服的客观情况。遭遇不可抗力的一方应及时通知对方并提供证明。",
  ]);
  const { facts } = buildForceMajeureFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateForceMajeureRule(facts).disposition).toBe("COMPLIANT");
});

// ── Liability cap ─────────────────────────────────────────────────

test("liability cap: a one-sided cap with no ceiling for the other party is flagged", () => {
  const doc = makeDoc(["乙方对甲方的赔偿责任累计不超过壹佰万元；但甲方对乙方不设赔偿上限。"]);
  const { facts } = buildLiabilityCapFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateLiabilityCapRule(facts).disposition).toBe("POLICY_CONFLICT");
});

test("liability cap: a symmetric cap is clean", () => {
  const doc = makeDoc(["任何一方的累计赔偿责任不超过合同总价的100%；故意、重大过失不受此限。"]);
  const { facts } = buildLiabilityCapFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateLiabilityCapRule(facts).disposition).toBe("COMPLIANT");
});

test("liability cap: a high-value contract with no cap asks for a human", () => {
  const doc = makeDoc(["合同总价为人民币陆佰万元整。"]);
  const { facts } = buildLiabilityCapFacts({ sourceRecordId: "s", document: doc });
  expect(evaluateLiabilityCapRule(facts).disposition).toBe("NEEDS_HUMAN_REVIEW");
});
