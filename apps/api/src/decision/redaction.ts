import type {
  DecisionDataClassification,
  DecisionEvidenceReference,
  DecisionRequest,
} from "@contract-audit/audit/decision";

/**
 * The minimal model state a provider is shown. Deliberately *not* the
 * DecisionRequest: identities, gold answers, comparison metadata and original
 * coordinates are excluded here, so a provider can never be handed — and an
 * adapter can never accidentally serialize — anything it must not see.
 */
export interface DecisionModelState {
  /** The masked clause text, with identifiers already redacted. */
  clause: string;
  /** The controlled question the provider answers, from the server catalogue. */
  instructions: string;
  /** Flat primitive signals (ratios, counts, flags) — never contract text. */
  signals: Record<string, string | number | boolean | null>;
  /** Data classification of the material, for the provider's own record. */
  dataClassification: DecisionDataClassification;
}

/** The version of the redaction ruleset this projector applies. */
export const REDACTION_VERSION = "redaction-v1";

/**
 * Patterns that mark a fragment as identifying rather than substantive.
 *
 * These cover the extracted party names, organization codes / unified social
 * credit codes, bank accounts, phone numbers and email addresses that a
 * contract routinely carries. This is a *minimisation* step, not an
 * anonymisation guarantee: the masked text is still contract text, still
 * Chinese, and still linked by hash to the original document.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  // 统一社会信用代码 / 组织机构代码：18 位字母数字
  /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/gu,
  // 银行账号：16–19 位连续数字（前面不是数字）
  /(?<!\d)\d{16,19}(?!\d)/gu,
  // 手机号
  /(?<!\d)1[3-9]\d{9}(?!\d)/gu,
  // 邮箱
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu,
];

/** The replacement token. Fixed width so a redacted excerpt never leaks length. */
const REDACTED = "〔已脱敏〕";

/**
 * Redacts identifying fragments from a clause excerpt. Party names come from
 * the caller because extraction is a domain concern, not a regex one.
 */
export const redactClauseExcerpt = (excerpt: string, partyNames: readonly string[]): string => {
  let masked = excerpt;
  for (const name of partyNames) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    // Replace every occurrence; a name appearing inside a longer word is still
    // a name on the page.
    masked = masked.replaceAll(trimmed, REDACTED);
  }
  for (const pattern of IDENTIFIER_PATTERNS) {
    masked = masked.replace(pattern, REDACTED);
  }
  return masked;
};

/**
 * Builds the minimal provider state from a frozen request.
 *
 * What is excluded, on purpose:
 * - `auditCaseId`, `snapshotId`, `agentRunId`, `traceId`, `contractDocumentHash`
 *   — system identities. The provider never needs them and a response must
 *   never be able to name the case it belongs to.
 * - `comparison` — local gold/baseline metadata. Sending it would hand the
 *   model the answer it is being compared against.
 * - `ruleAssessments` — the formal rule signal stays local; the shadow path is
 *   an independent observation, and the comparison of the two happens here,
 *   after the fact, never inside the model.
 * - `evidenceRefs` offsets — original document coordinates are retained in our
 *   own records; the provider gets the masked text, not the map back to it.
 * - the request itself — the model state is built field by field, so no
 *   `JSON.stringify(request)` can ever reach the wire.
 */
export const buildDecisionModelState = (
  request: DecisionRequest,
  partyNames: readonly string[] = [],
): DecisionModelState => ({
  clause:
    request.maskedClauseExcerpt === null
      ? ""
      : redactClauseExcerpt(request.maskedClauseExcerpt, partyNames),
  instructions: request.question.criteria,
  signals: { ...request.structuredSignals },
  dataClassification: request.dataClassification,
});

/**
 * The stable hash of a frozen request. Covers exactly the fields that make two
 * observations "the same question asked of the same material": the question
 * and its version, the masked excerpt, the signals, the policy and redaction
 * versions, and the document hash. It deliberately excludes run identity and
 * trace id, so re-deriving the same observation after a restart reproduces the
 * same hash instead of inventing a second job.
 */
export const decisionInputHash = (request: DecisionRequest): string => {
  const canonical = JSON.stringify({
    contractDocumentHash: request.contractDocumentHash,
    taskType: request.taskType,
    questionKey: request.questionKey,
    question: request.question,
    questionVersion: request.questionVersion,
    policyVersion: request.policyVersion,
    redactionVersion: request.redactionVersion,
    contractStance: request.contractStance,
    structuredSignals: request.structuredSignals,
    maskedClauseExcerpt: request.maskedClauseExcerpt,
    dataClassification: request.dataClassification,
  });
  // Bun's runtime exposes a synchronous SHA-256; the digest is hex, matching
  // the document hash's shape elsewhere in the domain.
  return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
};

/** Evidence references copied onto an advice, coordinates untouched. */
export const adviceEvidenceRefs = (
  refs: readonly DecisionEvidenceReference[],
): DecisionEvidenceReference[] => refs.map((ref) => ({ ...ref }));
