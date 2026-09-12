/**
 * Manual credential smoke test (Task 5 of the implementation plan).
 *
 * Run from the repository root with configured credentials:
 *
 *   cd packages/pi-agent && bun run smoke
 *
 * It runs a full constrained Pi audit agent turn against the demo contract and
 * prints the agent's trace step by step, then the resulting usage — never the
 * API key.
 */
import { readFileSync } from "node:fs";
import { createAgentTraceCollector } from "@contract-audit/audit/agent-trace";
import type { AgentTraceStep } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { PiAuditAgent } from "./runtime";

function loadRootEnvFile(): void {
  if (process.env.XYG_API_KEY) return;
  try {
    const envPath = new URL("../../.env", import.meta.url);
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) process.env[key] ??= rest.join("=");
    }
  } catch {
    // No .env file — smoke test relies on ambient environment variables.
  }
}

loadRootEnvFile();

const DEMO_CONTRACT = "乙方签订后支付合同金额的70%作为预付款。";

/** One trace line: sequence, kind, label, timing, and whichever payload it has. */
function formatStep(step: AgentTraceStep): string {
  const timing = step.durationMs === null ? "" : ` (${step.durationMs}ms)`;
  const payload = step.input ?? step.output;
  const body = payload === null || payload === undefined ? "" : ` ${JSON.stringify(payload)}`;
  return `[${step.sequence}] ${step.kind} ${step.label}${timing}${body}`;
}

async function main(): Promise<void> {
  const snapshot = createAuditSnapshot({
    sourceRecordId: `smoke-${Date.now()}`,
    document: normalizeContractDocument(DEMO_CONTRACT),
    policyLimitRatio: 0.3,
  });
  const agent = new PiAuditAgent();
  const trace = createAgentTraceCollector("smoke-run", async (step) => {
    console.error(formatStep(step));
  });

  const result = await agent.run(snapshot, AbortSignal.timeout(120_000), trace.sink);
  await trace.flush();

  console.log(
    JSON.stringify(
      {
        identity: agent.identity,
        steps: trace.steps.length,
        findings: result.proposals.map((proposal) => ({
          findingType: proposal.findingType,
          severity: proposal.severity,
          evidenceIds: proposal.evidenceIds,
        })),
        usage: result.usage,
      },
      null,
      2,
    ),
  );
}

await main();
