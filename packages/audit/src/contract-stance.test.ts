import { expect, test } from "bun:test";
import {
  type ContractStance,
  getContractStanceLabel,
  inferContractStance,
  isRuleApplicableInStance,
  RULE_STANCE_APPLICABILITY,
} from "./contract-stance";
import type { ContractParty, RuleCode } from "./model";
import { createAuditSnapshot } from "./orchestrator";
import { normalizeContractDocument } from "./plaintext-adapter";
import { ENGINE_RULE_CODES } from "./rule-catalog";

const OUR_NAMES = ["中国移动通信集团重庆有限公司", "重庆移动"];

const party = (label: string, name: string, id = label): ContractParty => ({
  id,
  label,
  name,
  evidenceId: `ev-${id}`,
});

/**
 * The real 天翼五期 shape: our organization is 乙方 in the revenue contract and
 * 甲方 in the procurement contract signed to deliver it.
 */
const REVENUE_CONTRACT = `甲方：天翼数智科技（北京）有限公司
乙方：中国移动通信集团重庆有限公司

第三条 付款方式
甲方应于本协议签订后向乙方支付预付款，金额为合同总价的50%。

第九条 争议解决
因本协议引起的争议，提交上海市虹口区人民法院诉讼。`;

const PROCUREMENT_CONTRACT = `甲方：中国移动通信集团重庆有限公司
乙方：北京元通数智科技有限公司

第三条 付款方式
甲方应于本协议签订后向乙方支付预付款，金额为合同总价的50%。`;

test("our organization as 乙方 means the contract earns revenue", () => {
  const inferred = inferContractStance({
    parties: [party("甲方", "天翼数智科技（北京）有限公司"), party("乙方", "重庆移动")],
    ownOrganizationNames: OUR_NAMES,
  });

  expect(inferred.stance).toBe("revenue");
  expect(inferred.decidedByPartyId).toBe("乙方");
  expect(inferred.basis).toContain("收款方");
});

test("our organization as 甲方 means the contract spends", () => {
  const inferred = inferContractStance({
    parties: [party("甲方", "重庆移动"), party("乙方", "北京元通数智科技有限公司")],
    ownOrganizationNames: OUR_NAMES,
  });

  expect(inferred.stance).toBe("procurement");
  expect(inferred.basis).toContain("付款方");
});

test("role synonyms decide the stance the same way as 甲方 and 乙方", () => {
  const supplier = inferContractStance({
    parties: [party("需方", "某银行"), party("供方", "重庆移动")],
    ownOrganizationNames: OUR_NAMES,
  });
  expect(supplier.stance).toBe("revenue");

  const buyer = inferContractStance({
    parties: [party("发包方", "重庆移动"), party("承包方", "某供应商")],
    ownOrganizationNames: OUR_NAMES,
  });
  expect(buyer.stance).toBe("procurement");
});

test("a contract our organization is not party to leaves the stance unjudged", () => {
  const inferred = inferContractStance({
    parties: [party("甲方", "某银行"), party("乙方", "某供应商")],
    ownOrganizationNames: OUR_NAMES,
  });

  expect(inferred.stance).toBeNull();
  expect(inferred.basis).toContain("未出现本方主体");
});

test("our organization on both sides is not reduced to one direction", () => {
  const inferred = inferContractStance({
    parties: [party("甲方", "重庆移动"), party("乙方", "中国移动通信集团重庆有限公司")],
    ownOrganizationNames: OUR_NAMES,
  });

  // Guessing here would silence rules on purpose; an internal contract has no
  // single side of the money.
  expect(inferred.stance).toBeNull();
  expect(inferred.basis).toContain("立场不唯一");
});

test("the same party named 委托方 in one clause and 甲方 in another is one stance", () => {
  // The real 天翼五期 procurement contract writes 委托方（甲方）and the extractor
  // reports both mentions. Both mean the buyer, so the direction is not in doubt.
  const inferred = inferContractStance({
    parties: [
      party("委托方", "中国移动通信集团重庆有限公司两江新区分公司"),
      party("受托方", "北京元通数智科技有限公司"),
      party("甲方", "中国移动通信集团重庆有限公司两江新区分公司"),
    ],
    ownOrganizationNames: OUR_NAMES,
  });

  expect(inferred.stance).toBe("procurement");
});

test("an unrecognised party label leaves the stance unjudged rather than guessing", () => {
  const inferred = inferContractStance({
    parties: [party("丙方", "重庆移动")],
    ownOrganizationNames: OUR_NAMES,
  });

  expect(inferred.stance).toBeNull();
  expect(inferred.basis).toContain("无法判定收付方向");
});

