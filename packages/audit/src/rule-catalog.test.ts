import { expect, test } from "bun:test";
import { ENGINE_RULE_CODES, isEngineRuleCode } from "./rule-catalog";

test("catalog lists all 18 engine rule codes", () => {
  expect(ENGINE_RULE_CODES).toHaveLength(18);
});

test("rejects a code outside the catalog", () => {
  expect(isEngineRuleCode("PLAYWRIGHT_RULE_X")).toBe(false);
  expect(isEngineRuleCode("GHOST_RULE")).toBe(false);
});

test("accepts every engine rule code", () => {
  expect(isEngineRuleCode("ADVANCE_PAYMENT_LIMIT")).toBe(true);
  expect(isEngineRuleCode("SUBJECT_RED_LINE_RISK")).toBe(true);
  expect(isEngineRuleCode("LIABILITY_CAP_MISSING")).toBe(true);
});
