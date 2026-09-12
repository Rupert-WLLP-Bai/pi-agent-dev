import { UnknownEvidenceError } from "@contract-audit/audit/model";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import type { AgentRunResult, AuditAgentPort } from "@contract-audit/audit/ports";

export class FakeAuditAgent implements AuditAgentPort {
  private readonly proposal: FindingProposal;

  constructor(proposal: FindingProposal) {
    this.proposal = proposal;
  }

  async run(input: AuditSnapshot, _signal: AbortSignal): Promise<AgentRunResult> {
    for (const evidenceId of this.proposal.evidenceIds) {
      const known = input.evidence.some((evidence) => evidence.id === evidenceId);
      if (!known) {
        throw new UnknownEvidenceError(`UNKNOWN_EVIDENCE: ${evidenceId}`);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    return {
      proposal: this.proposal,
      telemetry: { provider: "fake", model: "fake-agent", version: "0", usage: null },
    };
  }
}
