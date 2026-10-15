import { createHash } from "node:crypto";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { demoScenarioCases } from "@contract-audit/audit/demo-scenarios";
import type { AuditSnapshot } from "@contract-audit/audit/model";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";

const syntheticDocumentHashes = new Set(
  [...demoContracts, ...demoScenarioCases].map(
    (sample) => normalizeContractDocument(sample.text).hash,
  ),
);

/** Raw contract data needs an explicit, exact trusted processing origin. */
export function assertAuditDataDestination(
  snapshot: AuditSnapshot,
  endpoint: string,
  allowedOrigins = process.env.LLM_INTERNAL_DATA_ORIGINS ?? "",
): void {
  let destination: URL;
  try {
    destination = new URL(endpoint);
  } catch {
    throw new Error("MODEL_DATA_DESTINATION_INVALID");
  }
  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.username ||
    destination.password ||
    destination.hash ||
    destination.search
  ) {
    throw new Error("MODEL_DATA_DESTINATION_INVALID");
  }
  const canonicalText = snapshot.contractDocument.blocks.map((block) => block.text).join("\n\n");
  const actualHash = createHash("sha256").update(canonicalText).digest("hex");
  const synthetic =
    syntheticDocumentHashes.has(actualHash) &&
    (snapshot.subjectVerificationProvider === "qcc-fixture" ||
      (snapshot.subjectVerificationProvider === undefined &&
        !snapshot.ruleAssessments.some((item) => item.ruleCode === "SUBJECT_RED_LINE_RISK"))) &&
    snapshot.evidence.every(
      (evidence) =>
        evidence.location.kind !== "PRIOR_CASE_RECORD" &&
        (evidence.location.kind !== "EXTERNAL_RECORD" ||
          evidence.location.provider === "qcc-fixture"),
    );
  if (synthetic) return;

  for (const origin of allowedOrigins.split(",")) {
    if (!origin.trim()) continue;
    let allowed: URL;
    try {
      allowed = new URL(origin.trim());
    } catch {
      throw new Error("LLM_INTERNAL_DATA_ORIGINS_INVALID");
    }
    if (
      (allowed.protocol !== "http:" && allowed.protocol !== "https:") ||
      allowed.pathname !== "/" ||
      allowed.username ||
      allowed.password ||
      allowed.hash ||
      allowed.search
    ) {
      throw new Error("LLM_INTERNAL_DATA_ORIGINS_INVALID");
    }
    if (allowed.origin === destination.origin) return;
  }
  throw new Error("MODEL_DATA_OUTBOUND_FORBIDDEN");
}
