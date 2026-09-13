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
import {
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

  async listRules(): Promise<RuleListItem[]> {
    return [...this.states.values()].map(({ rule, versions, runs }) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const latest = sorted[0] ?? null;
      const published = sorted.find((version) => version.status === "published") ?? null;
      const validated = sorted.find((version) => version.lastValidationRunId !== null);
      const run = validated
        ? (runs.find((candidate) => candidate.id === validated.lastValidationRunId) ?? null)
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
    if (!run || run.status !== "passed") {
      throw new RuleRepositoryError(409, `验证未通过：${run?.summary.failed ?? 0} 例失败`);
    }
    const previous = state.versions.find((version) => version.status === "published") ?? null;
    if (previous) previous.status = "retired";
    draft.status = "published";
    draft.publishedBy = publishedBy;
    draft.publishedAt = new Date().toISOString();
    return { rule: state.rule, version: draft, retiredVersionId: previous?.id ?? null };
  }

  async getPublishedVersions(
    codes: readonly string[],
  ): Promise<Map<string, { versionId: string; version: number; params: RuleParams }>> {
    const result = new Map<string, { versionId: string; version: number; params: RuleParams }>();
    for (const { rule, versions } of this.states.values()) {
      if (!codes.includes(rule.code)) continue;
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
