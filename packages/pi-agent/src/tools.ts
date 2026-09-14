import {
  readContractBlock,
  readContractDocument,
  SEARCH_DEFAULT_LIMIT,
  searchContractReport,
} from "@contract-audit/audit/contract-search";
import type {
  AuditSnapshot,
  EvidenceLocator,
  FindingProposal,
  FindingType,
} from "@contract-audit/audit/model";
import { assertProposalLegal } from "@contract-audit/audit/proposal-guard";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Every finding type the agent is allowed to submit.
 *
 * This list is the tool schema's source of truth and must cover `FindingType`
 * completely: a type missing here is a rule the agent can assess but cannot
 * report. `tools.test.ts` fails to compile if the union grows past this list.
 */
export const SUBMITTABLE_FINDING_TYPES = [
  "SUBJECT_RED_LINE_RISK",
  "ADVANCE_PAYMENT_POLICY_CONFLICT",
  "PENALTY_RATIO_POLICY_CONFLICT",
  "DISPUTE_JURISDICTION_CONFLICT",
  "PENALTY_CLAUSE_MISSING",
  "TERMINATION_CLAUSE_MISSING",
  "DISPUTE_CLAUSE_MISSING",
  "PERFORMANCE_BOND_RATIO_POLICY_CONFLICT",
  "PAYMENT_TERM_POLICY_CONFLICT",
  "BACK_TO_BACK_PAYMENT_CLAUSE",
  "DEPOSIT_RATIO_POLICY_CONFLICT",
  "WARRANTY_RETENTION_RATIO_POLICY_CONFLICT",
  "DISPUTE_RESOLUTION_CONFLICT",
  "BID_BOND_RATIO_POLICY_CONFLICT",
  "IP_OWNERSHIP_MISSING",
  "GUARANTEE_MODE_AMBIGUOUS",
  "CONFIDENTIALITY_PERIOD_MISSING",
  "FORCE_MAJEURE_OVERBROAD",
  "LIABILITY_CAP_MISSING",
  "PARTY_HISTORY_ASSOCIATION",
  "NEEDS_HUMAN_REVIEW",
] as const satisfies readonly FindingType[];

const searchQuerySchema = Type.Union([Type.String(), Type.Array(Type.String())]);

export function createAuditTools(
  snapshot: AuditSnapshot,
  onProposal: (proposal: FindingProposal) => void,
) {
  const findEvidence = (id: string): EvidenceLocator => {
    const evidence = snapshot.evidence.find((item) => item.id === id);
    if (!evidence) throw new Error(`UNKNOWN_EVIDENCE: ${id}`);
    return evidence;
  };

  return [
    defineTool({
      name: "get_rule_assessments",
      label: "Get Rule Assessments",
      description:
        "Returns every deterministic rule assessment for the current audit case, together with the evidence locators those assessments cite. These cannot be overridden. Do not call get_evidence for ids already in this payload.",
      parameters: Type.Object({}),
      execute: async () => {
        const payload = {
          assessments: snapshot.ruleAssessments,
          availableEvidenceIds: snapshot.evidence.map((item) => item.id),
          evidence: snapshot.evidence,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          details: payload,
        };
      },
    }),
    defineTool({
      name: "get_evidence",
      label: "Get Evidence",
      description:
        "Retrieves the cited evidence locators by ID. Skip this when get_rule_assessments already returned the locators.",
      parameters: Type.Object({ evidenceIds: Type.Array(Type.String()) }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: JSON.stringify(params.evidenceIds.map(findEvidence)) }],
        details: params.evidenceIds.map(findEvidence),
      }),
    }),
    defineTool({
      name: "get_contract_document",
      label: "Get Contract Document",
      description:
        "Returns every contract block's id and full text. Call at most once. When truncated is true, the payload is an outline of heading lines and you may search or read individual blocks.",
      parameters: Type.Object({}),
      execute: async () => {
        const view = readContractDocument(snapshot.contractDocument);
        return {
          content: [{ type: "text", text: JSON.stringify(view) }],
          details: view,
        };
      },
    }),
    defineTool({
      name: "search_contract",
      label: "Search Contract",
      description:
        "Case-insensitive literal search over the Contract Document. query may be one string or an OR-list. Returns at most one hit per block; truncated is true when more blocks matched than limit. An empty matches list means these tokens are absent, not that the clause is absent.",
      parameters: Type.Object({
        query: searchQuerySchema,
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, params) => {
        const report = searchContractReport(
          snapshot.contractDocument,
          params.query,
          params.limit ?? SEARCH_DEFAULT_LIMIT,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(report) }],
          details: report,
        };
      },
    }),
    defineTool({
      name: "read_contract_block",
      label: "Read Contract Block",
      description:
        "Returns one block's full text together with its previous and next block (null at document edges). Use only when get_contract_document was truncated.",
      parameters: Type.Object({ blockId: Type.String() }),
      execute: async (_toolCallId, params) => {
        const view = readContractBlock(snapshot.contractDocument, params.blockId);
        return {
          content: [{ type: "text", text: JSON.stringify(view) }],
          details: view,
        };
      },
    }),
    defineTool({
      name: "submit_finding_proposal",
      label: "Submit Finding Proposal",
      description:
        "Submits one finding proposal supported by the provided evidence. Call it once per violated dimension; call it not at all when every dimension is COMPLIANT.",
      parameters: Type.Object({
        findingType: Type.Union(SUBMITTABLE_FINDING_TYPES.map((value) => Type.Literal(value))),
        severity: Type.Union([Type.Literal("LOW"), Type.Literal("MEDIUM"), Type.Literal("HIGH")]),
        rationale: Type.String(),
        evidenceIds: Type.Array(Type.String()),
        remediation: Type.String(),
      }),
      execute: async (_toolCallId, params) => {
        params.evidenceIds.forEach(findEvidence);
        const proposal: FindingProposal = {
          findingType: params.findingType,
          severity: params.severity,
          rationale: params.rationale,
          evidenceIds: params.evidenceIds,
          remediation: params.remediation,
        };
        assertProposalLegal(proposal, snapshot.ruleAssessments);
        onProposal(proposal);
        return {
          content: [{ type: "text", text: '{"accepted":true}' }],
          details: { accepted: true },
        };
      },
    }),
  ];
}
