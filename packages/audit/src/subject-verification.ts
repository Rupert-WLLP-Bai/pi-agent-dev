import { classifySubjectDimensions, evaluateSubjectRiskRule } from "./subject-rule";
import type {
  ContractParty,
  EvidenceLocator,
  RuleAssessment,
  SubjectVerification,
} from "./model";
import type { SubjectVerificationOutcome, SubjectVerificationPort } from "./ports";

/**
 * Runs the subject dimension of one case: resolve each Contract Party against
 * the verification port, turn the answers into Evidence anchored to their own
 * Source Records, and evaluate the subject rule.
 *
 * Every party gets a verdict, including the failure cases, so the reviewer can
 * see what was attempted rather than an empty panel.
 */

export interface SubjectSourceRecord {
  id: string;
  provider: string;
  tool: string;
  subject: string;
  outcome: SubjectVerificationOutcome;
}

/** A provider that never answers must not hold a case open forever. */
const VERIFICATION_TIMEOUT_MS = 8_000;

export interface SubjectVerificationRun {
  verifications: SubjectVerification[];
  evidence: EvidenceLocator[];
  ruleAssessment: RuleAssessment;
  /** Provider answers to persist verbatim as Source Records. */
  sourceRecords: SubjectSourceRecord[];
}

export async function runSubjectVerification(input: {
  parties: ContractParty[];
  port: SubjectVerificationPort;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SubjectVerificationRun> {
  const verifications: SubjectVerification[] = [];
  const evidence: EvidenceLocator[] = [];
  const sourceRecords: SubjectSourceRecord[] = [];
  const timeoutMs = input.timeoutMs ?? VERIFICATION_TIMEOUT_MS;

  for (const party of input.parties) {
    let outcome: SubjectVerificationOutcome;
    try {
      const timer = AbortSignal.timeout(timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timer]) : timer;
      outcome = await input.port.verify(party.name, signal);
    } catch (error) {
      // A genuine cancellation must propagate so the case lands CANCELLED; only
      // a provider failure is downgraded to a recorded degraded answer.
      if (input.signal?.aborted) throw error;
      outcome = {
        status: "UNAVAILABLE",
        candidates: [],
        matched: null,
        dimensions: [],
        summary: "",
        capturedAt: new Date().toISOString(),
        expiresAt: null,
        failureReason: error instanceof Error ? error.message : String(error),
      };
    }

    const sourceRecordId = crypto.randomUUID();
    sourceRecords.push({
      id: sourceRecordId,
      provider: input.port.provider,
      tool: input.port.tool,
      subject: party.name,
      outcome,
    });

    const dimensions = classifySubjectDimensions(outcome.dimensions);
    const evidenceIds: string[] = [];

    // Evidence is minted only for a settled subject. Attaching a factor to a
    // name we could not resolve would attribute risk to the wrong legal person,
    // which is exactly the failure this dimension exists to prevent.
    if (outcome.status === "RESOLVED") {
      for (const dimension of dimensions) {
        if (dimension.count === 0) continue;
        const evidenceId = `${party.id}-${dimension.factor}`;
        evidenceIds.push(evidenceId);
        evidence.push({
          id: evidenceId,
          sourceRecordId,
          location: {
            kind: "EXTERNAL_RECORD",
            provider: input.port.provider,
            tool: input.port.tool,
            subject: outcome.matched?.name ?? party.name,
            recordType: dimension.factor,
            capturedAt: outcome.capturedAt,
            expiresAt: outcome.expiresAt,
          },
        });
      }
    }

    verifications.push({
      id: `verification-${party.id}`,
      partyId: party.id,
      status: outcome.status,
      candidates: outcome.candidates,
      matched: outcome.matched,
      dimensions,
      providerSummary: outcome.summary,
      evidenceIds,
      sourceRecordId,
      capturedAt: outcome.capturedAt,
      expiresAt: outcome.expiresAt,
      failureReason: outcome.failureReason,
    });
  }

  return {
    verifications,
    evidence,
    sourceRecords,
    ruleAssessment: evaluateSubjectRiskRule({ parties: input.parties, verifications }),
  };
}
