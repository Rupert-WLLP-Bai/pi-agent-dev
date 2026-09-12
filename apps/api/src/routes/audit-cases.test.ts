import { expect, test } from "bun:test";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { resolvePasteProvenance } from "./audit-cases";

/**
 * Provenance is a recorded fact, so the route resolves it from its own catalog
 * rather than from whatever the client claims. Only an unedited built-in
 * sample earns the DEMO label; everything else is an ordinary paste.
 */

const sample = demoContracts[0];

test("an unedited built-in sample is recorded as a demo", () => {
  expect(resolvePasteProvenance({ contractText: sample.text, demoId: sample.id })).toEqual({
    type: "DEMO",
    displayName: sample.title,
  });
});

test("a pasted submission without a sample id is a plain paste", () => {
  expect(resolvePasteProvenance({ contractText: "第一条 合同标的" })).toEqual({
    type: "TEXT_PASTE",
    displayName: null,
  });
});

test("an edited sample stops being a demo", () => {
  // The operator changed the text, so it no longer reproduces the catalog
  // entry: recording DEMO would misstate where the contract came from.
  expect(
    resolvePasteProvenance({
      contractText: `${sample.text}\n补充条款：质保期为二十四个月。`,
      demoId: sample.id,
    }),
  ).toEqual({ type: "TEXT_PASTE", displayName: null });
});

test("an unknown sample id is not trusted", () => {
  expect(resolvePasteProvenance({ contractText: sample.text, demoId: "not-a-sample" })).toEqual({
    type: "TEXT_PASTE",
    displayName: null,
  });
});

test("surrounding whitespace does not defeat the match", () => {
  // The drawer trims before submitting, so a trailing newline from a paste
  // must not silently downgrade a genuine sample load.
  expect(
    resolvePasteProvenance({ contractText: `  ${sample.text}  \n`, demoId: sample.id }),
  ).toEqual({ type: "DEMO", displayName: sample.title });
});
