import type {
  DecisionDataClassification,
  DecisionRequest,
  DecisionTaskType,
} from "@contract-audit/audit/decision";
import type { AuditSnapshot } from "@contract-audit/audit/model";
import { DECISION_POLICY_VERSION } from "./providers/base";
import { decisionInputHash, REDACTION_VERSION } from "./redaction";
import { decisionQuestionFor } from "./questions";
import type { DecisionConfig } from "./config";
import type { ShadowDecisionRepository } from "./shadow-repository";

/** What a derivation needs about the formal run it observes. */
export interface ShadowDerivationInput {
  auditCaseId: string;
  snapshotId: string;
  agentRunId: string;
  snapshot: AuditSnapshot;
  traceId: string;
}

/**
 * The data classification a derivation may claim.
 *
 * `SYNTHETIC` is never derived from caller metadata: it is proven either by a
 * managed fixture's content fingerprint or by an explicit caller flag on an
 * internal path. Anything else — a real uploaded contract, a pasted
 * submission, a rerun of either — is `MASKED`, because that is what it is.
 * Claiming `SYNTHETIC` for a real contract would launder reviewed user data
 * through the built-in-sample exemption, so the default is the honest one.
 */
export const classificationFor = (input: {
  /** True when the snapshot's source is a managed fixture, by content proof. */
  managedFixture: boolean;
  /** True when the caller explicitly marked the submission internal. */
  callerMarkedInternal: boolean;
}): DecisionDataClassification => {
  if (input.managedFixture) return "SYNTHETIC";
  if (input.callerMarkedInternal) return "INTERNAL";
  return "MASKED";
};

/**
 * The question a derivation asks, chosen from the controlled catalogue.
 *
 * The catalogue is the only source of questions, so a contract's text can
 * never introduce one. When no catalogue question fits the case (for example
 * a case with no clause to excerpt), the derivation returns null and no job is
 * created — the shadow layer stays silent rather than inventing a question.
 */
export const shadowQuestionFor = (
  snapshot: AuditSnapshot,
): { key: string; version: string; taskType: DecisionTaskType } | null => {
  const blocks = snapshot.contractDocument.blocks;
  if (blocks.length === 0) return null;
  const entry = decisionQuestionFor("clause-category");
  if (entry === undefined) return null;
  return { key: entry.key, version: entry.version, taskType: entry.taskType };
};

/** Builds the frozen request for one observation. */
export const buildShadowRequest = (input: {
  derivation: ShadowDerivationInput;
  question: { key: string; version: string; taskType: DecisionTaskType };
  questionText: string;
  policyVersion: string;
  dataClassification: DecisionDataClassification;
  partyNames: readonly string[];
}): DecisionRequest | null => {
  const entry = decisionQuestionFor(input.question.key);
  if (entry === undefined || entry.version !== input.question.version) return null;
  const block = input.derivation.snapshot.contractDocument.blocks[0];
  if (block === undefined) return null;
  return {
    schemaVersion: 1,
    auditCaseId: input.derivation.auditCaseId,
    snapshotId: input.derivation.snapshotId,
    agentRunId: input.derivation.agentRunId,
    contractDocumentHash: input.derivation.snapshot.contractDocument.hash,
    taskType: entry.taskType,
    questionKey: entry.key,
    question: entry.question,
    questionVersion: entry.version,
    policyVersion: input.policyVersion,
    redactionVersion: REDACTION_VERSION,
    contractStance: null,
    structuredSignals: {
      blockCount: input.derivation.snapshot.contractDocument.blocks.length,
      assessmentCount: input.derivation.snapshot.ruleAssessments.length,
      partyCount: input.derivation.snapshot.parties.length,
    },
    maskedClauseExcerpt: block.text,
    evidenceRefs: input.derivation.snapshot.evidence.slice(0, 8).map((evidence) => ({
      evidenceId: evidence.id,
      sourceRecordId: input.derivation.snapshot.sourceRecordId,
      blockId:
        evidence.location.kind === "DOCUMENT_SPAN" ? evidence.location.blockId : null,
      startOffset: evidence.location.kind === "DOCUMENT_SPAN" ? evidence.location.startOffset : null,
      endOffset: evidence.location.kind === "DOCUMENT_SPAN" ? evidence.location.endOffset : null,
    })),
    ruleAssessments: [],
    // No comparison is attached at derivation time: a comparison is a local
    // evaluation concern, and attaching one here would put a baseline answer
    // into the frozen input the model state is built from.
    comparison: null,
    dataClassification: input.dataClassification,
    traceId: input.derivation.traceId,
  };
};

/**
 * Derives one shadow observation for a proven successful run.
 *
 * The caller must have already persisted the formal success: this function
 * reads no audit state and writes no audit state, so a shadow failure cannot
 * undo, delay or contradict a completed audit. `off` short-circuits before
 * anything is written, which is why the switch is a guard here rather than a
 * behaviour of the worker.
 */
export const deriveShadowJob = async (input: {
  config: DecisionConfig;
  repository: ShadowDecisionRepository;
  derivation: ShadowDerivationInput;
  policyVersion?: string;
  dataClassification: DecisionDataClassification;
}): Promise<{ decisionId: string; created: boolean } | null> => {
  if (input.config.decisionMode !== "shadow") return null;
  const question = shadowQuestionFor(input.derivation.snapshot);
  if (question === null) return null;
  const request = buildShadowRequest({
    derivation: input.derivation,
    question,
    questionText: question.key,
    policyVersion: input.policyVersion ?? DECISION_POLICY_VERSION,
    dataClassification: input.dataClassification,
    partyNames: input.derivation.snapshot.parties.map((party) => party.name),
  });
  if (request === null) return null;
  return input.repository.ensureJob({
    auditCaseId: input.derivation.auditCaseId,
    snapshotId: input.derivation.snapshotId,
    agentRunId: input.derivation.agentRunId,
    inputHash: decisionInputHash(request),
    questionKey: request.questionKey,
    questionVersion: request.questionVersion,
    policyVersion: request.policyVersion,
    redactionVersion: request.redactionVersion,
    provider: input.config.decisionProvider,
    modelVersion: modelVersionFor(input.config),
    frozenInput: request,
  });
};

/** The model version recorded for a provider configuration. */
export const modelVersionFor = (config: DecisionConfig): string => {
  if (config.decisionProvider === "fake") return "fake-deterministic-v1";
  if (config.decisionProvider === "laya-cpu") {
    return `${config.decisionModel || "multilingual"}@${config.decisionModelRevision}`;
  }
  return "none";
};
