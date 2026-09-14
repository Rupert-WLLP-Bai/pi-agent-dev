import { readContractDocument } from "@contract-audit/audit/contract-search";
import type {
  AgentTraceObservation,
  AuditSnapshot,
  EvidenceLocator,
  FindingProposal,
} from "@contract-audit/audit/model";
import { UnknownEvidenceError } from "@contract-audit/audit/model";
import type {
  AgentRunIdentity,
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
} from "@contract-audit/audit/ports";
import { assertProposalLegal } from "@contract-audit/audit/proposal-guard";

/** Builds a step, defaulting the fields this agent never sets. */
function step(
  fields: Partial<AgentTraceObservation> & Pick<AgentTraceObservation, "kind" | "label">,
): AgentTraceObservation {
  return {
    at: new Date().toISOString(),
    ref: null,
    input: null,
    output: null,
    isError: false,
    durationMs: null,
    tokens: null,
    ...fields,
  };
}

/**
 * The offline stand-in for the Pi agent, used by the acceptance suite and by
 * `AUDIT_AGENT_MODE=fake`.
 *
 * It reports the same trace shape the Pi agent is instructed to report:
 * assessments (with locators inline), one full-document read when any rule
 * abstained, then one submit per violation. A fake that skipped those steps
 * would make the trace view untestable; a fake that invented extra searches
 * would make it dishonest.
 */
export class FakeAuditAgent implements AuditAgentPort {
  readonly identity: AgentRunIdentity = { provider: "fake", model: "fake-agent", version: "0" };

  private readonly proposals: FindingProposal[];

  constructor(proposals: FindingProposal[]) {
    this.proposals = proposals;
  }

  async run(
    input: AuditSnapshot,
    _signal: AbortSignal,
    trace: AgentTraceSink,
  ): Promise<AgentRunResult> {
    let calls = 0;
    const nextCallId = () => `fake-call-${++calls}`;

    const findEvidence = (id: string): EvidenceLocator => {
      const evidence = input.evidence.find((item) => item.id === id);
      if (!evidence) {
        throw new UnknownEvidenceError(`UNKNOWN_EVIDENCE: ${id}`);
      }
      return evidence;
    };

    const knownEvidenceIds = new Set(input.evidence.map((item) => item.id));

    trace(step({ kind: "STAGE", label: "RUN_STARTED" }));

    const assessmentCall = nextCallId();
    trace(step({ kind: "TOOL_CALL", label: "get_rule_assessments", ref: assessmentCall }));
    trace(
      step({
        kind: "TOOL_RESULT",
        label: "get_rule_assessments",
        ref: assessmentCall,
        output: {
          assessments: input.ruleAssessments,
          availableEvidenceIds: input.evidence.map((item) => item.id),
          evidence: input.evidence,
        },
      }),
    );

    const needsReview = input.ruleAssessments.some(
      (assessment) => assessment.disposition === "NEEDS_HUMAN_REVIEW",
    );
    if (needsReview) {
      const documentCall = nextCallId();
      trace(step({ kind: "TOOL_CALL", label: "get_contract_document", ref: documentCall }));
      trace(
        step({
          kind: "TOOL_RESULT",
          label: "get_contract_document",
          ref: documentCall,
          output: readContractDocument(input.contractDocument),
        }),
      );
    }

    const missingIds = [
      ...new Set(this.proposals.flatMap((proposal) => proposal.evidenceIds)),
    ].filter((id) => !knownEvidenceIds.has(id));
    if (missingIds.length > 0) {
      const evidenceCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "get_evidence",
          ref: evidenceCall,
          input: { evidenceIds: missingIds },
        }),
      );
      try {
        missingIds.forEach(findEvidence);
      } catch (error) {
        // Show the failed call in the trace before failing the run — that is
        // what an operator needs to see when an audit dies mid-flight.
        trace(
          step({
            kind: "TOOL_RESULT",
            label: "get_evidence",
            ref: evidenceCall,
            output: error instanceof Error ? error.message : String(error),
            isError: true,
          }),
        );
        throw error;
      }
    }

    for (const proposal of this.proposals) {
      const submitCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "submit_finding_proposal",
          ref: submitCall,
          input: { ...proposal },
        }),
      );
      try {
        proposal.evidenceIds.forEach(findEvidence);
        assertProposalLegal(proposal, input.ruleAssessments);
      } catch (error) {
        // The submission boundary rejected the proposal: show the failed call
        // before failing the run, exactly as the real submit tool would.
        trace(
          step({
            kind: "TOOL_RESULT",
            label: "submit_finding_proposal",
            ref: submitCall,
            output: error instanceof Error ? error.message : String(error),
            isError: true,
          }),
        );
        throw error;
      }
      trace(
        step({
          kind: "TOOL_RESULT",
          label: "submit_finding_proposal",
          ref: submitCall,
          output: { accepted: true },
        }),
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    trace(step({ kind: "STAGE", label: "RUN_COMPLETED" }));
    return { proposals: this.proposals, usage: null };
  }
}
