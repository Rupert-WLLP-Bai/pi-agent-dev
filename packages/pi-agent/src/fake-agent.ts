import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import { UnknownEvidenceError } from "@contract-audit/audit/model";
import type { AgentRunResult, AuditAgentPort } from "@contract-audit/audit/ports";

export class FakeAuditAgent implements AuditAgentPort {
  private readonly proposals: FindingProposal[];

  constructor(proposals: FindingProposal[]) {
    this.proposals = proposals;
  }

  async run(input: AuditSnapshot, _signal: AbortSignal): Promise<AgentRunResult> {
    for (const proposal of this.proposals) {
      for (const evidenceId of proposal.evidenceIds) {
        const known = input.evidence.some((evidence) => evidence.id === evidenceId);
        if (!known) {
          throw new UnknownEvidenceError(`UNKNOWN_EVIDENCE: ${evidenceId}`);
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    return {
      proposals: this.proposals,
      telemetry: { provider: "fake", model: "fake-agent", version: "0", usage: null },
    };
  }
}
