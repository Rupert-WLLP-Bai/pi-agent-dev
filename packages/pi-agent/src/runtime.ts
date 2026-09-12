import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import type { AgentRunResult, AuditAgentPort } from "@contract-audit/audit/ports";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildModel, createModelRuntime, loadPiConfig, PI_AGENT_VERSION } from "./config";
import { createAuditTools } from "./tools";

const AUDIT_TOOL_NAMES = [
  "get_rule_assessments",
  "get_evidence",
  "submit_finding_proposal",
] as const;

/** Loads the payment-terms-audit skill markdown next to this module. */
function loadSkillPrompt(): string {
  const raw = readFileSync(join(import.meta.dir, "payment-terms-audit.skill.md"), "utf8");
  const frontmatter = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
}

export class PiAuditAgent implements AuditAgentPort {
  async run(input: AuditSnapshot, signal: AbortSignal): Promise<AgentRunResult> {
    signal.throwIfAborted();
    const config = loadPiConfig();
    const modelRuntime = await createModelRuntime(config);

    let proposal: FindingProposal | undefined;
    const tools = createAuditTools(input, (value) => {
      proposal = value;
    });

    const { session } = await createAgentSession({
      model: buildModel(config),
      modelRuntime,
      tools: [...AUDIT_TOOL_NAMES],
      customTools: tools,
      sessionManager: SessionManager.inMemory(),
    });

    const abortSession = () => {
      void session.abort().catch(() => undefined);
    };

    try {
      signal.addEventListener("abort", abortSession, { once: true });
      await session.prompt(loadSkillPrompt());
      signal.throwIfAborted();
      if (!proposal) {
        throw new Error("AGENT_RUN_COMPLETED_WITHOUT_PROPOSAL");
      }

      const stats = session.getSessionStats();
      return {
        proposal,
        telemetry: {
          provider: "pi",
          model: config.model,
          version: PI_AGENT_VERSION,
          usage: {
            input: stats.tokens.input,
            output: stats.tokens.output,
            cacheRead: stats.tokens.cacheRead,
            cacheWrite: stats.tokens.cacheWrite,
            total: stats.tokens.total,
          },
        },
      };
    } finally {
      signal.removeEventListener("abort", abortSession);
      session.dispose();
    }
  }
}

export async function createSmokeTestSession() {
  const result = await createAgentSession({
    noTools: "all",
    sessionManager: SessionManager.inMemory(),
  });
  return result.session;
}
