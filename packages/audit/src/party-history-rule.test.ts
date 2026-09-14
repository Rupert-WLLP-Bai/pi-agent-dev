import { expect, test } from "bun:test";
import type { ContractParty } from "./model";
import {
  counterpartyCreditCodes,
  counterpartyNames,
  evaluatePartyHistoryRule,
  PARTY_HISTORY_RULE_CODE,
  type PriorPartyFinding,
} from "./party-history-rule";

const party = (id: string, name: string, label = "乙方"): ContractParty => ({
  id,
  label,
  name,
  evidenceId: `${id}-name`,
});

const prior = (
  overrides: Partial<PriorPartyFinding> & Pick<PriorPartyFinding, "decision">,
): PriorPartyFinding => ({
  priorCaseId: "case-old",
  sourceRecordId: "source-old",
  partyName: "成都建工集团有限公司",
  findingRevisionId: "finding-old",
  findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
  reviewerId: "张三",
  reviewedAt: "2026-06-14T08:00:00.000Z",
  title: "重型设备租赁合同",
  ...overrides,
});

test("reports COMPLIANT with no evidence when there is no party history", () => {
  const run = evaluatePartyHistoryRule({
    parties: [party("p1", "成都建工集团有限公司")],
    priorFindings: [],
  });

  expect(run.assessment).toEqual({
    id: "assessment-party-history",
    ruleCode: PARTY_HISTORY_RULE_CODE,
    disposition: "COMPLIANT",
    evidenceIds: [],
    basis: "未发现同一相对方的历史审核记录。",
  });
  expect(run.evidence).toEqual([]);
  expect(run.hits).toEqual([]);
});

test("reports COMPLIANT when the contract names no parties", () => {
  const run = evaluatePartyHistoryRule({
    parties: [],
    priorFindings: [prior({ decision: "ACCEPTED" })],
  });

  expect(run.assessment.disposition).toBe("COMPLIANT");
  expect(run.evidence).toEqual([]);
});

test("flags an ACCEPTED prior finding even when the current contract is otherwise clean", () => {
  const run = evaluatePartyHistoryRule({
    parties: [party("p1", "成都建工集团有限公司")],
    priorFindings: [prior({ decision: "ACCEPTED" })],
  });

  expect(run.assessment.disposition).toBe("POLICY_CONFLICT");
  expect(run.assessment.ruleCode).toBe("PARTY_HISTORY_ASSOCIATION");
  expect(run.assessment.basis).toContain("成都建工集团有限公司");
  expect(run.assessment.basis).toContain("张三");
  expect(run.evidence).toHaveLength(1);
  expect(run.evidence[0]?.location).toMatchObject({
    kind: "PRIOR_CASE_RECORD",
    priorCaseId: "case-old",
    findingRevisionId: "finding-old",
    partyName: "成都建工集团有限公司",
    findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
    decision: "ACCEPTED",
    reviewerId: "张三",
  });
  expect(run.hits).toHaveLength(1);
  expect(run.hits[0]?.priorCaseId).toBe("case-old");
});

test("asks for human review when history is only REJECTED false positives", () => {
  const run = evaluatePartyHistoryRule({
    parties: [party("p1", "杭州智联科技有限公司")],
    priorFindings: [
      prior({
        partyName: "杭州智联科技有限公司",
        decision: "REJECTED",
        reviewerId: "王芳",
      }),
    ],
  });

  expect(run.assessment.disposition).toBe("NEEDS_HUMAN_REVIEW");
  expect(run.assessment.basis).toContain("误报");
  expect(run.evidence[0]?.location).toMatchObject({
    kind: "PRIOR_CASE_RECORD",
    decision: "REJECTED",
  });
});

test("an ACCEPTED finding outranks REJECTED history on the same party", () => {
  const run = evaluatePartyHistoryRule({
    parties: [party("p1", "成都建工集团有限公司")],
    priorFindings: [
      prior({ decision: "REJECTED", findingRevisionId: "finding-reject" }),
      prior({ decision: "ACCEPTED", findingRevisionId: "finding-accept" }),
    ],
  });

  expect(run.assessment.disposition).toBe("POLICY_CONFLICT");
  expect(run.assessment.evidenceIds).toContain("history-case-old-finding-accept");
});

test("counterpartyNames prefers 乙方 over 甲方 so our own entity is not linked", () => {
  expect(
    counterpartyNames([
      party("a", "重庆华盛贸易有限公司", "甲方"),
      party("b", "成都建工集团有限公司", "乙方"),
    ]),
  ).toEqual(["成都建工集团有限公司"]);
});

test("counterpartyNames falls back to every named party when no 乙方 is present", () => {
  expect(counterpartyNames([party("a", "昆明矿业发展有限公司", "甲方")])).toEqual([
    "昆明矿业发展有限公司",
  ]);
});

test("counterpartyCreditCodes ignores 甲方 so our own USCC is not a join key", () => {
  expect(
    counterpartyCreditCodes(
      [party("a", "重庆华盛贸易有限公司", "甲方"), party("b", "成都建工集团有限公司", "乙方")],
      [
        { partyId: "a", matched: { unifiedSocialCreditCode: "91500103MA5U9T8L2B" } },
        { partyId: "b", matched: { unifiedSocialCreditCode: "91510100MA6C2W9H4K" } },
      ],
    ),
  ).toEqual(["91510100MA6C2W9H4K"]);
});
