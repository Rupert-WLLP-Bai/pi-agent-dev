import { expect, test } from "bun:test";
import {
  buildDisputeJurisdictionFacts,
  DISPUTE_JURISDICTION_RULE_CODE,
  evaluateDisputeJurisdictionRule,
} from "./dispute-rule";
import { buildContractDocument } from "./document-ir";
import { createAuditSnapshot } from "./orchestrator";
import { evaluateAdvancePaymentRule } from "./payment-rule";
import {
  buildPenaltyRatioFacts,
  evaluatePenaltyRatioRule,
  PENALTY_RATIO_RULE_CODE,
} from "./penalty-rule";
import { normalizeContractDocument } from "./plaintext-adapter";
import {
  buildTerminationClauseFacts,
  evaluateTerminationClauseRule,
  TERMINATION_CLAUSE_RULE_CODE,
} from "./termination-rule";

const makeDoc = (texts: string[]) =>
  buildContractDocument(texts.map((text) => ({ text, kind: "paragraph" as const }))).document;

// ── Termination clause rule ───────────────────────────────────────

test("termination rule: COMPLIANT when a termination clause exists", () => {
  const doc = makeDoc([
    "设备采购合同",
    "甲方支付30%预付款。",
    "第八条 合同解除：任何一方违约，守约方有权解除本合同。",
  ]);
  const { facts, evidence } = buildTerminationClauseFacts({ sourceRecordId: "s1", document: doc });
  expect(facts.hasTerminationClause).toBe(true);
  expect(evidence).toHaveLength(1);
  expect(evidence[0].id).toBe("contract-termination");

  const assessment = evaluateTerminationClauseRule(facts);
  expect(assessment.disposition).toBe("COMPLIANT");
  expect(assessment.ruleCode).toBe(TERMINATION_CLAUSE_RULE_CODE);
});

test("termination rule: NEEDS_HUMAN_REVIEW when no termination clause", () => {
  const doc = makeDoc([
    "设备采购合同",
    "甲方支付30%预付款。",
    "乙方应于2026年10月31日前完成交付。",
  ]);
  const { facts } = buildTerminationClauseFacts({ sourceRecordId: "s1", document: doc });
  expect(facts.hasTerminationClause).toBe(false);

  const assessment = evaluateTerminationClauseRule(facts);
  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
  expect(assessment.evidenceIds).toEqual([]);
});

// ── Penalty ratio rule ────────────────────────────────────────────

test("penalty rule: POLICY_CONFLICT when penalty exceeds limit", () => {
  const doc = makeDoc([
    "设备采购合同",
    "第七条 违约责任：乙方逾期交付的，应向甲方支付合同总价50%的违约金。",
  ]);
  const { facts, evidence } = buildPenaltyRatioFacts({
    sourceRecordId: "s1",
    document: doc,
    policyPenaltyLimit: 0.3,
  });
  expect(facts.penaltyRatio).toBe(0.5);
  expect(evidence).toHaveLength(2);
  expect(evidence[0].id).toBe("contract-penalty");

  const assessment = evaluatePenaltyRatioRule(facts);
  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.ruleCode).toBe(PENALTY_RATIO_RULE_CODE);
  expect(assessment.basis).toContain("50%");
  expect(assessment.basis).toContain("30%");
});

test("penalty rule: COMPLIANT when penalty within limit", () => {
  const doc = makeDoc(["第七条 违约责任：乙方逾期交付的，应支付合同总价20%的违约金。"]);
  const { facts } = buildPenaltyRatioFacts({
    sourceRecordId: "s1",
    document: doc,
    policyPenaltyLimit: 0.3,
  });
  const assessment = evaluatePenaltyRatioRule(facts);
  expect(assessment.disposition).toBe("COMPLIANT");
});

