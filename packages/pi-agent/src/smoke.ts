/**
 * Manual credential smoke test (Task 5 of the implementation plan).
 *
 * Run from the repository root with configured credentials:
 *
 *   cd packages/pi-agent && bun run smoke
 *
 * It runs a full constrained Pi audit agent turn against the demo contract
 * and prints the resulting telemetry — never the API key.
 */
import { readFileSync } from "node:fs";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { PiAuditAgent } from "./runtime";

function loadRootEnvFile(): void {
  if (process.env.XYG_API_KEY) return;
  try {
    const text = readFileSync(new URL("../../../.env", import.meta.url).pathname, "utf8");
    for (const line of text.split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env file — smoke test relies on ambient environment variables.
  }
}

loadRootEnvFile();

const DEMO_CONTRACT = "乙方签订后支付合同金额的70%作为预付款。";

async function main(): Promise<void> {
  const snapshot = createAuditSnapshot({
    sourceRecordId: `smoke-${Date.now()}`,
    contractText: DEMO_CONTRACT,
    policyLimitRatio: 0.3,
  });
  const agent = new PiAuditAgent();
  const result = await agent.run(snapshot, AbortSignal.timeout(120_000));
  console.log(JSON.stringify({
    findingType: result.proposal.findingType,
    severity: result.proposal.severity,
    evidenceIds: result.proposal.evidenceIds,
    telemetry: result.telemetry,
  }, null, 2));
}

await main();
