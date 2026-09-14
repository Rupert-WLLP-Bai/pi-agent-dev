import { expect, test } from "bun:test";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import { FakeAuditAgent } from "./fake-agent";
import { createSmokeTestSession } from "./runtime";

/** Swallows every step: these tests are about the result, not the trace. */
const ignoreTrace = () => undefined;

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

  await expect(agent.run(snapshot, new AbortController().signal, ignoreTrace)).rejects.toThrow(
    "UNKNOWN_EVIDENCE: unknown-id",
  );
});

test("reports its identity and the proposals it produced", async () => {
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

  const result = await agent.run(snapshot, new AbortController().signal, ignoreTrace);

  expect(result.proposals).toEqual([proposal]);
  expect(agent.identity.provider).toBe("fake");
  expect(result.usage).toBeNull();
});

test("a needs-review case reads the contract once instead of surveying it", async () => {
  const proposal: FindingProposal = {
    findingType: "PENALTY_CLAUSE_MISSING",
    severity: "MEDIUM",
    rationale: "未读到违约金条款",
    evidenceIds: ["contract-penalty"],
    remediation: "补充违约责任条款",
  };
  const snapshot = {
    sourceRecordId: "source-1",
    contractDocument: {
      hash: "hash-1",
      blocks: [{ blockId: "p-1", text: "第一条 服务内容。", startOffset: 0, endOffset: 8 }],
    },
    facts: { advancePaymentRatio: 0.2, policyLimitRatio: 0.3 },
    parties: [],
    evidence: [
      {
        id: "contract-penalty",
        sourceRecordId: "source-1",
        location: {
          kind: "DOCUMENT_SPAN",
          contractDocumentHash: "hash-1",
          blockId: "p-1",
          startOffset: 0,
          endOffset: 3,
          quotedText: "第一条",
        },
      },
    ],
    ruleAssessments: [
      {
        id: "assessment-penalty",
        disposition: "NEEDS_HUMAN_REVIEW",
        ruleCode: "PENALTY_RATIO_LIMIT",
        evidenceIds: ["contract-penalty"],
        basis: "未读到违约金比例",
      },
    ],
    createdAt: new Date(0).toISOString(),
  } satisfies AuditSnapshot;
  const labels: string[] = [];
  const agent = new FakeAuditAgent([proposal]);
  await agent.run(snapshot, new AbortController().signal, (observation) => {
    labels.push(observation.label);
  });
  expect(labels.filter((label) => label === "get_contract_document")).toHaveLength(2);
  expect(labels).not.toContain("search_contract");
  expect(labels).not.toContain("read_contract_block");
  expect(labels).not.toContain("get_evidence");
});