test("penalty rule: NEEDS_HUMAN_REVIEW when no penalty clause", () => {
  const doc = makeDoc(["设备采购合同", "甲方支付30%预付款。"]);
  const { facts } = buildPenaltyRatioFacts({
    sourceRecordId: "s1",
    document: doc,
    policyPenaltyLimit: 0.3,
  });
  expect(facts.penaltyRatio).toBeNull();
  const assessment = evaluatePenaltyRatioRule(facts);
  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

// ── Dispute jurisdiction rule ─────────────────────────────────────

test("dispute rule: COMPLIANT when jurisdiction matches preferred", () => {
  const doc = makeDoc([
    "第九条 争议解决：本合同履行过程中发生争议的，双方应协商解决；协商不成的，向重庆仲裁委员会申请仲裁。",
  ]);
  const { facts, evidence } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.resolutionMethod).toBe("arbitration");
  expect(facts.jurisdiction).toBe("重庆");
  expect(evidence).toHaveLength(1);

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("COMPLIANT");
  expect(assessment.ruleCode).toBe(DISPUTE_JURISDICTION_RULE_CODE);
});

test("dispute rule: POLICY_CONFLICT when jurisdiction differs", () => {
  const doc = makeDoc(["第九条 争议解决：协商不成的，向北京人民法院提起诉讼。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.resolutionMethod).toBe("litigation");
  expect(facts.jurisdiction).toBe("北京");

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("POLICY_CONFLICT");
  expect(assessment.basis).toContain("北京");
  expect(assessment.basis).toContain("重庆");
});

test("dispute rule: NEEDS_HUMAN_REVIEW when no dispute clause", () => {
  const doc = makeDoc(["设备采购合同", "甲方支付30%预付款。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.resolutionMethod).toBeNull();
  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

// ── Dispute rule: referential and district phrasings (review findings) ──

test("dispute rule: 甲方所在地 is our side, not a garbled place name", () => {
  const doc = makeDoc(["第九条 争议解决：协商不成的，向甲方所在地人民法院提起诉讼。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.jurisdictionKind).toBe("REFERENTIAL_OUR_SIDE");

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("COMPLIANT");
  // The basis must never surface a truncated capture like「方所在地」.
  expect(assessment.basis).not.toContain("方所在地」");
});

test("dispute rule: 乙方所在地 flags the counterparty's home turf", () => {
  const doc = makeDoc(["第十条 争议解决：争议向乙方所在地人民法院提起诉讼。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.jurisdictionKind).toBe("REFERENTIAL_COUNTERPARTY");

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("POLICY_CONFLICT");
});

test("dispute rule: 合同签订地 is indeterminate and routed to a human", () => {
  const doc = makeDoc(["第九条 争议解决：向合同签订地人民法院提起诉讼。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.jurisdictionKind).toBe("INDETERMINATE");

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("dispute rule: a district inside our own city is not a remote jurisdiction", () => {
  const doc = makeDoc(["第九条 争议解决：向重庆市南岸区人民法院起诉。"]);
  const { facts } = buildDisputeJurisdictionFacts({
    sourceRecordId: "s1",
    document: doc,
    preferredJurisdiction: "重庆",
  });
  expect(facts.jurisdiction).toBe("重庆市南岸区");

  const assessment = evaluateDisputeJurisdictionRule(facts, "重庆");
  expect(assessment.disposition).toBe("COMPLIANT");
});

// ── Termination rule: non-clause mentions must not count (review finding) ──

test("termination rule: 不得解除保密义务 is a covenant, not a termination clause", () => {
  const doc = makeDoc(["第五条 保密义务：未经对方书面同意，任何一方不得解除保密义务。"]);
  const { facts } = buildTerminationClauseFacts({ sourceRecordId: "s1", document: doc });
  expect(facts.hasTerminationClause).toBe(false);

  const assessment = evaluateTerminationClauseRule(facts);
  expect(assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
});

test("termination rule: 终止供货 is stopping deliveries, not terminating the contract", () => {
  const doc = makeDoc(["第三条 交付：乙方如终止供货需提前30日书面通知甲方。"]);
  const { facts } = buildTerminationClauseFacts({ sourceRecordId: "s1", document: doc });
  expect(facts.hasTerminationClause).toBe(false);
});

test("termination rule: a body paragraph affirming 解除本合同 still counts", () => {
  const doc = makeDoc(["双方协商一致的，可以解除本合同。"]);
  const { facts } = buildTerminationClauseFacts({ sourceRecordId: "s1", document: doc });
  expect(facts.hasTerminationClause).toBe(true);
});

// ── Payment rule: no advance term must not mint phantom evidence ──

test("payment rule: no advance term yields only the policy-limit evidence", () => {
  const assessment = evaluateAdvancePaymentRule(
    { advancePaymentRatio: 0, policyLimitRatio: 0.3 },
    false,
  );
  expect(assessment.disposition).toBe("COMPLIANT");
  expect(assessment.evidenceIds).toEqual(["policy-limit"]);
  expect(assessment.basis).toContain("未约定预付款");
});

// ── Integration: orchestrator produces all 4 assessments ──────────

test("createAuditSnapshot includes all deterministic rule assessments", async () => {
  const doc = normalizeContractDocument(
    "设备采购合同\n\n甲方支付70%预付款。\n\n第七条 违约责任：支付合同总价50%的违约金。\n\n第九条 争议解决：向北京人民法院起诉。",
  );
  const snapshot = createAuditSnapshot({
    sourceRecordId: "integration",
    document: doc,
    policyLimitRatio: 0.3,
  });

  const codes = snapshot.ruleAssessments.map((a) => a.ruleCode);
  expect(codes).toContain("ADVANCE_PAYMENT_LIMIT");
  expect(codes).toContain("PENALTY_RATIO_LIMIT");
  expect(codes).toContain("TERMINATION_CLAUSE_PRESENT");
  expect(codes).toContain("DISPUTE_JURISDICTION");

  // No termination clause in this contract
  const termination = snapshot.ruleAssessments.find(
    (a) => a.ruleCode === "TERMINATION_CLAUSE_PRESENT",
  );
  expect(termination?.disposition).toBe("NEEDS_HUMAN_REVIEW");

  // Dispute jurisdiction is Beijing, not Chongqing
  const dispute = snapshot.ruleAssessments.find((a) => a.ruleCode === "DISPUTE_JURISDICTION");
  expect(dispute?.disposition).toBe("POLICY_CONFLICT");
});
