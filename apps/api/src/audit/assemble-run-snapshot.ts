import type { AuditSnapshot, ContractDocument } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import type { AuditCaseRepository } from "../db/repositories";
import type { RuleRepository } from "../db/rule-repository";
import { parseContractFile } from "../document";
import { readOriginal } from "../document/original-store";
import { buildRuleInputs } from "./build-rule-inputs";

const readPolicyOverride = (metadata: Record<string, unknown> | null): number | undefined => {
  if (!metadata || !("policyLimitRatio" in metadata)) return undefined;
  const raw = metadata.policyLimitRatio;
  if (typeof raw !== "number" || Number.isNaN(raw)) return undefined;
  return raw;
};

const readUploadFilename = (metadata: Record<string, unknown> | null): string | null => {
  if (!metadata || typeof metadata.uploadFileName !== "string") return null;
  return metadata.uploadFileName;
};

async function resolveContractDocument(input: {
  sourceText: string;
  originalPath: string | null;
  uploadFileName: string | null;
}): Promise<ContractDocument> {
  if (input.originalPath) {
    const bytes = new Uint8Array(await readOriginal(input.originalPath));
    const parsed = await parseContractFile({
      filename: input.uploadFileName ?? "contract.docx",
      data: bytes,
    });
    return parsed.document;
  }
  return normalizeContractDocument(input.sourceText);
}

/**
 * Returns the snapshot the dispatcher should run against. Retries reuse the
 * latest generation; first runs and reassessments build (and persist) a new one.
 */
export async function ensureRunSnapshot(
  repository: AuditCaseRepository,
  auditCaseId: string,
  rules: RuleRepository,
): Promise<AuditSnapshot> {
  const auditCase = await repository.getCase(auditCaseId);
  if (!auditCase) throw new Error(`Audit case not found: ${auditCaseId}`);

  const source = await repository.getSourceRecordContent(auditCase.sourceRecordId);
  if (!source) throw new Error(`Source record not found: ${auditCase.sourceRecordId}`);

  const metadata = source.metadata;
  const pendingReassess = metadata?.pendingReassess === true;
  const existing = await repository.getSnapshotByCase(auditCaseId);

  if (existing && !pendingReassess) {
    return existing;
  }

  await repository.updateCaseStatus(auditCaseId, "RUNNING", "NORMALIZING");
  let document: ContractDocument;
  if (pendingReassess) {
    if (!existing) {
      throw new Error(`Reassess requested but no snapshot exists for case ${auditCaseId}`);
    }
    document = existing.contractDocument;
  } else {
    document = await resolveContractDocument({
      sourceText: source.sourceText,
      originalPath: source.originalPath,
      uploadFileName: readUploadFilename(metadata),
    });
  }

  await repository.updateCaseStatus(auditCaseId, "RUNNING", "RULE_ASSESSMENT");
  const policyOverride = readPolicyOverride(metadata);
  const snapshot = createAuditSnapshot({
    sourceRecordId: auditCase.sourceRecordId,
    document,
    ...(await buildRuleInputs(rules, policyOverride)),
  });

  await repository.appendSnapshot(auditCaseId, snapshot);
  if (pendingReassess) {
    await repository.patchSourceRecordMetadata(auditCase.sourceRecordId, {
      pendingReassess: false,
    });
  }
  return snapshot;
}
