import type { AuditSnapshot } from "./model";
import { buildPaymentFacts } from "./fact-builder";
import { normalizeContractDocument } from "./plaintext-adapter";
import { evaluateAdvancePaymentRule } from "./payment-rule";

/**
 * Assembles a bounded Audit Snapshot from a source record: normalization,
 * Fact extraction, deterministic rule assessment, then snapshot creation.
 */
export function createAuditSnapshot(input: {
  sourceRecordId: string;
  contractText: string;
  policyLimitRatio: number;
}): AuditSnapshot {
  const document = normalizeContractDocument(input.contractText);
  const { facts, evidence } = buildPaymentFacts({
    sourceRecordId: input.sourceRecordId,
    document,
    policyLimitRatio: input.policyLimitRatio,
  });

  return {
    sourceRecordId: input.sourceRecordId,
    contractDocument: document,
    facts,
    evidence,
    ruleAssessment: evaluateAdvancePaymentRule(facts),
    createdAt: new Date().toISOString(),
  };
}
