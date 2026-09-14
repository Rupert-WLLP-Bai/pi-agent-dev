import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type {
  AgentTraceStep,
  AuditCaseStatus,
  AuditSnapshot,
  AuditStage,
  EvidenceLocator,
  FindingProposal,
  FindingRevision,
  HumanReview,
  RemediationStatus,
  Severity,
  SourceProvenance,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { PartyHistoryRun, PriorPartyFinding } from "@contract-audit/audit/party-history-rule";
import type {
  AgentRunIdentity,
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
  AuditEvent,
  ReviewPriority,
} from "@contract-audit/audit/ports";
import { nextRemediationStatus, remediationStatusOrder } from "@contract-audit/audit/remediation";
import type {
  SubjectSourceRecord,
  SubjectVerificationRun,
} from "@contract-audit/audit/subject-verification";
import {
  type AgentRunSummary,
  type AuditCaseRepository,
  type AuditOverview,
  compareReviewQueueItems,
  contractTitleFromFirstBlock,
  type Remediation,
  type RemediationBoard,
  type RemediationCard,
  type ReviewQueueItem,
  type SourceRecordOriginal,
  type SubjectVerificationListItem,
} from "../db/repositories";
import {
  type AuditActionLog,
  type RuleDetail,
  type RuleListItem,
  type RuleRecord,
  type RuleRepository,
  RuleRepositoryError,
  type RuleVersionRecord,
  type SeedRule,
  type ValidationRunRecord,
} from "../db/rule-repository";
import type { RuleParams } from "../db/schema";
import type { AuditDispatcher } from "../dispatcher";
import type { AuditEventBroker } from "../sse";

interface FakeCaseState {
  status: string;
  stage: string;
  snapshots: AuditSnapshot[];
  findings: FakeFindingState[];
  assignee: string | null;
  reviewPriority: ReviewPriority | null;
  createdAt: string;
  updatedAt: string;
  scenarioId: string | null;
  caseKey: string | null;
  demoSeed: boolean;
}

/** The newest snapshot generation for a case, or null before one exists. */
const latestSnapshot = (state: FakeCaseState): AuditSnapshot | null =>
  state.snapshots[state.snapshots.length - 1] ?? null;

/** The display title a queue card or board card shows for a case. */
const titleForState = (state: FakeCaseState | undefined): string =>
  contractTitleFromFirstBlock(
    (state ? latestSnapshot(state) : null)?.contractDocument.blocks[0]?.text,
  ) ?? "未命名合同";

interface FakeFindingState {
  id: string;
  auditCaseId: string;
  proposal: FindingProposal;
  supersedesId: string | null;
  review: HumanReview | null;
}

interface FakeSubjectVerificationRow {
  caseId: string;
  verification: SubjectVerification;
  evidence: EvidenceLocator[];
}

/** In-memory stand-in for the `remediations` row, shaped like the projection. */
interface FakeRemediationState {
  id: string;
  auditCaseId: string;
  findingRevisionId: string;
  summary: string;
  severity: Severity;
  owner: string | null;
  dueAt: string | null;
  status: RemediationStatus;
  progressNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordedAgentRun {
  id: string;
  auditCaseId: string;
  identity: AgentRunIdentity;
  usage: Record<string, number> | null;
  durationMs: number | null;
  error: string | null;
}

/**
 * In-memory stand-in for AuditCaseRepository. Only the surface used by the
 * dispatcher and routes is implemented; tests cast it to the repository type.
 */
export class InMemoryAuditCaseRepository {
  cases = new Map<string, FakeCaseState>();
  /** Snapshot rows by id, mirroring the audit_snapshots table's identity. */
  snapshotsById = new Map<string, { caseId: string; snapshot: AuditSnapshot }>();
  recordedRuns: RecordedAgentRun[] = [];
  recordedTraceSteps: AgentTraceStep[] = [];
  interruptedStaleRuns = 0;
  databaseAvailable = true;
  /** Provider answers stored verbatim, keyed by source record id. */
  savedSourceRecords = new Map<string, SubjectSourceRecord>();
  /** Append-only verification rows, mirroring the subject_verifications table. */
  subjectVerificationRows: FakeSubjectVerificationRow[] = [];
  /** Remediation Items, mirroring the remediations table. */
  remediations = new Map<string, FakeRemediationState>();
  /** Every source record id a case was created under, for download lookups. */
  sourceRecordIds = new Set<string>();
  /** Original file paths written by the upload route, keyed by record id. */
  sourceOriginalPaths = new Map<string, string>();
  /** Uploaded file name per source record, for the download response. */
  sourceDisplayNames = new Map<string, string>();
  /** Provenance recorded at create time, keyed by source record id. */
  sourceProvenanceByRecord = new Map<string, SourceProvenance | null>();
  /** Which source record id backs each case, so tests can address it. */
  sourceRecordIdsByCase = new Map<string, string>();
  /** Frozen party-history lookups, newest last, keyed by case id. */
  partyHistoryRows: Array<{ caseId: string; run: PartyHistoryRun }> = [];

  async createPendingCase(
    sourceRecordId: string,
    snapshot: AuditSnapshot,
    provenance: SourceProvenance | null = null,
    options: {
      createdAt?: Date;
      metadata?: Record<string, unknown>;
      assignee?: string | null;
    } = {},
  ): Promise<{ caseId: string; snapshotId: string }> {
    const caseId = `case-${this.cases.size + 1}`;
    const createdAt = (options.createdAt ?? new Date()).toISOString();
    this.sourceRecordIds.add(sourceRecordId);
    this.sourceRecordIdsByCase.set(caseId, sourceRecordId);
    this.sourceProvenanceByRecord.set(sourceRecordId, provenance);
    if (provenance?.displayName != null) {
      this.sourceDisplayNames.set(sourceRecordId, provenance.displayName);
    }
    this.cases.set(caseId, {
      status: "PENDING",
      stage: "QUEUED",
      snapshots: [snapshot],
      findings: [],
      assignee: options.assignee ?? null,
      reviewPriority: null,
      createdAt,
      updatedAt: createdAt,
      scenarioId:
        typeof options.metadata?.scenarioId === "string" ? options.metadata.scenarioId : null,
      caseKey: typeof options.metadata?.caseKey === "string" ? options.metadata.caseKey : null,
      demoSeed: options.metadata?.demoSeed === true,
    });
    const snapshotId = `snapshot-${caseId}-1`;
    this.snapshotsById.set(snapshotId, { caseId, snapshot });
    return { caseId, snapshotId };
  }

  async claimNextPendingCase(): Promise<{ caseId: string; snapshotId: string } | null> {
    for (const [caseId, state] of this.cases) {
      if (state.status === "PENDING") {
        state.status = "RUNNING";
        return { caseId, snapshotId: `snapshot-${caseId}-${state.snapshots.length}` };
      }
    }
    return null;
  }

  async claimCase(auditCaseId: string): Promise<{ caseId: string; snapshotId: string } | null> {
    const state = this.cases.get(auditCaseId);
    if (state?.status !== "PENDING") return null;
    state.status = "RUNNING";
    return { caseId: auditCaseId, snapshotId: `snapshot-${auditCaseId}-${state.snapshots.length}` };
  }

  async getPendingCaseIds(): Promise<string[]> {
    return [...this.cases.entries()]
      .filter(([, state]) => state.status === "PENDING")
      .map(([id]) => id);
  }

  async getCase(caseId: string) {
    const state = this.cases.get(caseId);
    if (!state) return null;
    return {
      id: caseId,
      status: state.status,
      stage: state.stage,
      sourceRecordId: this.sourceRecordIdsByCase.get(caseId) ?? `source-${caseId}`,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  async updateSourceOriginalPath(sourceRecordId: string, originalPath: string): Promise<void> {
    this.sourceRecordIds.add(sourceRecordId);
    this.sourceOriginalPaths.set(sourceRecordId, originalPath);
  }

  async getSourceRecord(sourceRecordId: string): Promise<SourceRecordOriginal | null> {
    if (!this.sourceRecordIds.has(sourceRecordId)) return null;
    return {
      id: sourceRecordId,
      originalPath: this.sourceOriginalPaths.get(sourceRecordId) ?? null,
      name: this.sourceDisplayNames.get(sourceRecordId) ?? null,
      provenance: this.sourceProvenanceByRecord.get(sourceRecordId) ?? null,
    };
  }

  async getSnapshot(snapshotId: string): Promise<AuditSnapshot | null> {
    return this.snapshotsById.get(snapshotId)?.snapshot ?? null;
  }

  async getSnapshotByCase(caseId: string): Promise<AuditSnapshot | null> {
    const state = this.cases.get(caseId);
    return state ? latestSnapshot(state) : null;
  }

  /** Appends a snapshot generation, mirroring the append-only table. */
  async appendSnapshot(caseId: string, snapshot: AuditSnapshot): Promise<void> {
    const state = this.cases.get(caseId);
    if (!state) throw new Error(`unknown case ${caseId}`);
    state.snapshots.push(snapshot);
    this.snapshotsById.set(`snapshot-${caseId}-${state.snapshots.length}`, { caseId, snapshot });
  }

  async beginAgentRun(input: { auditCaseId: string } & AgentRunIdentity): Promise<string> {
    const id = `run-${this.recordedRuns.length + 1}`;
    this.recordedRuns.push({
      id,
      auditCaseId: input.auditCaseId,
      identity: { provider: input.provider, model: input.model, version: input.version },
      usage: null,
      durationMs: null,
      error: null,
    });
    return id;
  }

  async finishAgentRun(
    runId: string,
    input: {
      usage: Record<string, number> | null;
      durationMs: number | null;
      error: string | null;
    },
  ): Promise<void> {
    const run = this.recordedRuns.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    run.usage = input.usage;
    run.durationMs = input.durationMs;
    run.error = input.error;
  }

  async appendAgentTraceStep(_auditCaseId: string, step: AgentTraceStep): Promise<void> {
    this.recordedTraceSteps.push(step);
  }

  async appendFindingRevision(
    auditCaseId: string,
    proposal: FindingProposal,
    supersedesId: string | null,
  ): Promise<string> {
    const state = this.cases.get(auditCaseId);
    if (!state) throw new Error(`unknown case ${auditCaseId}`);
    const id = `finding-${auditCaseId}-${state.findings.length + 1}`;
    state.findings.push({ id, auditCaseId, proposal, supersedesId, review: null });
    return id;
  }

  async appendReviewRevision(
    findingId: string,
    review: HumanReview,
  ): Promise<{ findingId: string; remediationId: string | null }> {
    const state = [...this.cases.values()].find((candidate) =>
      candidate.findings.some((finding) => finding.id === findingId),
    );
    if (!state) throw new Error(`FINDING_NOT_FOUND: ${findingId}`);
    const existing = state.findings.find((finding) => finding.id === findingId);
    if (existing === undefined) throw new Error(`FINDING_NOT_FOUND: ${findingId}`);
    if (existing.review !== null) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);
    if (state.findings.some((finding) => finding.supersedesId === findingId)) {
      throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);
    }
    const id = `finding-${existing.auditCaseId}-${state.findings.length + 1}`;
    state.findings.push({
      id,
      auditCaseId: existing.auditCaseId,
      proposal: existing.proposal,
      supersedesId: findingId,
      review,
    });

    // Accepting opens exactly one item, keyed by revision so a retry is a no-op.
    if (review.decision !== "ACCEPTED") return { findingId: id, remediationId: null };
    const already = [...this.remediations.values()].find((item) => item.findingRevisionId === id);
    if (already) return { findingId: id, remediationId: already.id };
    const remediationId = `remediation-${this.remediations.size + 1}`;
    const now = new Date().toISOString();
    this.remediations.set(remediationId, {
      id: remediationId,
      auditCaseId: existing.auditCaseId,
      findingRevisionId: id,
      summary: getFindingTypeLabel(existing.proposal.findingType),
      severity: existing.proposal.severity,
      owner: null,
      dueAt: null,
      status: "pending",
      progressNote: null,
      closedBy: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return { findingId: id, remediationId };
  }

  async getRemediation(id: string): Promise<Remediation | null> {
    const item = this.remediations.get(id);
    return item ? { ...item } : null;
  }

  async getRemediationBoard(options: { now?: Date } = {}): Promise<RemediationBoard> {
    const now = options.now ?? new Date();
    const itemsByStatus: Record<RemediationStatus, RemediationCard[]> = {
      pending: [],
      in_progress: [],
      awaiting_review: [],
      closed: [],
    };
    for (const item of this.remediations.values()) {
      itemsByStatus[item.status].push({
        id: item.id,
        caseId: item.auditCaseId,
        contractTitle: titleForState(this.cases.get(item.auditCaseId)),
        summary: item.summary,
        severity: item.severity,
        owner: item.owner,
        dueAt: item.dueAt,
        overdue:
          item.status !== "closed" && item.dueAt !== null && Date.parse(item.dueAt) < now.getTime(),
      });
    }
    const columns = remediationStatusOrder.map((status) => ({
      status,
      count: itemsByStatus[status].length,
      items: itemsByStatus[status],
    }));
    return { columns, total: this.remediations.size };
  }

  async updateRemediation(
    id: string,
    input: {
      owner?: string | null;
      dueAt?: string | null;
      progressNote?: string | null;
      status?: RemediationStatus;
    },
  ): Promise<Remediation> {
    const item = this.remediations.get(id);
    if (!item) throw new Error(`REMEDIATION_NOT_FOUND: ${id}`);
    if (item.status === "closed") throw new Error(`REMEDIATION_CLOSED: ${id}`);
    if (input.owner !== undefined) item.owner = input.owner;
    if (input.dueAt !== undefined) item.dueAt = input.dueAt;
    if (input.progressNote !== undefined) item.progressNote = input.progressNote;
    if (input.status !== undefined) {
      const expected = nextRemediationStatus(item.status);
      if (expected === null || input.status !== expected) {
        throw new Error(`REMEDIATION_ILLEGAL_TRANSITION: ${item.status}->${input.status}`);
      }
      item.status = input.status;
    }
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }

  async closeRemediation(id: string, closedBy: string): Promise<Remediation> {
    const item = this.remediations.get(id);
    const reviewer = closedBy.trim();
    if (!item) throw new Error(`REMEDIATION_NOT_FOUND: ${id}`);
    if (item.status === "closed") throw new Error(`REMEDIATION_ALREADY_CLOSED: ${id}`);
    if (item.status !== "awaiting_review") {
      throw new Error(`REMEDIATION_NOT_AWAITING_REVIEW: ${item.status}`);
    }
    if (item.owner !== null && item.owner === reviewer) {
      throw new Error(`REMEDIATION_SELF_CLOSE: ${id}`);
    }
    const now = new Date().toISOString();
    item.status = "closed";
    item.closedBy = reviewer;
    item.closedAt = now;
    item.updatedAt = now;
    return { ...item };
  }

  async markStaleRunsInterrupted(): Promise<number> {
    let count = 0;
    for (const state of this.cases.values()) {
      if (state.status === "RUNNING") {
        state.status = "INTERRUPTED";
        state.stage = "INTERRUPTED";
        count += 1;
      }
    }
    this.interruptedStaleRuns = count;
    return count;
  }

  async updateCaseStatus(caseId: string, status: string, stage: string): Promise<void> {
    const state = this.cases.get(caseId);
    if (!state) throw new Error(`unknown case ${caseId}`);
    state.status = status;
    state.stage = stage;
    state.updatedAt = new Date().toISOString();
  }

  async requeueIfNotRunning(caseId: string): Promise<boolean> {
    const state = this.cases.get(caseId);
    if (!state) return false;
    if (state.status === "RUNNING") return false;
    state.status = "PENDING";
    state.stage = "QUEUED";
    state.updatedAt = new Date().toISOString();
    return true;
  }

  async setCaseAssignment(
    caseId: string,
    input: { assignee?: string | null; priority?: ReviewPriority | null },
  ): Promise<{ assignee: string | null; priority: ReviewPriority | null }> {
    const state = this.cases.get(caseId);
    if (!state) throw new Error(`unknown case ${caseId}`);
    if (input.assignee !== undefined) state.assignee = input.assignee;
    if (input.priority !== undefined) state.reviewPriority = input.priority;
    state.updatedAt = new Date().toISOString();
    return { assignee: state.assignee, priority: state.reviewPriority };
  }

  async completeCaseIfAllFindingsReviewed(caseId: string): Promise<boolean> {
    const state = this.cases.get(caseId);
    if (!state) throw new Error(`unknown case ${caseId}`);
    const heads = this.chainHeads(state);
    if (heads.length === 0 || heads.some((finding) => finding.review === null)) return false;
    state.status = "COMPLETED";
    state.stage = "COMPLETED";
    state.updatedAt = new Date().toISOString();
    return true;
  }

  async getReviewQueue(options: { slaHours: number; now?: Date }): Promise<ReviewQueueItem[]> {
    const now = options.now ?? new Date();
    const items: ReviewQueueItem[] = [];
    for (const [caseId, state] of this.cases) {
      if (state.stage !== "AWAITING_REVIEW") continue;
      const dueMs = Date.parse(state.createdAt) + options.slaHours * 3_600_000;
      for (const finding of this.chainHeads(state)) {
        const needsReview = (latestSnapshot(state)?.ruleAssessments ?? []).some(
          (assessment) =>
            assessment.disposition === "NEEDS_HUMAN_REVIEW" &&
            assessment.evidenceIds.some((id) => finding.proposal.evidenceIds.includes(id)),
        );
        items.push({
          caseId,
          contractTitle: titleForState(state),
          findingId: finding.id,
          findingType: finding.proposal.findingType,
          title: getFindingTypeLabel(finding.proposal.findingType),
          severity: finding.proposal.severity,
          evidenceConflict:
            finding.proposal.evidenceIds.length === 0 ||
            finding.proposal.findingType === "NEEDS_HUMAN_REVIEW" ||
            needsReview,
          assignee: state.assignee,
          priority: state.reviewPriority,
          dueAt: new Date(dueMs).toISOString(),
          remainingMs: dueMs - now.getTime(),
          updatedAt: state.updatedAt,
        });
      }
    }
    return items.sort(compareReviewQueueItems);
  }

  /** Revisions that no newer revision supersedes, mirroring the SQL chain-head rule. */
  private chainHeads(state: FakeCaseState): FakeFindingState[] {
    const superseded = new Set(
      state.findings.flatMap((finding) =>
        finding.supersedesId === null ? [] : [finding.supersedesId],
      ),
    );
    return state.findings.filter((finding) => !superseded.has(finding.id));
  }

  async getFindingsByCase(caseId: string): Promise<FindingRevision[]> {
    const state = this.cases.get(caseId);
    if (!state) return [];
    const superseded = new Set(
      state.findings.flatMap((finding) =>
        finding.supersedesId === null ? [] : [finding.supersedesId],
      ),
    );
    return state.findings
      .filter((finding) => !superseded.has(finding.id))
      .map((finding) => ({
        id: finding.id,
        auditCaseId: finding.auditCaseId,
        proposal: finding.proposal,
        supersedesId: finding.supersedesId,
        review: finding.review,
        createdAt: new Date(0).toISOString(),
      }));
  }

  async getCases() {
    return [...this.cases.entries()].map(([caseId, state]) => ({
      id: caseId,
      status: state.status,
      stage: state.stage,
      sourceRecordId: `source-${caseId}`,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }));
  }

  async getFinding(findingId: string): Promise<FindingRevision | null> {
    for (const state of this.cases.values()) {
      const finding = state.findings.find((candidate) => candidate.id === findingId);
      if (finding) {
        return {
          id: finding.id,
          auditCaseId: finding.auditCaseId,
          proposal: finding.proposal,
          supersedesId: finding.supersedesId,
          review: finding.review,
          createdAt: new Date(0).toISOString(),
        };
      }
    }
    return null;
  }

  async ping(): Promise<boolean> {
    return this.databaseAvailable;
  }

  async saveSubjectVerifications(caseId: string, run: SubjectVerificationRun): Promise<void> {
    for (const record of run.sourceRecords) this.savedSourceRecords.set(record.id, record);
    for (const verification of run.verifications) {
      this.subjectVerificationRows.push({
        caseId,
        verification,
        evidence: run.evidence.filter((item) => verification.evidenceIds.includes(item.id)),
      });
    }
  }

  async getSubjectDimension(caseId: string): Promise<{
    verifications: SubjectVerification[];
    evidence: EvidenceLocator[];
  }> {
    const rows = this.subjectVerificationRows.filter((row) => row.caseId === caseId);
    const latestByParty = new Map<string, SubjectVerification>();
    for (const row of rows) latestByParty.set(row.verification.partyId, row.verification);
    const verifications = [...latestByParty.values()];
    const cited = new Set(verifications.flatMap((verification) => verification.evidenceIds));
    const evidence = rows.flatMap((row) => row.evidence).filter((item) => cited.has(item.id));
    return { verifications, evidence };
  }

  async findPriorPartyCases(input: {
    excludeCaseId: string;
    createdBefore: Date;
    partyNames: string[];
    creditCodes: string[];
  }): Promise<PriorPartyFinding[]> {
    if (input.partyNames.length === 0 && input.creditCodes.length === 0) return [];
    const nameSet = new Set(input.partyNames);
    const codeSet = new Set(input.creditCodes);
    const before = input.createdBefore.getTime();
    const result: PriorPartyFinding[] = [];

    for (const [caseId, state] of this.cases) {
      if (caseId === input.excludeCaseId) continue;
      if (Date.parse(state.createdAt) >= before) continue;
      const snapshot = latestSnapshot(state);
      if (!snapshot) continue;
      const named = snapshot.parties.find((party) => nameSet.has(party.name));
      const verificationCodes = this.subjectVerificationRows
        .filter((row) => row.caseId === caseId)
        .flatMap((row) => {
          const code = row.verification.matched?.unifiedSocialCreditCode;
          return code === undefined ? [] : [code];
        });
      const codeHit = verificationCodes.some((code) => codeSet.has(code));
      if (!named && !codeHit) continue;
      const partyName =
        named?.name ??
        snapshot.parties.find((party) => party.label === "乙方")?.name ??
        snapshot.parties[0]?.name ??
        "相对方";
      const superseded = new Set(
        state.findings.flatMap((finding) =>
          finding.supersedesId === null ? [] : [finding.supersedesId],
        ),
      );
      const heads = state.findings.filter(
        (finding) => !superseded.has(finding.id) && finding.review !== null,
      );
      const sourceRecordId = this.sourceRecordIdsByCase.get(caseId) ?? `source-${caseId}`;
      for (const finding of heads) {
        if (finding.review === null) continue;
        result.push({
          priorCaseId: caseId,
          sourceRecordId,
          partyName,
          findingRevisionId: finding.id,
          findingType: finding.proposal.findingType,
          decision: finding.review.decision,
          reviewerId: finding.review.reviewerId,
          reviewedAt: finding.review.reviewedAt,
          title: titleForState(state),
        });
      }
    }
    return result;
  }

  async savePartyHistory(caseId: string, run: PartyHistoryRun): Promise<void> {
    this.partyHistoryRows.push({ caseId, run });
  }

  async getPartyHistory(caseId: string): Promise<PartyHistoryRun | null> {
    const rows = this.partyHistoryRows.filter((row) => row.caseId === caseId);
    return rows[rows.length - 1]?.run ?? null;
  }

  async deleteDemoSeededCases(): Promise<number> {
    const ids = [...this.cases.entries()]
      .filter(([, state]) => state.demoSeed)
      .map(([caseId]) => caseId);
    for (const caseId of ids) {
      this.cases.delete(caseId);
      this.partyHistoryRows = this.partyHistoryRows.filter((row) => row.caseId !== caseId);
      this.subjectVerificationRows = this.subjectVerificationRows.filter(
        (row) => row.caseId !== caseId,
      );
      for (const [id, item] of this.remediations) {
        if (item.auditCaseId === caseId) this.remediations.delete(id);
      }
    }
    return ids.length;
  }

  async listDemoSeededCases(): Promise<
    Array<{
      caseId: string;
      scenarioId: string;
      caseKey: string;
      status: AuditCaseStatus;
      stage: AuditStage;
    }>
  > {
    return [...this.cases.entries()]
      .filter(([, state]) => state.demoSeed)
      .sort((left, right) => Date.parse(left[1].createdAt) - Date.parse(right[1].createdAt))
      .map(([caseId, state]) => ({
        caseId,
        scenarioId: state.scenarioId ?? "",
        caseKey: state.caseKey ?? "",
        status: state.status as AuditCaseStatus,
        stage: state.stage as AuditStage,
      }));
  }

  /** Verification timeline, newest capture first, mirroring the SQL projection. */
  async listSubjectVerifications(limit = 50): Promise<SubjectVerificationListItem[]> {
    return [...this.subjectVerificationRows]
      .sort(
        (left, right) =>
          Date.parse(right.verification.capturedAt) - Date.parse(left.verification.capturedAt),
      )
      .slice(0, limit)
      .map((row) => {
        const record = row.verification.sourceRecordId
          ? this.savedSourceRecords.get(row.verification.sourceRecordId)
          : undefined;
        return {
          id: row.verification.id,
          auditCaseId: row.caseId,
          contractTitle: titleForState(this.cases.get(row.caseId)),
          partyId: row.verification.partyId,
          subjectName:
            row.verification.matched?.name ?? record?.subject ?? row.verification.partyId,
          status: row.verification.status,
          provider: record?.provider ?? null,
          capturedAt: row.verification.capturedAt,
          expiresAt: row.verification.expiresAt,
        };
      });
  }

  /** Recent agent runs across every case, newest first. */
  async getRecentRuns(limit: number): Promise<AgentRunSummary[]> {
    return [...this.recordedRuns]
      .map((run, index) => ({ run, index }))
      .sort((left, right) => right.index - left.index)
      .slice(0, limit)
      .map(({ run }) => {
        const state = this.cases.get(run.auditCaseId);
        const snapshot = state ? latestSnapshot(state) : null;
        return {
          id: run.id,
          auditCaseId: run.auditCaseId,
          provider: run.identity.provider,
          model: run.identity.model,
          version: run.identity.version,
          usage: run.usage,
          durationMs: run.durationMs,
          error: run.error,
          createdAt: state?.createdAt ?? new Date(0).toISOString(),
          contractTitle: titleForState(state),
          parties: snapshot?.parties ?? [],
          caseStatus: (state?.status ?? "PENDING") as AuditCaseStatus,
          stepCount: this.recordedTraceSteps.filter((step) => step.runId === run.id).length,
        };
      });
  }

  /** Dashboard aggregates, mirroring the SQL projection over stored rows. */
  async getOverview(): Promise<AuditOverview> {
    const cases = [...this.cases.entries()];
    const chainHeads = cases.flatMap(([, state]) =>
      state.findings.filter(
        (finding) => !state.findings.some((other) => other.supersedesId === finding.id),
      ),
    );

    const findingsByTypeMap = new Map<string, number>();
    for (const finding of chainHeads) {
      const key = finding.proposal.findingType;
      findingsByTypeMap.set(key, (findingsByTypeMap.get(key) ?? 0) + 1);
    }

    const successfulDurations = this.recordedRuns
      .filter((run) => run.error === null && run.durationMs != null)
      .map((run) => run.durationMs as number)
      .sort((a, b) => a - b);
    const medianAgentDurationMs =
      successfulDurations.length === 0
        ? null
        : (successfulDurations[Math.floor((successfulDurations.length - 1) / 2)] ?? null);

    const dayKey = (iso: string): string => iso.slice(0, 10);
    const today = new Date();
    const dailyCounts: Array<{ date: string; count: number }> = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - offset);
      const key = day.toISOString().slice(0, 10);
      dailyCounts.push({
        date: key,
        count: cases.filter(([, state]) => dayKey(state.createdAt) === key).length,
      });
    }

    const severityRank: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const pendingReview = cases
      .filter(([, state]) => state.stage === "AWAITING_REVIEW")
      .map(([id, state]) => {
        const heads = state.findings.filter(
          (finding) => !state.findings.some((other) => other.supersedesId === finding.id),
        );
        let highestSeverity: Severity | null = null;
        for (const finding of heads) {
          const severity = finding.proposal.severity;
          if (highestSeverity === null || severityRank[severity] > severityRank[highestSeverity]) {
            highestSeverity = severity;
          }
        }
        return {
          id,
          title: titleForState(state),
          updatedAt: state.updatedAt,
          highestSeverity,
        };
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

    return {
      totalCases: cases.length,
      awaitingReview: cases.filter(([, state]) => state.stage === "AWAITING_REVIEW").length,
      reachedReview: cases.filter(
        ([, state]) => state.stage === "AWAITING_REVIEW" || state.stage === "COMPLETED",
      ).length,
      dailyCounts,
      findingsByType: [...findingsByTypeMap.entries()].map(([findingType, count]) => ({
        findingType,
        count,
      })),
      acceptedFindings: chainHeads.filter((finding) => finding.review?.decision === "ACCEPTED")
        .length,
      rejectedFindings: chainHeads.filter((finding) => finding.review?.decision === "REJECTED")
        .length,
      citedFindings: chainHeads.filter((finding) => finding.proposal.evidenceIds.length > 0).length,
      chainHeadFindings: chainHeads.length,
      medianAgentDurationMs,
      successfulAgentRuns: this.recordedRuns.filter((run) => run.error === null).length,
      pendingReview,
    };
  }

  asRepository(): AuditCaseRepository {
    return this as unknown as AuditCaseRepository;
  }
}

export class FakeDispatcher {
  enqueued: string[] = [];
  cancelled: string[] = [];
  retried: string[] = [];
  isStarted = false;

  async enqueue(auditCaseId: string): Promise<void> {
    this.enqueued.push(auditCaseId);
  }

  async cancel(auditCaseId: string): Promise<void> {
    this.cancelled.push(auditCaseId);
  }

  async retry(auditCaseId: string): Promise<void> {
    this.retried.push(auditCaseId);
  }

  asDispatcher(): AuditDispatcher {
    return this as unknown as AuditDispatcher;
  }
}

/** Records every published product event, per audit case. */
export class RecordingEventBroker {
  private subscribers = new Map<string, Set<(event: AuditEvent) => void>>();
  events: AuditEvent[] = [];

  subscribe(auditCaseId: string, handler: (event: AuditEvent) => void): () => void {
    let handlers = this.subscribers.get(auditCaseId);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(auditCaseId, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }

  publish(event: AuditEvent): void {
    this.events.push(event);
    for (const handler of this.subscribers.get(event.auditCaseId) ?? []) handler(event);
  }

  asBroker(): AuditEventBroker {
    return this as unknown as AuditEventBroker;
  }
}

/**
 * Agent stub whose runs block until the test resolves them, so dispatcher
 * concurrency and cancellation can be observed deterministically.
 */
export class ControlledAgent implements AuditAgentPort {
  readonly identity: AgentRunIdentity = {
    provider: "test",
    model: "test-model",
    version: "0",
  };
  startedCaseIds: string[] = [];
  /** The exact snapshots handed to the agent, in run order. */
  receivedSnapshots: AuditSnapshot[] = [];
  abortedRuns = 0;
  private pending: {
    resolve: (result: AgentRunResult) => void;
    reject: (reason?: unknown) => void;
  }[] = [];

  async run(
    input: AuditSnapshot,
    signal: AbortSignal,
    _trace: AgentTraceSink,
  ): Promise<AgentRunResult> {
    this.startedCaseIds.push(input.sourceRecordId);
    this.receivedSnapshots.push(input);
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.pending.push(entry);
      signal.addEventListener(
        "abort",
        () => {
          this.abortedRuns += 1;
          reject(signal.reason ?? new Error("ABORTED"));
        },
        { once: true },
      );
    });
  }

  /** Resolves the oldest pending run with the given proposals. */
  resolveRun(proposals: FindingProposal[], usage: Record<string, number> | null = null): void {
    const entry = this.pending.shift();
    entry?.resolve({ proposals, usage });
  }

  /** Rejects the oldest pending run with the given error. */
  rejectRun(reason: unknown): void {
    const entry = this.pending.shift();
    entry?.reject(reason);
  }
}

let fakeRuleSeq = 0;
const nextFakeId = (prefix: string): string => {
  fakeRuleSeq += 1;
  return `${prefix}-${fakeRuleSeq}`;
};

interface FakeRuleState {
  rule: RuleRecord;
  versions: RuleVersionRecord[];
  runs: ValidationRunRecord[];
}

/**
 * In-memory stand-in for RuleRepository. It mirrors the publish gate and the
 * one-open-draft rule, so route tests exercise the same state transitions the
 * SQL repository enforces.
 */
export class InMemoryRuleRepository {
  private states = new Map<string, FakeRuleState>();
  /** The governance trail, keyed by rule id, newest first — its own table stand-in. */
  private actionLogs = new Map<string, AuditActionLog[]>();

  async listRules(): Promise<RuleListItem[]> {
    return [...this.states.values()].map(({ rule, versions, runs }) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const latest = sorted[0] ?? null;
      const published = sorted.find((version) => version.status === "published") ?? null;
      const draft = sorted.find((version) => version.status === "draft") ?? null;
      const preferred = draft?.lastValidationRunId
        ? draft
        : published?.lastValidationRunId
          ? published
          : sorted.find((version) => version.lastValidationRunId !== null);
      const run = preferred?.lastValidationRunId
        ? (runs.find((candidate) => candidate.id === preferred.lastValidationRunId) ?? null)
        : null;
      return {
        ...rule,
        currentVersion: latest?.version ?? null,
        status: latest?.status ?? null,
        lastValidation: run
          ? { status: run.status, finishedAt: run.finishedAt, summary: run.summary }
          : null,
        publishedBy: published?.publishedBy ?? null,
      };
    });
  }

  async getRuleDetail(id: string): Promise<RuleDetail | null> {
    const state = this.states.get(id);
    if (!state) return null;
    const versions = [...state.versions].sort((a, b) => b.version - a.version);
    const activeDraft = versions.find((version) => version.status === "draft") ?? null;
    const draftValidationRun = activeDraft?.lastValidationRunId
      ? (state.runs.find((run) => run.id === activeDraft.lastValidationRunId) ?? null)
      : null;
    return {
      rule: state.rule,
      versions,
      activeDraft,
      draftValidationRun,
    };
  }

  async createRule(input: Parameters<RuleRepository["createRule"]>[0]): Promise<RuleDetail> {
    if ([...this.states.values()].some(({ rule }) => rule.code === input.code)) {
      throw new RuleRepositoryError(409, `规则代码已存在：${input.code}`);
    }
    const now = new Date().toISOString();
    const rule: RuleRecord = {
      id: nextFakeId("rule"),
      code: input.code,
      name: input.name,
      contractType: input.contractType,
      description: input.description,
      enabled: true,
      disabledReason: null,
      disabledBy: null,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const version: RuleVersionRecord = {
      id: nextFakeId("rv"),
      ruleId: rule.id,
      version: 1,
      params: input.params,
      stances: input.stances,
      status: "draft",
      publishedBy: null,
      publishedAt: null,
      lastValidationRunId: null,
      createdAt: now,
    };
    this.states.set(rule.id, { rule, versions: [version], runs: [] });
    return { rule, versions: [version], activeDraft: version, draftValidationRun: null };
  }

  async updateRule(
    id: string,
    input: Parameters<RuleRepository["updateRule"]>[1],
  ): Promise<RuleRecord> {
    const state = this.states.get(id);
    if (!state) throw new RuleRepositoryError(404, "规则不存在");
    state.rule = { ...state.rule, ...input, updatedAt: new Date().toISOString() };
    return state.rule;
  }

  async disableRule(id: string, input: { reason: string; actor: string }): Promise<RuleRecord> {
    const reason = input.reason.trim();
    if (reason === "") throw new RuleRepositoryError(400, "停用原因不能为空");
    const state = this.states.get(id);
    if (!state) throw new RuleRepositoryError(404, "规则不存在");
    const now = new Date().toISOString();
    state.rule = {
      ...state.rule,
      enabled: false,
      disabledReason: reason,
      disabledBy: input.actor,
      disabledAt: now,
      updatedAt: now,
    };
    await this.logAction(id, "disable", input.actor, reason);
    return state.rule;
  }

  async enableRule(id: string, input: { actor: string }): Promise<RuleRecord> {
    const state = this.states.get(id);
    if (!state) throw new RuleRepositoryError(404, "规则不存在");
    state.rule = {
      ...state.rule,
      enabled: true,
      disabledReason: null,
      disabledBy: null,
      disabledAt: null,
      updatedAt: new Date().toISOString(),
    };
    await this.logAction(id, "enable", input.actor);
    return state.rule;
  }

  async logAction(
    ruleId: string,
    action: string,
    actor: string,
    reason?: string,
    versionId?: string,
  ): Promise<void> {
    const log: AuditActionLog = {
      id: nextFakeId("act"),
      ruleId,
      action,
      actor,
      reason: reason ?? null,
      versionId: versionId ?? null,
      createdAt: new Date().toISOString(),
    };
    const existing = this.actionLogs.get(ruleId);
    if (existing) existing.unshift(log);
    else this.actionLogs.set(ruleId, [log]);
  }

  async listActions(ruleId: string): Promise<AuditActionLog[]> {
    return [...(this.actionLogs.get(ruleId) ?? [])];
  }

  async listEnabledCodes(): Promise<string[]> {
    return [...this.states.values()]
      .filter((state) => state.rule.enabled)
      .map((state) => state.rule.code);
  }

  async createVersion(
    ruleId: string,
    input: Parameters<RuleRepository["createVersion"]>[1],
  ): Promise<RuleVersionRecord> {
    const state = this.states.get(ruleId);
    if (!state) throw new RuleRepositoryError(404, "规则不存在");
    if (state.versions.some((version) => version.status === "draft")) {
      throw new RuleRepositoryError(409, "该规则已存在草稿版本，请先更新该草稿");
    }
    const version: RuleVersionRecord = {
      id: nextFakeId("rv"),
      ruleId,
      version: Math.max(0, ...state.versions.map((candidate) => candidate.version)) + 1,
      params: input.params,
      stances: input.stances,
      status: "draft",
      publishedBy: null,
      publishedAt: null,
      lastValidationRunId: null,
      createdAt: new Date().toISOString(),
    };
    state.versions.push(version);
    return version;
  }

  async updateDraft(
    ruleId: string,
    versionId: string,
    input: Parameters<RuleRepository["updateDraft"]>[2],
  ): Promise<RuleVersionRecord> {
    const version = this.states
      .get(ruleId)
      ?.versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new RuleRepositoryError(404, "规则版本不存在");
    if (version.status !== "draft") throw new RuleRepositoryError(409, "只有草稿版本可以修改");
    version.params = input.params;
    version.stances = input.stances;
    return version;
  }

  async recordValidation(
    input: Parameters<RuleRepository["recordValidation"]>[0],
  ): Promise<ValidationRunRecord> {
    const state = [...this.states.values()].find((candidate) =>
      candidate.versions.some((version) => version.id === input.ruleVersionId),
    );
    if (!state) throw new RuleRepositoryError(404, "规则版本不存在");
    const run: ValidationRunRecord = {
      id: nextFakeId("run"),
      ruleVersionId: input.ruleVersionId,
      ruleCode: input.ruleCode,
      triggeredBy: input.triggeredBy,
      startedAt: input.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: input.summary.failed === 0 ? "passed" : "failed",
      summary: input.summary,
      details: input.details,
    };
    state.runs.push(run);
    const version = state.versions.find((candidate) => candidate.id === input.ruleVersionId);
    if (version) version.lastValidationRunId = run.id;
    return run;
  }

  async publish(
    ruleId: string,
    publishedBy: string,
  ): Promise<{ rule: RuleRecord; version: RuleVersionRecord; retiredVersionId: string | null }> {
    const state = this.states.get(ruleId);
    if (!state) throw new RuleRepositoryError(404, "规则不存在");
    const draft = state.versions.find((version) => version.status === "draft");
    if (!draft) throw new RuleRepositoryError(409, "没有待发布的草稿版本");
    if (!draft.lastValidationRunId) throw new RuleRepositoryError(409, "尚未运行验证");
    const run = state.runs.find((candidate) => candidate.id === draft.lastValidationRunId);
    if (run?.status !== "passed") {
      throw new RuleRepositoryError(409, `验证未通过：${run?.summary.failed ?? 0} 例失败`);
    }
    // Mirrors the SQL publish gate: a green run with nothing behind it is not
    // publishable, except for the subject red-line rule whose dimension is
    // external verification rather than contract golden cases.
    const PUBLISH_WITHOUT_CONTRACT_GOLDEN: readonly string[] = ["SUBJECT_RED_LINE_RISK"];
    if (run?.summary.total === 0 && !PUBLISH_WITHOUT_CONTRACT_GOLDEN.includes(state.rule.code)) {
      throw new RuleRepositoryError(409, "没有可验证的案例，不能发布");
    }
    const previous = state.versions.find((version) => version.status === "published") ?? null;
    if (previous) previous.status = "retired";
    draft.status = "published";
    draft.publishedBy = publishedBy;
    draft.publishedAt = new Date().toISOString();
    await this.logAction(ruleId, "publish", publishedBy, undefined, draft.id);
    return { rule: state.rule, version: draft, retiredVersionId: previous?.id ?? null };
  }

  async getPublishedVersions(
    codes: readonly string[],
  ): Promise<Map<string, { versionId: string; version: number; params: RuleParams }>> {
    const result = new Map<string, { versionId: string; version: number; params: RuleParams }>();
    for (const { rule, versions } of this.states.values()) {
      if (!codes.includes(rule.code)) continue;
      if (!rule.enabled) continue;
      const published = versions.find((version) => version.status === "published");
      if (published) {
        result.set(rule.code, {
          versionId: published.id,
          version: published.version,
          params: published.params,
        });
      }
    }
    return result;
  }

  async bootstrapRules(seeds: readonly SeedRule[], publishedBy: string): Promise<number> {
    let created = 0;
    for (const seed of seeds) {
      if ([...this.states.values()].some(({ rule }) => rule.code === seed.code)) continue;
      const detail = await this.createRule({
        code: seed.code,
        name: seed.name,
        contractType: seed.contractType,
        description: seed.description,
        params: seed.params,
        stances: seed.stances,
      });
      const version = detail.versions[0];
      version.status = "published";
      version.publishedBy = publishedBy;
      version.publishedAt = new Date().toISOString();
      created += 1;
    }
    return created;
  }

  asRepository(): RuleRepository {
    return this as unknown as RuleRepository;
  }
}
