import { expect, test } from "bun:test";
import type { AuditSnapshot, FindingType } from "@contract-audit/audit/model";
import { Value } from "@sinclair/typebox/value";
import { createAuditTools, SUBMITTABLE_FINDING_TYPES } from "./tools";

const snapshot = {
  sourceRecordId: "source-1",
  contractDocument: { hash: "hash-1", blocks: [] },
  facts: { advancePaymentRatio: 0, policyLimitRatio: 0 },
  parties: [],
  evidence: [],
  ruleAssessments: [],
  createdAt: new Date(0).toISOString(),
} satisfies AuditSnapshot;

/**
 * Compile-time guard. `FindingType` is owned by the domain; this list is owned
 * by the submit tool. If the domain grows a finding type that the tool does not
 * list, this assignment stops compiling and names the missing member — a rule
 * the agent can assess but cannot report.
 */
type UncoveredFindingType = Exclude<FindingType, (typeof SUBMITTABLE_FINDING_TYPES)[number]>;
const listCoversDomain: UncoveredFindingType extends never ? true : UncoveredFindingType = true;

test("the submit tool lists every finding type the domain defines", () => {
  expect(listCoversDomain).toBe(true);
});

test("the submit tool accepts a proposal of every finding type", () => {
  const tools = createAuditTools(snapshot, () => undefined);
  const submit = tools.find((tool) => tool.name === "submit_finding_proposal");
  expect(submit).toBeDefined();
  if (!submit) return;

  const rejected = SUBMITTABLE_FINDING_TYPES.filter(
    (findingType) =>
      !Value.Check(submit.parameters, {
        assessmentId: "assessment-payment",
        findingType,
        severity: "HIGH",
        rationale: "理由",
        evidenceIds: [],
        remediation: "处理",
      }),
  );

  expect(rejected).toEqual([]);
});

test("the submit tool rejects a finding type outside the domain", () => {
  const tools = createAuditTools(snapshot, () => undefined);
  const submit = tools.find((tool) => tool.name === "submit_finding_proposal");
  expect(submit).toBeDefined();
  if (!submit) return;

  expect(
    Value.Check(submit.parameters, {
      assessmentId: "assessment-payment",
      findingType: "MADE_UP_RISK",
      severity: "HIGH",
      rationale: "理由",
      evidenceIds: [],
      remediation: "处理",
    }),
  ).toBe(false);
});

test("exposes the audit tools under their stable names", () => {
  const tools = createAuditTools(snapshot, () => undefined);
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "get_contract_document",
    "get_evidence",
    "get_rule_assessments",
    "read_contract_block",
    "search_contract",
    "submit_finding_proposal",
  ]);
});

test("the contract-reading tools accept their parameters and reject a wrong shape", () => {
  const tools = createAuditTools(snapshot, () => undefined);
  const search = tools.find((tool) => tool.name === "search_contract");
  const read = tools.find((tool) => tool.name === "read_contract_block");
  const document = tools.find((tool) => tool.name === "get_contract_document");
  expect(search).toBeDefined();
  expect(read).toBeDefined();
  expect(document).toBeDefined();
  if (!search || !read || !document) return;

  expect(Value.Check(search.parameters, { query: "预付款" })).toBe(true);
  expect(Value.Check(search.parameters, { query: ["预付款", "管辖"], limit: 3 })).toBe(true);
  expect(Value.Check(search.parameters, { query: "预付款", limit: 3 })).toBe(true);
  expect(Value.Check(search.parameters, { query: 1 })).toBe(false);
  expect(Value.Check(read.parameters, { blockId: "b1" })).toBe(true);
  expect(Value.Check(read.parameters, {})).toBe(false);
  expect(Value.Check(document.parameters, {})).toBe(true);
});

const populated = {
  ...snapshot,
  contractDocument: {
    hash: "hash-1",
    blocks: [
      { blockId: "p-1", text: "第一条 预付款 50%。", startOffset: 0, endOffset: 12 },
      { blockId: "p-2", text: "第二条 预付款于验收后支付。", startOffset: 12, endOffset: 26 },
      { blockId: "p-3", text: "第八条 争议由成都法院管辖。", startOffset: 26, endOffset: 40 },
    ],
  },
  evidence: [
    {
      id: "ev-1",
      sourceRecordId: "source-1",
      location: {
        kind: "DOCUMENT_SPAN" as const,
        contractDocumentHash: "hash-1",
        blockId: "p-1",
        startOffset: 0,
        endOffset: 4,
        quotedText: "预付款",
      },
    },
  ],
  ruleAssessments: [
    {
      id: "a-1",
      disposition: "POLICY_CONFLICT" as const,
      ruleCode: "ADVANCE_PAYMENT_LIMIT" as const,
      evidenceIds: ["ev-1"],
      basis: "预付款超限",
    },
  ],
} satisfies AuditSnapshot;

/**
 * Pi SDK's ToolDefinition.execute requires five args; our tools ignore the last
 * three. Cast once here so the call sites stay readable.
 */
type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: undefined,
  ctx: object,
) => Promise<{ content: unknown; details: unknown }>;

async function runTool(
  tool: { execute: ToolExecute },
  params: unknown,
): Promise<{ content: unknown; details: unknown }> {
  return tool.execute("call-1", params, undefined, undefined, {});
}

test("get_rule_assessments inlines the evidence locators", async () => {
  const tools = createAuditTools(populated, () => undefined);
  const assessments = tools.find((tool) => tool.name === "get_rule_assessments");
  expect(assessments).toBeDefined();
  if (!assessments) return;
  const result = await runTool(assessments as { execute: ToolExecute }, {});
  const payload = {
    assessments: populated.ruleAssessments,
    availableEvidenceIds: ["ev-1"],
    evidence: populated.evidence,
  };
  expect(result.details).toMatchObject(payload);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
});

test("get_contract_document returns every block under the budget", async () => {
  const tools = createAuditTools(populated, () => undefined);
  const documentTool = tools.find((tool) => tool.name === "get_contract_document");
  expect(documentTool).toBeDefined();
  if (!documentTool) return;
  const result = await runTool(documentTool as { execute: ToolExecute }, {});
  expect(result.details).toMatchObject({
    truncated: false,
    blocks: populated.contractDocument.blocks.map((block) => ({
      blockId: block.blockId,
      text: block.text,
    })),
  });
});

test("search_contract reports one hit per block and a truncated flag", async () => {
  const tools = createAuditTools(populated, () => undefined);
  const search = tools.find((tool) => tool.name === "search_contract");
  expect(search).toBeDefined();
  if (!search) return;
  const result = await runTool(search as { execute: ToolExecute }, {
    query: "预付款",
    limit: 1,
  });
  expect(result.details).toMatchObject({
    truncated: true,
    matches: [{ blockId: "p-1" }],
  });
});
