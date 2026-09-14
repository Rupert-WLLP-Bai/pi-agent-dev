import { AgentTraceRepository } from "./agent-trace.repository";
import { AuditQueueRepository } from "./audit-queue.repository";
import { AuditReadModelRepository } from "./audit-read-model.repository";
import { FindingRepository } from "./finding.repository";
import type { DrizzleDB } from "./types";

export class AuditCaseRepository {
  private readonly queue: AuditQueueRepository;
  private readonly readModel: AuditReadModelRepository;
  private readonly findings: FindingRepository;
  private readonly traces: AgentTraceRepository;

  constructor(db: DrizzleDB) {
    this.queue = new AuditQueueRepository(db);
    this.readModel = new AuditReadModelRepository(db);
    this.findings = new FindingRepository(db, this.queue);
    this.traces = new AgentTraceRepository(db);
  }

  async claimNextPendingCase(...args: Parameters<AuditQueueRepository["claimNextPendingCase"]>) {
    return this.queue.claimNextPendingCase(...args);
  }

  async claimCase(...args: Parameters<AuditQueueRepository["claimCase"]>) {
    return this.queue.claimCase(...args);
  }

  async getPendingCaseIds(...args: Parameters<AuditQueueRepository["getPendingCaseIds"]>) {
    return this.queue.getPendingCaseIds(...args);
  }

  /**
   * Atomically promotes a case back to PENDING only if it is not RUNNING.
   * This prevents a race where two dispatchers interleave getCase + update
   * and one reverts an already-claimed RUNNING case.
   */
  async requeueIfNotRunning(...args: Parameters<AuditQueueRepository["requeueIfNotRunning"]>) {
    return this.queue.requeueIfNotRunning(...args);
  }

  async markStaleRunsInterrupted(
    ...args: Parameters<AuditQueueRepository["markStaleRunsInterrupted"]>
  ) {
    return this.queue.markStaleRunsInterrupted(...args);
  }

  async createPendingCase(...args: Parameters<AuditQueueRepository["createPendingCase"]>) {
    return this.queue.createPendingCase(...args);
  }

  async createQueuedCase(...args: Parameters<AuditQueueRepository["createQueuedCase"]>) {
    return this.queue.createQueuedCase(...args);
  }

  async getSourceRecordContent(
    ...args: Parameters<AuditQueueRepository["getSourceRecordContent"]>
  ) {
    return this.queue.getSourceRecordContent(...args);
  }

  async patchSourceRecordMetadata(
    ...args: Parameters<AuditQueueRepository["patchSourceRecordMetadata"]>
  ) {
    return this.queue.patchSourceRecordMetadata(...args);
  }

  async updateCaseStatus(...args: Parameters<AuditQueueRepository["updateCaseStatus"]>) {
    return this.queue.updateCaseStatus(...args);
  }

  async getCase(...args: Parameters<AuditQueueRepository["getCase"]>) {
    return this.queue.getCase(...args);
  }

  async getSnapshot(...args: Parameters<AuditQueueRepository["getSnapshot"]>) {
    return this.queue.getSnapshot(...args);
  }

  async getSnapshotByCase(...args: Parameters<AuditQueueRepository["getSnapshotByCase"]>) {
    return this.queue.getSnapshotByCase(...args);
  }

  /**
   * Appends a snapshot generation for a case. Reassessment rebuilds the
   * snapshot under the rules in force now and appends rather than overwrites:
   * the earlier generation stays readable as the record of what a past
   * decision was judged under, while readers pick the newest one.
   */
  async appendSnapshot(...args: Parameters<AuditQueueRepository["appendSnapshot"]>) {
    return this.queue.appendSnapshot(...args);
  }

  /**
   * Records where an uploaded original was stored. Called after the upload
   * route has written the file, so a Source Record can be downloaded later.
   * Pasted submissions never call this and keep a null path.
   */
  async updateSourceOriginalPath(
    ...args: Parameters<AuditQueueRepository["updateSourceOriginalPath"]>
  ) {
    return this.queue.updateSourceOriginalPath(...args);
  }

  /** The stored original for a Source Record, or null when none exists. */
  async getSourceRecord(...args: Parameters<AuditQueueRepository["getSourceRecord"]>) {
    return this.queue.getSourceRecord(...args);
  }

