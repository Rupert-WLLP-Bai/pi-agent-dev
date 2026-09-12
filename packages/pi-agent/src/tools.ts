import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AuditSnapshot, EvidenceLocator, FindingProposal } from "@contract-audit/audit/model";

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
      description: "Submits a finding proposal supported by the provided evidence.",
      parameters: Type.Object({
        findingType: Type.Union([
          Type.Literal("ADVANCE_PAYMENT_POLICY_CONFLICT"),
          Type.Literal("SUBJECT_RED_LINE_RISK"),
          Type.Literal("NEEDS_HUMAN_REVIEW"),
        ]),
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
        return { content: [{ type: "text", text: '{"accepted":true}' }], details: { accepted: true } };
      },
    }),
  ];
}
