import type {
  AuditSnapshot,
  EvidenceLocator,
  FindingProposal,
  FindingType,
} from "@contract-audit/audit/model";
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
  "NEEDS_HUMAN_REVIEW",
] as const satisfies readonly FindingType[];

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
        "Returns every deterministic rule assessment for the current audit case. These cannot be overridden.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: JSON.stringify(snapshot.ruleAssessments) }],
        details: {
          assessments: snapshot.ruleAssessments,
          availableEvidenceIds: snapshot.evidence.map((item) => item.id),
        },
      }),
    }),
    defineTool({
      name: "get_evidence",
      label: "Get Evidence",
      description: "Retrieves the cited evidence locators by ID.",
      parameters: Type.Object({ evidenceIds: Type.Array(Type.String()) }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: JSON.stringify(params.evidenceIds.map(findEvidence)) }],
        details: params.evidenceIds.map(findEvidence),
      }),
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
        onProposal(proposal);
        return {
          content: [{ type: "text", text: '{"accepted":true}' }],
          details: { accepted: true },
        };
      },
    }),
  ];
}
