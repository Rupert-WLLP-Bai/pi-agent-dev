import { expect, test } from "bun:test";
import { diffAdjacentRevisionFindings } from "./revision-finding-diff";

test("diffAdjacentRevisionFindings classifies introduced, resolved, and persisting", () => {
  const prior = [
    {
      ruleCode: "ADVANCE_PAYMENT_LIMIT" as const,
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT" as const,
      severity: "HIGH" as const,
    },
    {
      ruleCode: "PENALTY_RATIO_LIMIT" as const,
      findingType: "PENALTY_RATIO_POLICY_CONFLICT" as const,
      severity: "HIGH" as const,
    },
  ];
  const next = [
    {
      ruleCode: "ADVANCE_PAYMENT_LIMIT" as const,
      findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT" as const,
      severity: "HIGH" as const,
    },
    {
      ruleCode: "DEPOSIT_RATIO_LIMIT" as const,
      findingType: "DEPOSIT_RATIO_POLICY_CONFLICT" as const,
      severity: "MEDIUM" as const,
    },
  ];

  const diff = diffAdjacentRevisionFindings(prior, next);
  expect(diff.persisting.map((item) => item.ruleCode)).toEqual(["ADVANCE_PAYMENT_LIMIT"]);
  expect(diff.resolved.map((item) => item.ruleCode)).toEqual(["PENALTY_RATIO_LIMIT"]);
  expect(diff.introduced.map((item) => item.ruleCode)).toEqual(["DEPOSIT_RATIO_LIMIT"]);
});
