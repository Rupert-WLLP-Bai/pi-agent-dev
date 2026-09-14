import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import type {
  AgentRunIdentity,
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
} from "@contract-audit/audit/ports";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  buildModel,
  createModelRuntime,
  loadPiConfig,
  PI_AGENT_VERSION,
  type PiConfig,
} from "./config";
import { createAuditTools } from "./tools";
import { createPiTraceReporter } from "./trace";

const AUDIT_TOOL_NAMES = [
  "get_rule_assessments",
  "get_evidence",
  "search_contract",
  "read_contract_block",
  "submit_finding_proposal",
] as const;

/** Loads the payment-terms-audit skill markdown next to this module. */
function loadSkillPrompt(): string {
  const raw = readFileSync(join(import.meta.dir, "payment-terms-audit.skill.md"), "utf8");
  const frontmatter = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
}

export class PiAuditAgent implements AuditAgentPort {
  private readonly config: PiConfig;
  readonly identity: AgentRunIdentity;

  constructor(config?: PiConfig) {
    this.config = config ?? loadPiConfig();
    this.identity = {
      provider: "pi",
      model: this.config.model,
      version: PI_AGENT_VERSION,
    };
  }

  async run(
    input: AuditSnapshot,
    signal: AbortSignal,
    trace: AgentTraceSink,
  ): Promise<AgentRunResult> {
    signal.throwIfAborted();
    const modelRuntime = await createModelRuntime(this.config);

    // Keyed by finding type: a contract can violate several dimensions at once,
    // and a re-submission of the same dimension supersedes the earlier one
    // rather than filing the same finding twice.
    const proposals = new Map<FindingProposal["findingType"], FindingProposal>();
    const tools = createAuditTools(input, (value) => {
      proposals.set(value.findingType, value);
    });

    const { session } = await createAgentSession({
      model: buildModel(this.config),
      modelRuntime,
      tools: [...AUDIT_TOOL_NAMES],
      customTools: tools,
      sessionManager: SessionManager.inMemory(),
    });

    // Subscribe before prompting: the first events carry the run boundary and
    // the opening turn.
    const reporter = createPiTraceReporter(trace);
    const unsubscribe = session.subscribe((event) => reporter.observe(event));

    const abortSession = () => {
      void session.abort().catch(() => undefined);
    };

    let outcome: "completed" | "failed" = "failed";
    try {
      signal.addEventListener("abort", abortSession, { once: true });
      await session.prompt(loadSkillPrompt());
      signal.throwIfAborted();
      // Zero findings is a legitimate outcome: the contract passed. Zero
      // findings *and* zero tool calls means the model never audited anything,
      // which must not be reported as a pass.
      if (proposals.size === 0 && reporter.toolCalls === 0) {
        throw new Error(reporter.lastProviderError ?? "AGENT_RUN_COMPLETED_WITHOUT_PROPOSAL");
      }
      outcome = "completed";

      const stats = session.getSessionStats();
      return {
        proposals: [...proposals.values()],
        usage: {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
        },
      };
    } finally {
      reporter.close(outcome);
      signal.removeEventListener("abort", abortSession);
      unsubscribe();
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
