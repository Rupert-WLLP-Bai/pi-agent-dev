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
      findingType: "MADE_UP_RISK",
      severity: "HIGH",
      rationale: "理由",
      evidenceIds: [],
      remediation: "处理",
    }),
  ).toBe(false);
});
