import { expect, test } from "bun:test";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import { FakeAuditAgent } from "./fake-agent";
import { createSmokeTestSession } from "./runtime";

test("creates and disposes a Pi session under Bun", async () => {
  const session = await createSmokeTestSession();
  session.dispose();
});

test("rejects a proposal with an unknown evidence locator", async () => {
  const proposal: FindingProposal = {
    findingType: "NEEDS_HUMAN_REVIEW",
    severity: "HIGH",
    rationale: "Insufficient evidence",
    evidenceIds: ["unknown-id"],
    remediation: "Review manually",
  };
  const snapshot = {
    sourceRecordId: "source-1",
    contractDocument: { hash: "hash-1", blocks: [] },
    facts: { advancePaymentRatio: 0, policyLimitRatio: 0 },
    parties: [],
    evidence: [],
    ruleAssessments: [],
    createdAt: new Date(0).toISOString(),
  } satisfies AuditSnapshot;
  const agent = new FakeAuditAgent([proposal]);

  await expect(agent.run(snapshot, new AbortController().signal)).rejects.toThrow(
    "UNKNOWN_EVIDENCE: unknown-id",
  );
});

test("returns run telemetry alongside the proposal", async () => {
  const proposal: FindingProposal = {
    findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "Advance payment exceeds the policy limit",
    evidenceIds: ["contract-payment"],
    remediation: "Reduce the advance payment ratio",
  };
  const snapshot = {
    sourceRecordId: "source-1",
    contractDocument: { hash: "hash-1", blocks: [] },
    facts: { advancePaymentRatio: 0.7, policyLimitRatio: 0.3 },
    parties: [],
    evidence: [
      {
        id: "contract-payment",
        sourceRecordId: "source-1",
        location: {
          kind: "DOCUMENT_SPAN",
          contractDocumentHash: "hash-1",
          blockId: "p-1",
          startOffset: 0,
          endOffset: 3,
          quotedText: "70%",
        },
      },
    ],
    ruleAssessments: [
      {
        id: "assessment-payment",
        disposition: "POLICY_CONFLICT",
        ruleCode: "ADVANCE_PAYMENT_LIMIT",
        evidenceIds: ["contract-payment", "policy-limit"],
        basis: "预付款比例 70% 高于制度上限 30%。",
      },
    ],
    createdAt: new Date(0).toISOString(),
  } satisfies AuditSnapshot;
  const agent = new FakeAuditAgent([proposal]);

  const result = await agent.run(snapshot, new AbortController().signal);

  expect(result.proposals).toEqual([proposal]);
  expect(result.telemetry.provider).toBe("fake");
});