test("without our own name configured no stance is claimed", () => {
  const inferred = inferContractStance({
    parties: [party("乙方", "重庆移动")],
    ownOrganizationNames: [],
  });

  expect(inferred.stance).toBeNull();
  expect(inferred.decidedByPartyId).toBeNull();
});

test("every rule declares at least one stance and a rationale", () => {
  for (const code of ENGINE_RULE_CODES) {
    const applicability = RULE_STANCE_APPLICABILITY[code];
    expect(applicability.stances.length).toBeGreaterThan(0);
    // A rationale is what a reviewer argues with; an empty one makes the
    // scoping unchallengeable.
    expect(applicability.rationale.length).toBeGreaterThan(10);
  }
});

test("an advance-payment cap holds when we pay and not when we are paid", () => {
  expect(isRuleApplicableInStance("ADVANCE_PAYMENT_LIMIT", "procurement")).toBe(true);
  expect(isRuleApplicableInStance("ADVANCE_PAYMENT_LIMIT", "revenue")).toBe(false);
});

test("an unjudged stance applies every rule rather than narrowing the audit", () => {
  for (const code of ENGINE_RULE_CODES) {
    expect(isRuleApplicableInStance(code, null)).toBe(true);
  }
});

const assessmentFor = (
  snapshot: ReturnType<typeof createAuditSnapshot>,
  code: RuleCode,
): { disposition: string; basis: string; evidenceIds: string[] } => {
  const found = snapshot.ruleAssessments.find((assessment) => assessment.ruleCode === code);
  if (!found) throw new Error(`no assessment for ${code}`);
  return found;
};

const snapshotFor = (text: string, stance?: ContractStance) =>
  createAuditSnapshot({
    sourceRecordId: "src-1",
    document: normalizeContractDocument(text),
    ownOrganizationNames: OUR_NAMES,
    ...(stance === undefined ? {} : { declaredStance: stance }),
  });

test("a 50% advance we receive is not a violation, and says why it was skipped", () => {
  const snapshot = snapshotFor(REVENUE_CONTRACT);

  expect(snapshot.stance?.stance).toBe("revenue");
  expect(snapshot.stance?.source).toBe("inferred");

  const advance = assessmentFor(snapshot, "ADVANCE_PAYMENT_LIMIT");
  expect(advance.disposition).toBe("NOT_APPLICABLE");
  expect(advance.basis).toContain("预付比例上限保护付款方");
  // The stance's own reasoning travels with the skipped rule, so a reviewer can
  // see what decided it.
  expect(advance.basis).toContain("收款方");
  // No evidence is cited for a judgement that never happened.
  expect(advance.evidenceIds).toEqual([]);
});

test("the same 50% advance we pay is still a violation", () => {
  const snapshot = snapshotFor(PROCUREMENT_CONTRACT);

  expect(snapshot.stance?.stance).toBe("procurement");
  expect(assessmentFor(snapshot, "ADVANCE_PAYMENT_LIMIT").disposition).toBe("POLICY_CONFLICT");
});

test("a rule valid in both stances is judged normally in either", () => {
  for (const text of [REVENUE_CONTRACT, PROCUREMENT_CONTRACT]) {
    expect(assessmentFor(snapshotFor(text), "DISPUTE_JURISDICTION").disposition).not.toBe(
      "NOT_APPLICABLE",
    );
  }
});

test("a declared stance overrides what the parties would imply", () => {
  // The text reads as revenue; the caller states otherwise, as a filename
  // marked 【支出合同】 would.
  const snapshot = snapshotFor(REVENUE_CONTRACT, "procurement");

  expect(snapshot.stance?.stance).toBe("procurement");
  expect(snapshot.stance?.source).toBe("declared");
  expect(assessmentFor(snapshot, "ADVANCE_PAYMENT_LIMIT").disposition).toBe("POLICY_CONFLICT");
});

test("without our own name the audit runs unnarrowed, as it did before stance existed", () => {
  const snapshot = createAuditSnapshot({
    sourceRecordId: "src-1",
    document: normalizeContractDocument(REVENUE_CONTRACT),
  });

  expect(snapshot.stance?.stance).toBeNull();
  expect(
    snapshot.ruleAssessments.every((assessment) => assessment.disposition !== "NOT_APPLICABLE"),
  ).toBe(true);
});

test("stance labels render for a reviewer, including the unjudged case", () => {
  expect(getContractStanceLabel("revenue")).toBe("收入合同");
  expect(getContractStanceLabel("procurement")).toBe("支出合同");
  expect(getContractStanceLabel(null)).toBe("立场未判定");
});
