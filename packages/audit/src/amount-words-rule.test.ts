import { expect, test } from "bun:test";
import { buildAmountInWordsFacts, evaluateAmountInWordsRule } from "./amount-words-rule";
import { normalizeContractDocument } from "./plaintext-adapter";

const assess = (text: string) => {
  const analysis = buildAmountInWordsFacts({
    sourceRecordId: "src-1",
    document: normalizeContractDocument(text),
  });
  return { ...analysis, assessment: evaluateAmountInWordsRule(analysis.facts) };
};

test("the real 天翼五期 total agrees in both forms", () => {
  const { facts, assessment } = assess(
    "第四条 结算\n\n4.2 本协议项下最大发生金额（含税）为人民币壹佰玖拾捌万元整（1980000元）。",
  );

  expect(facts.words).toBe(1_980_000);
  expect(facts.figures).toBe(1_980_000);
  expect(assessment.disposition).toBe("COMPLIANT");
});

test("a mismatch is a policy conflict that names both amounts and the gap", () => {
  const { assessment } = assess("合同总价为人民币壹佰玖拾捌万元整（1890000元）。");

  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.basis).toContain("1980000");
  expect(assessment.basis).toContain("1890000");
  expect(assessment.basis).toContain("90000");
  // The written form controls under Chinese convention, which is why the gap is
  // a live dispute rather than a typo.
  expect(assessment.basis).toContain("大写为准");
});

test("the figure may precede the words, as 金额 tables often write it", () => {
  const { facts, assessment } = assess("合同金额：1980000 元（大写：壹佰玖拾捌万元整）");

  expect(facts.figures).toBe(1_980_000);
  expect(facts.words).toBe(1_980_000);
  expect(assessment.disposition).toBe("COMPLIANT");
});

test("the real 天翼五期 clause brackets both forms, which must not hide them", () => {
  // 人民币大写【壹佰玖拾捌万】元整，小写【1980000】元 — the bracket sits between
  // the figure and its 元, where it would otherwise hide the amount entirely.
  const { facts, assessment } = assess(
    "项目周期内，本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
  );

  expect(facts.words).toBe(1_980_000);
  expect(facts.figures).toBe(1_980_000);
  expect(assessment.disposition).toBe("COMPLIANT");
});

test("the real 中升智联 price-table total is read off 合计, figure first", () => {
  const { facts, assessment } = assess(
    "合计人民币（小写）：510374.8元整 合计人民币（大写）：伍拾壹万零叁佰柒拾肆元捌角",
  );

  expect(facts.words).toBe(510_374.8);
  expect(facts.figures).toBe(510_374.8);
  expect(assessment.disposition).toBe("COMPLIANT");
});

test("万元 in the figure form is scaled before comparing", () => {
  const { assessment } = assess("合同总价人民币壹佰玖拾捌万元整（198万元）。");

  expect(assessment.disposition).toBe("COMPLIANT");
});

test("the finding is anchored to the written amount in the original block", () => {
  const { evidence } = assess("合同总价为人民币壹佰玖拾捌万元整（1890000元）。");

  expect(evidence).toHaveLength(1);
  const location = evidence[0].location;
  if (location.kind !== "DOCUMENT_SPAN") throw new Error("expected a document span");
  expect(location.quotedText).toContain("壹佰玖拾捌万元整");
});

test("an amount stated only one way yields no comparison rather than a guess", () => {
  const { facts, assessment } = assess("合同总价为1980000元。");

  expect(facts.words).toBeNull();
  expect(assessment.disposition).toBe("COMPLIANT");
  expect(assessment.evidenceIds).toEqual([]);
  expect(assessment.basis).toContain("无可交叉校验");
});

test("a written amount far from any figure is not paired with an unrelated one", () => {
  // The figure belongs to a different clause; pairing them would manufacture a
  // mismatch the contract does not contain.
  const { facts } = assess(
    "第二条 合同总价为人民币壹佰玖拾捌万元整。\n\n第三条 履约保证金为100000元。",
  );

  expect(facts.figures).toBeNull();
});

test("a block with no amount label is not searched", () => {
  const { facts } = assess("乙方应在验收后交付壹佰台设备（100台）。");

  expect(facts.words).toBeNull();
  expect(facts.figures).toBeNull();
});

test("the smallest unit either form expresses is a cent, so rounding is not a conflict", () => {
  const { assessment } = assess("服务费总额为人民币壹佰元伍角（100.50元）。");

  expect(assessment.disposition).toBe("COMPLIANT");
});
