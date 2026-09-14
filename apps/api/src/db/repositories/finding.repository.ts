import { ruleCodeForAssessment } from "@contract-audit/audit/assessment-utils";
import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type {
  EvidenceLocator,
  FindingProposal,
  FindingRevision,
  HumanReview,
  RemediationStatus,
  RuleCode,
  SubjectVerification,
} from "@contract-audit/audit/model";
import type { PartyHistoryRun, PriorPartyFinding } from "@contract-audit/audit/party-history-rule";
import { nextRemediationStatus, remediationStatusOrder } from "@contract-audit/audit/remediation";
import { closureHintFromDisposition } from "@contract-audit/audit/remediation-closure";
import type { SubjectVerificationRun } from "@contract-audit/audit/subject-verification";
import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import {
  auditCases,
  auditSnapshots,
  contractRevisions,
  findingRevisions,
  partyHistoryRecords,
  remediations,
  sourceRecords,
  subjectVerifications,
} from "../schema";
import type { AuditQueueRepository } from "./audit-queue.repository";
import { contractTitleFromFirstBlock } from "./helpers";
import { toFinding, toRemediation, toRemediationStatus, toSeverity } from "./mappers";
import type { DrizzleDB, Remediation, RemediationBoard, RemediationCard } from "./types";

export class FindingRepository {
  constructor(
    private readonly db: DrizzleDB,
    private readonly queue: AuditQueueRepository,
  ) {}

  async appendFindingRevision(
    auditCaseId: string,
    proposal: FindingProposal,
    supersedesId: string | null,
  ): Promise<string> {
    const snapshot = await this.queue.getSnapshotByCase(auditCaseId);
    const ruleCode =
      snapshot === null ? null : ruleCodeForAssessment(snapshot, proposal.assessmentId);
    const [row] = await this.db
      .insert(findingRevisions)
      .values({ auditCaseId, proposal, supersedesId, ruleCode })
      .returning({ id: findingRevisions.id });
    return row.id;
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

  /**
   * Records a human review as a new append-only revision that supersedes the
   * reviewed proposal. The original row is never overwritten.
   *
   * Accepting a finding also opens its Remediation Item in the same
   * transaction: the item and the decision that created it either both land or
   * neither does. The unique index on `finding_revision_id` makes the insert
   * idempotent, so a retried accept cannot open a second item.
   */
  async appendReviewRevision(
    findingId: string,
    review: HumanReview,
  ): Promise<{ findingId: string; remediationId: string | null }> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(findingRevisions)
        .where(eq(findingRevisions.id, findingId))
        .limit(1);
      if (!existing) throw new Error(`FINDING_NOT_FOUND: ${findingId}`);
      if (existing.review !== null) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);
      const [superseder] = await tx
        .select({ id: findingRevisions.id })
        .from(findingRevisions)
        .where(eq(findingRevisions.supersedesId, findingId))
        .limit(1);
      if (superseder) throw new Error(`FINDING_ALREADY_REVIEWED: ${findingId}`);

      const [row] = await tx
        .insert(findingRevisions)
        .values({
          auditCaseId: existing.auditCaseId,
          proposal: existing.proposal,
          supersedesId: findingId,
          review,
          ruleCode: existing.ruleCode,
        })
        .returning({ id: findingRevisions.id });

