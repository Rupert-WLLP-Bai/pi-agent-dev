import type {
  ContractParty,
  EvidenceLocator,
  FindingType,
  PriorCaseRecordLocator,
  ReviewDecision,
  RuleAssessment,
} from "./model";

export const PARTY_HISTORY_RULE_CODE = "PARTY_HISTORY_ASSOCIATION" as const;

/**
 * One reviewed finding on an earlier Audit Case that names the same
 * Contract Party. The lookup that produces these lives in the repository; this
 * rule only judges what that lookup returned.
 */
export interface PriorPartyFinding {
  priorCaseId: string;
  sourceRecordId: string;
  partyName: string;
  findingRevisionId: string;
  findingType: FindingType;
  decision: ReviewDecision;
  reviewerId: string;
  reviewedAt: string;
  /** First-block title of the prior case, for the workbench list. */
  title: string;
}

/** One prior case the current audit should surface, with the findings that matched. */
export interface PartyHistoryHit {
  priorCaseId: string;
  title: string;
  partyName: string;
  findings: Array<{
    findingRevisionId: string;
    findingType: FindingType;
    decision: ReviewDecision;
    reviewerId: string;
    reviewedAt: string;
    evidenceId: string;
  }>;
}

export interface PartyHistoryRun {
  assessment: RuleAssessment;
  evidence: EvidenceLocator[];
  hits: PartyHistoryHit[];
}

/**
 * Names the current case should look up in history. 乙方 is the Contract Party
 * we care about; matching 甲方 would join every case that names us.
 */
export function contractPartyNames(parties: ContractParty[]): string[] {
  const counterparties = parties.filter((party) => party.label === "乙方");
  const selected = counterparties.length > 0 ? counterparties : parties;
  return [...new Set(selected.map((party) => party.name))];
}

/** @deprecated Use contractPartyNames */
export const counterpartyNames = contractPartyNames;

/**
 * Credit codes that belong to Contract Parties. Using every party's code would
 * join every case that names us as 甲方.
 */
export function contractPartyCreditCodes(
  parties: ContractParty[],
  verifications: Array<{ partyId: string; matched?: { unifiedSocialCreditCode?: string } | null }>,
): string[] {
  const names = new Set(contractPartyNames(parties));
  const codes: string[] = [];
  for (const item of verifications) {
    const party = parties.find((candidate) => candidate.id === item.partyId);
    if (!party || !names.has(party.name)) continue;
    const code = item.matched?.unifiedSocialCreditCode;
    if (code) codes.push(code);
  }
  return [...new Set(codes)];
}

/** @deprecated Use contractPartyCreditCodes */
export const counterpartyCreditCodes = contractPartyCreditCodes;

const evidenceIdFor = (finding: PriorPartyFinding): string =>
  `history-${finding.priorCaseId}-${finding.findingRevisionId}`;

function toLocator(finding: PriorPartyFinding): EvidenceLocator {
  const location: PriorCaseRecordLocator = {
    kind: "PRIOR_CASE_RECORD",
    priorCaseId: finding.priorCaseId,
    findingRevisionId: finding.findingRevisionId,
    partyName: finding.partyName,
    findingType: finding.findingType,
    decision: finding.decision,
    reviewerId: finding.reviewerId,
    reviewedAt: finding.reviewedAt,
    title: finding.title,
  };
  return {
    id: evidenceIdFor(finding),
    sourceRecordId: finding.sourceRecordId,
    location,
  };
}

function groupHits(findings: PriorPartyFinding[]): PartyHistoryHit[] {
  const byCase = new Map<string, PartyHistoryHit>();
  for (const finding of findings) {
    const existing = byCase.get(finding.priorCaseId);
    const entry = {
      findingRevisionId: finding.findingRevisionId,
      findingType: finding.findingType,
      decision: finding.decision,
      reviewerId: finding.reviewerId,
      reviewedAt: finding.reviewedAt,
      evidenceId: evidenceIdFor(finding),
    };
    if (existing) {
      existing.findings.push(entry);
      continue;
    }
    byCase.set(finding.priorCaseId, {
      priorCaseId: finding.priorCaseId,
      title: finding.title,
      partyName: finding.partyName,
      findings: [entry],
    });
  }
  return [...byCase.values()];
}

const describeAccepted = (finding: PriorPartyFinding): string =>
  `相对方「${finding.partyName}」于 ${finding.reviewedAt.slice(0, 10)} 由法务${finding.reviewerId}在「${finding.title}」中确认过风险`;

const describeRejected = (finding: PriorPartyFinding): string =>
  `相对方「${finding.partyName}」于 ${finding.reviewedAt.slice(0, 10)} 由法务${finding.reviewerId}将「${finding.title}」中的同类发现判定为误报`;

/**
 * Evaluates whether earlier, separately reviewed cases for the same
 * counterparty should surface on the current audit. Different legal reviewers
 * cannot see each other's queue; this rule is what joins them.
 *
 * Precedence:
 * 1. any ACCEPTED prior finding → POLICY_CONFLICT
 * 2. only REJECTED (historical false positives) → NEEDS_HUMAN_REVIEW
 * 3. otherwise → COMPLIANT
 */
export function evaluatePartyHistoryRule(input: {
  parties: ContractParty[];
  priorFindings: PriorPartyFinding[];
}): PartyHistoryRun {
  const base = { id: "assessment-party-history", ruleCode: PARTY_HISTORY_RULE_CODE } as const;
  if (input.parties.length === 0 || input.priorFindings.length === 0) {
    return {
      assessment: {
        ...base,
        disposition: "COMPLIANT",
        evidenceIds: [],
        basis: "未发现同一相对方的历史审核记录。",
      },
      evidence: [],
      hits: [],
    };
  }

  const evidence = input.priorFindings.map(toLocator);
  const hits = groupHits(input.priorFindings);
  const accepted = input.priorFindings.filter((finding) => finding.decision === "ACCEPTED");
  const rejected = input.priorFindings.filter((finding) => finding.decision === "REJECTED");

  if (accepted.length > 0) {
    return {
      assessment: {
        ...base,
        disposition: "POLICY_CONFLICT",
        evidenceIds: accepted.map(evidenceIdFor),
        basis: `${accepted.map(describeAccepted).join("；")}。不同复核人无法看到彼此的历史结论，本次审计已自动关联。`,
      },
      evidence,
      hits,
    };
  }

  return {
    assessment: {
      ...base,
      disposition: "NEEDS_HUMAN_REVIEW",
      evidenceIds: rejected.map(evidenceIdFor),
      basis: `${rejected.map(describeRejected).join("；")}，请对照历史误报再决定本次是否仍构成风险。`,
    },
    evidence,
    hits,
  };
}
