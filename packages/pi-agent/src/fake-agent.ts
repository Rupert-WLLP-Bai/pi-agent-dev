import {
  type ContractSearchMatch,
  readContractBlock,
  SEARCH_DEFAULT_LIMIT,
  searchContract,
} from "@contract-audit/audit/contract-search";
import type {
  AgentTraceObservation,
  AuditSnapshot,
  EvidenceLocator,
  FindingProposal,
  RuleAssessment,
} from "@contract-audit/audit/model";
import { UnknownEvidenceError } from "@contract-audit/audit/model";
import type {
  AgentRunIdentity,
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
} from "@contract-audit/audit/ports";
import { assertProposalLegal, searchKeywordFor } from "@contract-audit/audit/proposal-guard";

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
 * The block the fake reads while reviewing an abstaining rule: the first search
 * hit when the clause exists under some wording, else the first block a cited
 * document span points at, else the document's first block. Resolving through
 * the search result first is the point — a reworded clause is found, not missed.
 */
function reviewBlockId(
  snapshot: AuditSnapshot,
  assessment: RuleAssessment,
  matches: ContractSearchMatch[],
): string | null {
  const fromSearch = matches[0]?.blockId;
  if (
    fromSearch !== undefined &&
    snapshot.contractDocument.blocks.some((block) => block.blockId === fromSearch)
  ) {
    return fromSearch;
  }
  for (const id of assessment.evidenceIds) {
    const evidence = snapshot.evidence.find((item) => item.id === id);
    const location = evidence?.location;
    if (location?.kind !== "DOCUMENT_SPAN") continue;
    if (snapshot.contractDocument.blocks.some((block) => block.blockId === location.blockId)) {
      return location.blockId;
    }
  }
  return snapshot.contractDocument.blocks[0]?.blockId ?? null;
}

/**
 * The offline stand-in for the Pi agent, used by the acceptance suite and by
 * `AUDIT_AGENT_MODE=fake`.
 *
 * It reports the same trace shape the Pi agent reports, because it genuinely
 * performs the same work: consult the rule assessments, read the contract for
 * every dimension the rules could not settle, review the evidence each
 * violation cites, then submit one proposal per violation. A fake that skipped
 * those steps would make the trace view untestable, and a fake that invented
 * steps would make it dishonest.
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

    // Review each abstaining rule by reading the contract: search for the
    // rule's keyword, then read the block that answers it. The fake does not
    // judge the result — a human does — but the reading is real and shows up
    // in the trace, which is what makes the vision path testable offline.
    for (const assessment of input.ruleAssessments) {
      if (assessment.disposition !== "NEEDS_HUMAN_REVIEW") continue;

      const query = searchKeywordFor(assessment.ruleCode);
      const searchCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "search_contract",
          ref: searchCall,
          input: { query, limit: SEARCH_DEFAULT_LIMIT },
        }),
      );
      const matches = searchContract(input.contractDocument, query, SEARCH_DEFAULT_LIMIT);
      trace(
        step({ kind: "TOOL_RESULT", label: "search_contract", ref: searchCall, output: matches }),
      );

      const blockId = reviewBlockId(input, assessment, matches);
      if (blockId === null) continue;
      const readCall = nextCallId();
      trace(
        step({
          kind: "TOOL_CALL",
          label: "read_contract_block",
          ref: readCall,
          input: { blockId },
        }),
      );
      trace(
        step({
          kind: "TOOL_RESULT",
          label: "read_contract_block",
          ref: readCall,
          output: readContractBlock(input.contractDocument, blockId),
        }),
      );
    }

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
      try {
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
