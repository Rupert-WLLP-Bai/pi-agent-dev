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
 * It reports the same trace shape the Pi agent reports, because it genuinely
 * performs the same work: consult the rule assessments, review the evidence
 * each violated dimension cites, then submit one proposal per violation. A
 * fake that skipped those steps would make the trace view untestable, and a
 * fake that invented steps would make it dishonest.
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
        },
      }),
    );

    for (const proposal of this.proposals) {
      const evidenceCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "get_evidence",
          ref: evidenceCall,
          input: { evidenceIds: proposal.evidenceIds },
        }),
      );
      let resolved: EvidenceLocator[];
      try {
        resolved = proposal.evidenceIds.map(findEvidence);
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
      trace(
        step({
          kind: "TOOL_RESULT",
          label: "get_evidence",
          ref: evidenceCall,
          output: resolved,
        }),
      );

      const submitCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "submit_finding_proposal",
          ref: submitCall,
          input: { ...proposal },
        }),
      );
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