      if (review.decision !== "ACCEPTED") {
        return { findingId: row.id, remediationId: null };
      }
      const [remediation] = await tx
        .insert(remediations)
        .values({
          auditCaseId: existing.auditCaseId,
          findingRevisionId: row.id,
          summary: getFindingTypeLabel(existing.proposal.findingType),
          severity: existing.proposal.severity,
        })
        .onConflictDoNothing({ target: remediations.findingRevisionId })
        .returning({ id: remediations.id });
      return { findingId: row.id, remediationId: remediation?.id ?? null };
    });
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
  async completeCaseIfAllFindingsReviewed(caseId: string): Promise<boolean> {
    const rows = await this.db.execute<{ total: number; unreviewed: number }>(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE f.review IS NULL)::int AS unreviewed
      FROM finding_revisions f
      WHERE f.audit_case_id = ${caseId}
        -- Chain heads only: a revision superseded by a newer one is history.
        AND NOT EXISTS (SELECT 1 FROM finding_revisions s WHERE s.supersedes_id = f.id)
    `);
    const total = rows[0]?.total ?? 0;
    const unreviewed = rows[0]?.unreviewed ?? 0;
    if (total === 0 || unreviewed > 0) return false;

    await this.queue.updateCaseStatus(caseId, "COMPLETED", "COMPLETED");
    return true;
  }

  /** One Remediation Item by id, or null when no such item exists. */

  async getFindingsByCase(caseId: string): Promise<FindingRevision[]> {
    const rows = await this.db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.auditCaseId, caseId))
      // Worst first: a case can carry several findings from one run, and the
      // workbench opens on the first one. Recency alone would surface whichever
      // dimension happened to be written last instead of the one that matters.
      .orderBy(
        sql`CASE ${findingRevisions.proposal}->>'severity' WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC`,
        desc(findingRevisions.createdAt),
      );
    // Append-only revisions: expose only chain heads (revisions that are not
    // superseded by a newer revision), each carrying its latest review state.
    const supersededIds = new Set(
      rows.flatMap((row) => (row.supersedesId === null ? [] : [row.supersedesId])),
    );
    return rows.filter((row) => !supersededIds.has(row.id)).map(toFinding);
  }

  async getFinding(findingId: string): Promise<FindingRevision | null> {
    const [row] = await this.db
      .select()
      .from(findingRevisions)
      .where(eq(findingRevisions.id, findingId))
      .limit(1);
    return row ? toFinding(row) : null;
  }

  /** One Remediation Item by id, or null when no such item exists. */
  async getRemediation(id: string): Promise<Remediation | null> {
    const [row] = await this.db.select().from(remediations).where(eq(remediations.id, id)).limit(1);
    return row ? toRemediation(row) : null;
  }

  /**
   * The 整改跟踪 board. Every lifecycle column is present even when empty, so
   * the board's shape never depends on which columns happen to hold work. A
   * card is overdue only while it is still open: a closed item that slipped its
   * deadline is history, not a live escalation.
   */

  /**
   * The 整改跟踪 board. Every lifecycle column is present even when empty, so
   * the board's shape never depends on which columns happen to hold work. A
   * card is overdue only while it is still open: a closed item that slipped its
   * deadline is history, not a live escalation.
   */
  async getRemediationBoard(options: { now?: Date } = {}): Promise<RemediationBoard> {
    const now = options.now ?? new Date();
    const rows = await this.db
      .select({
        id: remediations.id,
        auditCaseId: remediations.auditCaseId,
        summary: remediations.summary,
        severity: remediations.severity,
        owner: remediations.owner,
        dueAt: remediations.dueAt,
        status: remediations.status,
        closureHint: remediations.closureHint,
        contractTitle: sql<string | null>`${auditSnapshots.document}->'blocks'->0->>'text'`,
      })
      .from(remediations)
      .leftJoin(
        auditSnapshots,
        and(
          eq(auditSnapshots.auditCaseId, remediations.auditCaseId),
          eq(
            auditSnapshots.createdAt,
            sql`(SELECT MAX(s2.created_at) FROM ${auditSnapshots} s2 WHERE s2.audit_case_id = ${remediations.auditCaseId})`,
          ),
        ),
      )
      .orderBy(sql`${remediations.dueAt} ASC NULLS LAST`, remediations.createdAt);

    const itemsByStatus: Record<RemediationStatus, RemediationCard[]> = {
      pending: [],
      in_progress: [],
      awaiting_review: [],
      closed: [],
    };
    for (const row of rows) {
      const dueAt = row.dueAt === null ? null : row.dueAt.toISOString();
      const status = toRemediationStatus(row.status);
      itemsByStatus[status].push({
        id: row.id,
        caseId: row.auditCaseId,
        contractTitle: contractTitleFromFirstBlock(row.contractTitle) ?? "未命名合同",
        summary: row.summary,
        severity: toSeverity(row.severity) ?? "LOW",
        owner: row.owner,
        dueAt,
        overdue: status !== "closed" && dueAt !== null && Date.parse(dueAt) < now.getTime(),
        closureHint: row.closureHint ?? null,
      });
    }
    const columns = remediationStatusOrder.map((status) => ({
      status,
      count: itemsByStatus[status].length,
      items: itemsByStatus[status],
    }));
    return { columns, total: rows.length };
  }

  async getRemediationsForCase(auditCaseId: string): Promise<Remediation[]> {
    const rows = await this.db
      .select()
      .from(remediations)
      .where(eq(remediations.auditCaseId, auditCaseId))
      .orderBy(remediations.createdAt);
    return rows.map((row) => toRemediation(row));
  }

  /**
   * Applies the operator-editable fields, and — when `status` is given —
   * advances the item exactly one step. Any other target is an illegal
   * transition, including `closed`, which only the close action may set.
   *
   * The read takes a row lock, so two concurrent advances cannot both see the
   * same `from` and skip a column.
   */
  async updateRemediation(
    id: string,
    input: {
      owner?: string | null;
      dueAt?: string | null;
      progressNote?: string | null;
      status?: RemediationStatus;
    },
  ): Promise<Remediation> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(remediations)
        .where(eq(remediations.id, id))
        .for("update");
      if (!row) throw new Error(`REMEDIATION_NOT_FOUND: ${id}`);
      if (row.status === "closed") throw new Error(`REMEDIATION_CLOSED: ${id}`);

      const patch: Partial<typeof remediations.$inferInsert> = { updatedAt: new Date() };
      if (input.owner !== undefined) patch.owner = input.owner;
      if (input.dueAt !== undefined) {
        patch.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
      }
      if (input.progressNote !== undefined) patch.progressNote = input.progressNote;
      if (input.status !== undefined) {
        const expected = nextRemediationStatus(row.status);
        if (expected === null || input.status !== expected) {
          throw new Error(`REMEDIATION_ILLEGAL_TRANSITION: ${row.status}->${input.status}`);
        }
        patch.status = input.status;
      }

      const [updated] = await tx
        .update(remediations)
        .set(patch)
        .where(eq(remediations.id, id))
        .returning();
      return toRemediation(updated);
    });
  }

  /**
   * Closes an item after a reviewer confirms the fix. Only an item awaiting
   * review may close, and the reviewer must not be the person who owned the
   * fix: self-confirmation is the one thing the close step exists to prevent.
   */

  /**
   * Closes an item after a reviewer confirms the fix. Only an item awaiting
   * review may close, and the reviewer must not be the person who owned the
   * fix: self-confirmation is the one thing the close step exists to prevent.
   */
  async closeRemediation(id: string, closedBy: string): Promise<Remediation> {
    const reviewer = closedBy.trim();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(remediations)
        .where(eq(remediations.id, id))
        .for("update");
      if (!row) throw new Error(`REMEDIATION_NOT_FOUND: ${id}`);
      if (row.status === "closed") throw new Error(`REMEDIATION_ALREADY_CLOSED: ${id}`);
      if (row.status !== "awaiting_review") {
        throw new Error(`REMEDIATION_NOT_AWAITING_REVIEW: ${row.status}`);
      }
      if (row.owner === null) {
        throw new Error(`REMEDIATION_OWNER_REQUIRED: ${id}`);
      }
      if (row.owner === reviewer) {
        throw new Error(`REMEDIATION_SELF_CLOSE: ${id}`);
      }

      const [caseRow] = await tx
        .select({ sourceRecordId: auditCases.sourceRecordId })
        .from(auditCases)
        .where(eq(auditCases.id, row.auditCaseId))
        .limit(1);
      const now = new Date();
      const closureEvidence: EvidenceLocator[] = [
        {
          id: crypto.randomUUID(),
          sourceRecordId: caseRow?.sourceRecordId ?? row.auditCaseId,
          location: {
            kind: "EXTERNAL_RECORD",
            provider: "remediation",
            tool: "close",
            subject: row.summary,
            recordType: "REMEDIATION_CLOSURE",
            capturedAt: now.toISOString(),
            expiresAt: null,
          },
        },
      ];
      const [updated] = await tx
        .update(remediations)
        .set({
          status: "closed",
          closedBy: reviewer,
          closedAt: now,
          updatedAt: now,
          closureEvidence,
        })
        .where(eq(remediations.id, id))
        .returning();
      return toRemediation(updated);
    });
  }

  /**
   * After a newer Contract Revision is audited, refresh closure hints on open
   * remediations tied to earlier revisions of the same contract.
   */
  async refreshRemediationClosureHints(caseId: string): Promise<void> {
    const snapshot = await this.queue.getSnapshotByCase(caseId);
    if (!snapshot) return;

    const [context] = await this.db
      .select({
        contractId: contractRevisions.contractId,
        version: contractRevisions.version,
      })
      .from(auditCases)
      .innerJoin(contractRevisions, eq(auditCases.contractRevisionId, contractRevisions.id))
      .where(eq(auditCases.id, caseId))
      .limit(1);
    if (!context) return;

    const openItems = await this.db
      .select({
        remediationId: remediations.id,
        ruleCode: findingRevisions.ruleCode,
      })
      .from(remediations)
      .innerJoin(findingRevisions, eq(remediations.findingRevisionId, findingRevisions.id))
      .innerJoin(auditCases, eq(remediations.auditCaseId, auditCases.id))
      .innerJoin(contractRevisions, eq(auditCases.contractRevisionId, contractRevisions.id))
      .where(
        and(
          eq(contractRevisions.contractId, context.contractId),
          lt(contractRevisions.version, context.version),
          ne(remediations.status, "closed"),
        ),
      );

    for (const item of openItems) {
      const ruleCode = item.ruleCode as RuleCode | null;
      if (!ruleCode) continue;
      const assessment = snapshot.ruleAssessments.find(
        (candidate) => candidate.ruleCode === ruleCode,
      );
      const closureHint = assessment
        ? closureHintFromDisposition(assessment.disposition)
        : "unknown";
      await this.db
        .update(remediations)
        .set({ closureHint, updatedAt: new Date() })
        .where(eq(remediations.id, item.remediationId));
    }
  }

  /**
   * Records one verification pass. Rows are append-only: an earlier decision can
   * always be traced back to the provider answer it rested on, and re-verifying
   * a case adds a generation rather than rewriting history.
   */
  async saveSubjectVerifications(caseId: string, run: SubjectVerificationRun): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const record of run.sourceRecords) {
        await tx.insert(sourceRecords).values({
          id: record.id,
          // A failed provider call still gets a Source Record so the attempt is
          // auditable; the failure reason then stands in for the payload text.
          sourceText: record.outcome.summary || record.outcome.failureReason || "",
          metadata: {
            provider: record.provider,
            tool: record.tool,
            subject: record.subject,
            status: record.outcome.status,
            matched: record.outcome.matched,
            candidates: record.outcome.candidates,
            dimensions: record.outcome.dimensions,
            capturedAt: record.outcome.capturedAt,
            expiresAt: record.outcome.expiresAt,
            failureReason: record.outcome.failureReason,
          },
        });
      }

      for (const verification of run.verifications) {
        await tx.insert(subjectVerifications).values({
          auditCaseId: caseId,
          partyId: verification.partyId,
          status: verification.status,
          sourceRecordId: verification.sourceRecordId,
          payload: verification,
          evidence: run.evidence.filter((item) => verification.evidenceIds.includes(item.id)),
        });
      }
    });
  }

  /** Latest verification generation per party, plus the evidence it cites. */

  /** Latest verification generation per party, plus the evidence it cites. */
  async getSubjectDimension(caseId: string): Promise<{
    verifications: SubjectVerification[];
    evidence: EvidenceLocator[];
  }> {
    const rows = await this.db
      .select()
      .from(subjectVerifications)
      .where(eq(subjectVerifications.auditCaseId, caseId))
      .orderBy(subjectVerifications.createdAt);

    // Evidence ids are stable across generations, so reading every row would
    // return the same id twice with different capture times. Only the newest
    // generation per party may surface.
    const latestByParty = new Map<string, (typeof rows)[number]>();
    for (const row of rows) latestByParty.set(row.partyId, row);
    const latestRows = [...latestByParty.values()];

    const verifications = latestRows.map((row) => row.payload);
    const cited = new Set(verifications.flatMap((item) => item.evidenceIds));
    const evidenceById = new Map<string, EvidenceLocator>();
    for (const row of latestRows) {
      for (const item of row.evidence) {
        if (cited.has(item.id)) evidenceById.set(item.id, item);
      }
    }

    return { verifications, evidence: [...evidenceById.values()] };
  }

  /**
   * Earlier reviewed findings on cases that name the same counterparty (or the
   * same unified social credit code) and were created before this case. The
   * lookup is frozen by the caller into party_history_records so later cases
   * cannot rewrite what this Bounded Audit Context saw.
   */
  async findPriorPartyCases(input: {
    excludeCaseId: string;
    createdBefore: Date;
    partyNames: string[];
    creditCodes: string[];
  }): Promise<PriorPartyFinding[]> {
    if (input.partyNames.length === 0 && input.creditCodes.length === 0) return [];

    const partyMatch =
      input.partyNames.length > 0
        ? sql`EXISTS (
            SELECT 1 FROM ${auditSnapshots} s
            WHERE s.audit_case_id = ${auditCases.id}
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(s.parties) party
                WHERE party->>'name' IN (${sql.join(
                  input.partyNames.map((name) => sql`${name}`),
                  sql`, `,
                )})
              )
          )`
        : undefined;

    const creditMatch =
      input.creditCodes.length > 0
        ? sql`EXISTS (
            SELECT 1 FROM ${subjectVerifications} sv
            WHERE sv.audit_case_id = ${auditCases.id}
              AND sv.payload->'matched'->>'unifiedSocialCreditCode' IN (${sql.join(
                input.creditCodes.map((code) => sql`${code}`),
                sql`, `,
              )})
          )`
        : undefined;

    const partyOrCredit =
      partyMatch && creditMatch ? or(partyMatch, creditMatch) : (partyMatch ?? creditMatch);

    const caseRows = await this.db
      .select({
        id: auditCases.id,
        sourceRecordId: auditCases.sourceRecordId,
        createdAt: auditCases.createdAt,
      })
      .from(auditCases)
      .where(
        and(
          ne(auditCases.id, input.excludeCaseId),
          lt(auditCases.createdAt, input.createdBefore),
          partyOrCredit,
        ),
      );
    if (caseRows.length === 0) return [];

    const caseIds = caseRows.map((row) => row.id);
    const snapshotRows = await this.db
      .select({
        auditCaseId: auditSnapshots.auditCaseId,
        parties: auditSnapshots.parties,
        document: auditSnapshots.document,
        createdAt: auditSnapshots.createdAt,
      })
      .from(auditSnapshots)
      .where(inArray(auditSnapshots.auditCaseId, caseIds))
      .orderBy(desc(auditSnapshots.createdAt));

    const latestByCase = new Map<string, (typeof snapshotRows)[number]>();
    for (const row of snapshotRows) {
      if (!latestByCase.has(row.auditCaseId)) latestByCase.set(row.auditCaseId, row);
    }

    const verificationRows =
      input.creditCodes.length === 0
        ? []
        : await this.db
            .select({
              auditCaseId: subjectVerifications.auditCaseId,
              payload: subjectVerifications.payload,
            })
            .from(subjectVerifications)
            .where(inArray(subjectVerifications.auditCaseId, caseIds));

    const codesByCase = new Map<string, Set<string>>();
    for (const row of verificationRows) {
      const code = row.payload.matched?.unifiedSocialCreditCode;
      if (!code) continue;
      const set = codesByCase.get(row.auditCaseId) ?? new Set<string>();
      set.add(code);
      codesByCase.set(row.auditCaseId, set);
    }

    const nameSet = new Set(input.partyNames);
    const codeSet = new Set(input.creditCodes);
    const matched: Array<{
      caseId: string;
      sourceRecordId: string;
      partyName: string;
      title: string;
    }> = [];

    for (const caseRow of caseRows) {
      const snapshot = latestByCase.get(caseRow.id);
      if (!snapshot) continue;
      const parties = snapshot.parties;
      const named = parties.find((party) => nameSet.has(party.name));
      const codes = codesByCase.get(caseRow.id);
      const codeHit = codes ? [...codes].some((code) => codeSet.has(code)) : false;
      if (!named && !codeHit) continue;
      const partyName =
        named?.name ??
        parties.find((party) => party.label === "乙方")?.name ??
        parties[0]?.name ??
        "相对方";
      matched.push({
        caseId: caseRow.id,
        sourceRecordId: caseRow.sourceRecordId,
        partyName,
        title: contractTitleFromFirstBlock(snapshot.document.blocks[0]?.text) ?? "未命名合同",
      });
    }

    if (matched.length === 0) return [];

    const findings = await this.db
      .select()
      .from(findingRevisions)
      .where(
        inArray(
          findingRevisions.auditCaseId,
          matched.map((item) => item.caseId),
        ),
      );
    const superseded = new Set(
      findings.flatMap((row) => (row.supersedesId === null ? [] : [row.supersedesId])),
    );
    const heads = findings.filter((row) => !superseded.has(row.id) && row.review !== null);
    const byCase = new Map(matched.map((item) => [item.caseId, item]));
    const result: PriorPartyFinding[] = [];
    for (const row of heads) {
      const meta = byCase.get(row.auditCaseId);
      if (!meta || row.review === null) continue;
      result.push({
        priorCaseId: row.auditCaseId,
        sourceRecordId: meta.sourceRecordId,
        partyName: meta.partyName,
        findingRevisionId: row.id,
        findingType: row.proposal.findingType,
        decision: row.review.decision,
        reviewerId: row.review.reviewerId,
        reviewedAt: row.review.reviewedAt,
        title: meta.title,
      });
    }
    return result;
  }

  async savePartyHistory(caseId: string, run: PartyHistoryRun): Promise<void> {
    await this.db.insert(partyHistoryRecords).values({
      auditCaseId: caseId,
      payload: run,
      evidence: run.evidence,
    });
  }

  async getPartyHistory(caseId: string): Promise<PartyHistoryRun | null> {
    const [row] = await this.db
      .select()
      .from(partyHistoryRecords)
      .where(eq(partyHistoryRecords.auditCaseId, caseId))
      .orderBy(desc(partyHistoryRecords.createdAt))
      .limit(1);
    return row?.payload ?? null;
  }

  /**
   * Removes audit cases whose source record was planted by the demo seeder.
   * Operator pastes and uploads are left untouched.
   */
}
