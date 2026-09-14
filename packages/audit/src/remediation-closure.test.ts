import { expect, test } from "bun:test";
import { closureHintFromDisposition } from "./remediation-closure";

test("closureHintFromDisposition maps dispositions", () => {
  expect(closureHintFromDisposition("COMPLIANT")).toBe("implemented");
  expect(closureHintFromDisposition("POLICY_CONFLICT")).toBe("open");
  expect(closureHintFromDisposition("NEEDS_HUMAN_REVIEW")).toBe("unknown");
});