  async getCases(...args: Parameters<AuditReadModelRepository["getCases"]>) {
    return this.readModel.getCases(...args);
  }

  async getCasesWithContractTitle(
    ...args: Parameters<AuditReadModelRepository["getCasesWithContractTitle"]>
  ) {
    return this.readModel.getCasesWithContractTitle(...args);
  }

  /**
   * Review queue: one row per chain-head finding on a case awaiting review.
   *
   * Evidence conflicts are findings whose underlying rule asked for human
   * input (NEEDS_HUMAN_REVIEW) or that cite no evidence; they sort first
   * because a reviewer, not the machine, has to settle them. The SLA deadline
   * is `created_at + slaHours`, derived here so it tracks the configured
   * window instead of a value frozen into the row.
   */
  async getReviewQueue(...args: Parameters<AuditReadModelRepository["getReviewQueue"]>) {
    return this.readModel.getReviewQueue(...args);
  }

  /**
   * Dashboard aggregates. Every number is derived from stored rows; nothing is
   * projected from constants. Findings are counted at chain head only, and the
   * daily series covers the last 30 days regardless of activity.
   */
  async getOverview(...args: Parameters<AuditReadModelRepository["getOverview"]>) {
    return this.readModel.getOverview(...args);
  }

  /**
   * The external-verification timeline: every stored answer, newest capture
   * first. The contract title is read through a scalar subquery so a case with
   * several snapshot generations cannot multiply its verification rows.
   */
  async listSubjectVerifications(
    ...args: Parameters<AuditReadModelRepository["listSubjectVerifications"]>
  ) {
    return this.readModel.listSubjectVerifications(...args);
  }

  async listDemoSeededCases(...args: Parameters<AuditReadModelRepository["listDemoSeededCases"]>) {
    return this.readModel.listDemoSeededCases(...args);
  }

  /**
   * Removes audit cases whose source record was planted by the demo seeder.
   * Operator pastes and uploads are left untouched.
   */
  async deleteDemoSeededCases(
    ...args: Parameters<AuditReadModelRepository["deleteDemoSeededCases"]>
  ) {
    return this.readModel.deleteDemoSeededCases(...args);
  }

  async ping(...args: Parameters<AuditReadModelRepository["ping"]>) {
    return this.readModel.ping(...args);
  }

  /**
   * Sets the review assignee and/or priority. An omitted key leaves the field
   * untouched; an explicit null clears it, which is how a transfer back to the
   * shared queue is expressed.
   */
  async setCaseAssignment(...args: Parameters<AuditReadModelRepository["setCaseAssignment"]>) {
    return this.readModel.setCaseAssignment(...args);
  }

  async appendFindingRevision(...args: Parameters<FindingRepository["appendFindingRevision"]>) {
    return this.findings.appendFindingRevision(...args);
  }

  /**
   * Records a human review as a new append-only revision that supersedes the
   * reviewed proposal. The original row is never overwritten.
   *
   * Accepting a finding also opens its Remediation Item in the same
   * transaction: the item and the decision that created it either both land or
   * neither does. The unique index on `finding_revision_id` makes the insert
   * idempotent, so a retried accept cannot open a second item.
   */
  async appendReviewRevision(...args: Parameters<FindingRepository["appendReviewRevision"]>) {
    return this.findings.appendReviewRevision(...args);
  }

  /**
   * Completes the case once every chain-head finding carries a Human Review.
   * Returns true only on the call that performed the transition, so the caller
   * publishes `audit.completed` exactly once.
   *
   * A case with no chain-head finding at all is left alone: it either never
   * entered review or completed through the no-finding path, and neither is a
   * transition this method should make.
   */
  async completeCaseIfAllFindingsReviewed(
    ...args: Parameters<FindingRepository["completeCaseIfAllFindingsReviewed"]>
  ) {
    return this.findings.completeCaseIfAllFindingsReviewed(...args);
  }

  async getFindingsByCase(...args: Parameters<FindingRepository["getFindingsByCase"]>) {
    return this.findings.getFindingsByCase(...args);
  }

