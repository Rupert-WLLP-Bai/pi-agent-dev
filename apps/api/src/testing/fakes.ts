import type {
  AgentTraceStep,
  AuditSnapshot,
  EvidenceLocator,
  FindingProposal,
  FindingRevision,
  HumanReview,
  SourceProvenance,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type {
  AgentRunIdentity,
  AgentRunResult,
  AgentTraceSink,
  AuditAgentPort,
  AuditEvent,
} from "@contract-audit/audit/ports";
import type {
  SubjectSourceRecord,
  SubjectVerificationRun,
} from "@contract-audit/audit/subject-verification";
import type { AuditCaseRepository } from "../db/repositories";
import type { AuditDispatcher } from "../dispatcher";
import type { AuditEventBroker } from "../sse";

interface FakeCaseState {
  status: string;
  stage: string;
  snapshot: AuditSnapshot | null;
  findings: FakeFindingState[];
}

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
  recordedRuns: RecordedAgentRun[] = [];
  recordedTraceSteps: AgentTraceStep[] = [];
  interruptedStaleRuns = 0;
  databaseAvailable = true;
  /** Provider answers stored verbatim, keyed by source record id. */
  savedSourceRecords = new Map<string, SubjectSourceRecord>();
  /** Append-only verification rows, mirroring the subject_verifications table. */
  subjectVerificationRows: FakeSubjectVerificationRow[] = [];

  async createPendingCase(
    _sourceRecordId: string,
    snapshot: AuditSnapshot,
    _provenance: SourceProvenance | null = null,
  ): Promise<{ caseId: string; snapshotId: string }> {
    const caseId = `case-${this.cases.size + 1}`;
    this.cases.set(caseId, { status: "PENDING", stage: "QUEUED", snapshot, findings: [] });
    return { caseId, snapshotId: `snapshot-${caseId}` };
  }

  async claimNextPendingCase(): Promise<{ caseId: string; snapshotId: string } | null> {
    for (const [caseId, state] of this.cases) {
      if (state.status === "PENDING") {
        state.status = "RUNNING";
        return { caseId, snapshotId: `snapshot-${caseId}` };
      }
    }
    return null;
  }

  async claimCase(auditCaseId: string): Promise<{ caseId: string; snapshotId: string } | null> {
    const state = this.cases.get(auditCaseId);
    if (state?.status !== "PENDING") return null;
    state.status = "RUNNING";
    return { caseId: auditCaseId, snapshotId: `snapshot-${auditCaseId}` };
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
      sourceRecordId: `source-${caseId}`,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }

  async getSnapshot(snapshotId: string): Promise<AuditSnapshot | null> {
    const caseId = snapshotId.replace(/^snapshot-/, "");
    return this.cases.get(caseId)?.snapshot ?? null;
  }

  async getSnapshotByCase(caseId: string): Promise<AuditSnapshot | null> {
    return this.cases.get(caseId)?.snapshot ?? null;
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

  async appendReviewRevision(findingId: string, review: HumanReview): Promise<string> {
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
    return id;
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
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
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