  async getFinding(...args: Parameters<FindingRepository["getFinding"]>) {
    return this.findings.getFinding(...args);
  }

  /** One Remediation Item by id, or null when no such item exists. */
  async getRemediation(...args: Parameters<FindingRepository["getRemediation"]>) {
    return this.findings.getRemediation(...args);
  }

  /**
   * The 整改跟踪 board. Every lifecycle column is present even when empty, so
   * the board's shape never depends on which columns happen to hold work. A
   * card is overdue only while it is still open: a closed item that slipped its
   * deadline is history, not a live escalation.
   */
  async getRemediationBoard(...args: Parameters<FindingRepository["getRemediationBoard"]>) {
    return this.findings.getRemediationBoard(...args);
  }

  /**
   * Applies the operator-editable fields, and — when `status` is given —
   * advances the item exactly one step. Any other target is an illegal
   * transition, including `closed`, which only the close action may set.
   *
   * The read takes a row lock, so two concurrent advances cannot both see the
   * same `from` and skip a column.
   */
  async updateRemediation(...args: Parameters<FindingRepository["updateRemediation"]>) {
    return this.findings.updateRemediation(...args);
  }

  /**
   * Closes an item after a reviewer confirms the fix. Only an item awaiting
   * review may close, and the reviewer must not be the person who owned the
   * fix: self-confirmation is the one thing the close step exists to prevent.
   */
  async closeRemediation(...args: Parameters<FindingRepository["closeRemediation"]>) {
    return this.findings.closeRemediation(...args);
  }

  /**
   * Records one verification pass. Rows are append-only: an earlier decision can
   * always be traced back to the provider answer it rested on, and re-verifying
   * a case adds a generation rather than rewriting history.
   */
  async saveSubjectVerifications(
    ...args: Parameters<FindingRepository["saveSubjectVerifications"]>
  ) {
    return this.findings.saveSubjectVerifications(...args);
  }

  /** Latest verification generation per party, plus the evidence it cites. */
  async getSubjectDimension(...args: Parameters<FindingRepository["getSubjectDimension"]>) {
    return this.findings.getSubjectDimension(...args);
  }

  /**
   * Earlier reviewed findings on cases that name the same counterparty (or the
   * same unified social credit code) and were created before this case. The
   * lookup is frozen by the caller into party_history_records so later cases
   * cannot rewrite what this Bounded Audit Context saw.
   */
  async findPriorPartyCases(...args: Parameters<FindingRepository["findPriorPartyCases"]>) {
    return this.findings.findPriorPartyCases(...args);
  }

  async savePartyHistory(...args: Parameters<FindingRepository["savePartyHistory"]>) {
    return this.findings.savePartyHistory(...args);
  }

  async getPartyHistory(...args: Parameters<FindingRepository["getPartyHistory"]>) {
    return this.findings.getPartyHistory(...args);
  }

  /**
   * Opens an Agent Run before the agent starts.
   *
   * The run row has to exist up front because trace steps reference it — and a
   * trace is most useful while the run is still in flight, not only after it
   * ends. `finishAgentRun` closes it with the outcome.
   */
  async beginAgentRun(...args: Parameters<AgentTraceRepository["beginAgentRun"]>) {
    return this.traces.beginAgentRun(...args);
  }

  /** Closes a run. Usage, duration and error are only known once it is over. */
  async finishAgentRun(...args: Parameters<AgentTraceRepository["finishAgentRun"]>) {
    return this.traces.finishAgentRun(...args);
  }

  /**
   * Records one trace step. A step is identified by (run, sequence), so a
   * repeated write is ignored rather than duplicating the trace.
   */
  async appendAgentTraceStep(...args: Parameters<AgentTraceRepository["appendAgentTraceStep"]>) {
    return this.traces.appendAgentTraceStep(...args);
  }

  /** Every run for a case, newest first, each with its steps in execution order. */
  async getTracesByCase(...args: Parameters<AgentTraceRepository["getTracesByCase"]>) {
    return this.traces.getTracesByCase(...args);
  }

  /** Recent runs across every case, newest first. Powers the trace index page. */
  async getRecentRuns(...args: Parameters<AgentTraceRepository["getRecentRuns"]>) {
    return this.traces.getRecentRuns(...args);
  }
}
