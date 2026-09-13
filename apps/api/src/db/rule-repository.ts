import type { ValidationCaseResult, ValidationSummary } from "@contract-audit/audit/golden-eval";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { classifyValidationOutcome, type ValidationOutcome } from "../validation-diff";
import type { DrizzleDB } from "./repositories";
import type {
  RuleParams,
  RuleStances,
  RuleVersionStatus,
  ValidationCaseType,
  ValidationRunStatus,
} from "./schema";
import { rules, ruleVersions, schema, validationCases, validationRuns } from "./schema";

/**
 * Rule governance persistence, kept apart from AuditCaseRepository so the rule
 * lifecycle (versioned parameter sets, the validation gate, the publish
 * transition) reads as one coherent unit.
 */

export interface RuleRecord {
  id: string;
  code: string;
  name: string;
  contractType: string;
  description: string;
  enabled: boolean;
  disabledReason: string | null;
  disabledBy: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleVersionRecord {
  id: string;
  ruleId: string;
  version: number;
  params: RuleParams;
  stances: RuleStances;
  status: RuleVersionStatus;
  publishedBy: string | null;
  publishedAt: string | null;
  lastValidationRunId: string | null;
  createdAt: string;
}

export interface ValidationRunRecord {
  id: string;
  ruleVersionId: string;
  ruleCode: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string;
  status: ValidationRunStatus;
  summary: ValidationSummary;
  details: ValidationCaseResult[];
}

/** One materialised golden case, as the 案例验证 catalog lists it. */
export interface ValidationCaseListItem {
  id: string;
  ruleCode: string;
  caseType: ValidationCaseType;
  name: string;
  input: string;
  expectedDisposition: string;
  expectedNote: string;
  createdAt: string;
  /** The case's result in the newest run of its rule, when one exists. */
  latest: {
    runId: string;
    finishedAt: string;
    outcome: ValidationOutcome;
    expected: string;
    actual: string;
  } | null;
}

/** A row the validation-case seed writes; identity is (ruleCode, name). */
export interface SeedValidationCase {
  ruleCode: string;
  caseType: ValidationCaseType;
  name: string;
  input: string;
  expectedDisposition: string;
  expectedNote: string;
}

/** A run as the history list shows it: rule and version resolved, no case details. */
export interface ValidationRunListItem {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleVersion: number;
  versionStatus: RuleVersionStatus;
  status: ValidationRunStatus;
  summary: ValidationSummary;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string;
}

export interface ValidationRunDetail extends ValidationRunListItem {
  details: ValidationCaseResult[];
}

/** A rule row plus the columns the 规则管理 table renders. */
export interface RuleListItem extends RuleRecord {
  /** Highest version number on the rule — the draft when one is open. */
  currentVersion: number | null;
  /** Status of that highest version. */
  status: RuleVersionStatus | null;
  /** The newest validation run recorded against any of the rule's versions. */
  lastValidation: {
    status: ValidationRunStatus;
    finishedAt: string;
    summary: ValidationSummary;
  } | null;
  /** Publisher of the currently published version, if there is one. */
  publishedBy: string | null;
}

export interface RuleDetail {
  rule: RuleRecord;
  /** Every version, newest first. */
  versions: RuleVersionRecord[];
  /** The open draft, if any — at most one per rule. */
  activeDraft: RuleVersionRecord | null;
  /** The run that gates the open draft, when one has been recorded. */
  draftValidationRun: ValidationRunRecord | null;
}

export interface SeedRule {
  code: string;
  name: string;
  contractType: string;
  description: string;
  params: RuleParams;
  stances: RuleStances;
}

/**
 * A rule-governance failure the route turns straight into an HTTP status:
 * 404 for an unknown id, 409 for a state conflict (duplicate code, an open
 * draft, a validation gate that has not been satisfied).
 */
export class RuleRepositoryError extends Error {
  constructor(
    readonly status: 404 | 409 | 400,
    message: string,
  ) {
    super(message);
    this.name = "RuleRepositoryError";
  }
}

const toRule = (row: typeof rules.$inferSelect): RuleRecord => ({
  id: row.id,
  code: row.code,
  name: row.name,
  contractType: row.contractType,
  description: row.description,
  enabled: row.enabled,
  disabledReason: row.disabledReason,
  disabledBy: row.disabledBy,
  disabledAt: row.disabledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toVersion = (row: typeof ruleVersions.$inferSelect): RuleVersionRecord => ({
  id: row.id,
  ruleId: row.ruleId,
  version: row.version,
  params: row.params,
  stances: row.stances,
  status: row.status,
  publishedBy: row.publishedBy,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  lastValidationRunId: row.lastValidationRunId,
  createdAt: row.createdAt.toISOString(),
});

const toRun = (row: typeof validationRuns.$inferSelect): ValidationRunRecord => ({
  id: row.id,
  ruleVersionId: row.ruleVersionId,
  ruleCode: row.ruleCode,
  triggeredBy: row.triggeredBy,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt.toISOString(),
  status: row.status,
  summary: row.summary,
  details: row.details,
});

/** The joined shape every run read projects from. */
interface ValidationRunProjection {
  id: string;
  ruleCode: string;
  triggeredBy: string;
  startedAt: Date;
  finishedAt: Date;
  status: ValidationRunStatus;
  summary: ValidationSummary;
  details: ValidationCaseResult[];
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  versionStatus: RuleVersionStatus;
}

const toRunListItem = (row: ValidationRunProjection): ValidationRunListItem => ({
  id: row.id,
  ruleId: row.ruleId,
  ruleCode: row.ruleCode,
  ruleName: row.ruleName,
  ruleVersion: row.ruleVersion,
  versionStatus: row.versionStatus,
  status: row.status,
  summary: row.summary,
  triggeredBy: row.triggeredBy,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt.toISOString(),
});

export class RuleRepository {
  constructor(private readonly db: DrizzleDB) {}

  /** Every rule with the columns the table needs, in creation order. */
  async listRules(): Promise<RuleListItem[]> {
    const ruleRows = await this.db.select().from(rules).orderBy(rules.createdAt, rules.code);
    if (ruleRows.length === 0) return [];

    const versionRows = await this.db
      .select()
      .from(ruleVersions)
      .orderBy(ruleVersions.ruleId, desc(ruleVersions.version));
    const runIds = [
      ...new Set(
        versionRows.map((row) => row.lastValidationRunId).filter((id): id is string => id !== null),
      ),
    ];
    const runRows =
      runIds.length === 0
        ? []
        : await this.db.select().from(validationRuns).where(inArray(validationRuns.id, runIds));
    const runById = new Map(runRows.map((row) => [row.id, row]));

    return ruleRows.map((ruleRow) => {
      const versions = versionRows.filter((row) => row.ruleId === ruleRow.id);
      const latest = versions[0] ?? null;
      const published = versions.find((row) => row.status === "published") ?? null;

      let lastValidation: RuleListItem["lastValidation"] = null;
      for (const version of versions) {
        const run = version.lastValidationRunId
          ? runById.get(version.lastValidationRunId)
          : undefined;
        if (run) {
          lastValidation = {
            status: run.status,
            finishedAt: run.finishedAt.toISOString(),
            summary: run.summary,
          };
          break;
        }
      }

      return {
        ...toRule(ruleRow),
        currentVersion: latest?.version ?? null,
        status: latest?.status ?? null,
        lastValidation,
        publishedBy: published?.publishedBy ?? null,
      };
    });
  }

  async getRuleDetail(id: string): Promise<RuleDetail | null> {
    const [ruleRow] = await this.db.select().from(rules).where(eq(rules.id, id)).limit(1);
    if (!ruleRow) return null;

    const versionRows = await this.db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.ruleId, id))
      .orderBy(desc(ruleVersions.version));
    const versions = versionRows.map(toVersion);
    const activeDraft = versions.find((version) => version.status === "draft") ?? null;

    let draftValidationRun: ValidationRunRecord | null = null;
    if (activeDraft?.lastValidationRunId) {
      const [runRow] = await this.db
        .select()
        .from(validationRuns)
        .where(eq(validationRuns.id, activeDraft.lastValidationRunId))
        .limit(1);
      draftValidationRun = runRow ? toRun(runRow) : null;
    }

    return { rule: toRule(ruleRow), versions, activeDraft, draftValidationRun };
  }

  /** Creates a rule and opens its first draft version in one transaction. */
  async createRule(input: {
    code: string;
    name: string;
    contractType: string;
    description: string;
    params: RuleParams;
    stances: RuleStances;
  }): Promise<RuleDetail> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: rules.id })
        .from(rules)
        .where(eq(rules.code, input.code))
        .limit(1);
      if (existing) throw new RuleRepositoryError(409, `规则代码已存在：${input.code}`);

      const [ruleRow] = await tx
        .insert(rules)
        .values({
          code: input.code,
          name: input.name,
          contractType: input.contractType,
          description: input.description,
        })
        .returning();
      const [versionRow] = await tx
        .insert(ruleVersions)
        .values({
          ruleId: ruleRow.id,
          version: 1,
          params: input.params,
          stances: input.stances,
          status: "draft",
        })
        .returning();

      return {
        rule: toRule(ruleRow),
        versions: [toVersion(versionRow)],
        activeDraft: toVersion(versionRow),
        draftValidationRun: null,
      };
    });
  }

  /** Updates a rule's descriptive fields. Versions are not touched here. */
  async updateRule(
    id: string,
    input: { name?: string; contractType?: string; description?: string },
  ): Promise<RuleRecord> {
    const patch: Partial<typeof rules.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.contractType !== undefined) patch.contractType = input.contractType;
    if (input.description !== undefined) patch.description = input.description;

    const [row] = await this.db.update(rules).set(patch).where(eq(rules.id, id)).returning();
    if (!row) throw new RuleRepositoryError(404, "规则不存在");
    return toRule(row);
  }

  /** Disables a rule from new audits. Idempotent: re-disabling updates reason. */
  async disableRule(id: string, input: { reason: string; actor: string }): Promise<RuleRecord> {
    const reason = input.reason.trim();
    if (reason === "") throw new RuleRepositoryError(400, "停用原因不能为空");
    const [row] = await this.db
      .update(rules)
      .set({
        enabled: false,
        disabledReason: reason,
        disabledBy: input.actor,
        disabledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rules.id, id))
      .returning();
    if (!row) throw new RuleRepositoryError(404, "规则不存在");
    return toRule(row);
  }

  /** Re-enables a rule for new audits. Clears the overlay fields. */
  async enableRule(id: string, _input: { actor: string }): Promise<RuleRecord> {
    const [row] = await this.db
      .update(rules)
      .set({
        enabled: true,
        disabledReason: null,
        disabledBy: null,
        disabledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(rules.id, id))
      .returning();
    if (!row) throw new RuleRepositoryError(404, "规则不存在");
    return toRule(row);
  }

  /** The rule codes currently enabled for new audits. */
  async listEnabledCodes(): Promise<string[]> {
    const rows = await this.db
      .select({ code: rules.code })
      .from(rules)
      .where(eq(rules.enabled, true));
    return rows.map((row) => row.code);
  }

  /**
   * Opens the next draft version. A rule carries at most one draft: a second
   * request while one is open is a conflict, not a silent overwrite.
   */
  async createVersion(
    ruleId: string,
    input: { params: RuleParams; stances: RuleStances },
  ): Promise<RuleVersionRecord> {
    return this.db.transaction(async (tx) => {
      const [ruleRow] = await tx
        .select({ id: rules.id })
        .from(rules)
        .where(eq(rules.id, ruleId))
        .limit(1);
      if (!ruleRow) throw new RuleRepositoryError(404, "规则不存在");

      const [draft] = await tx
        .select({ id: ruleVersions.id })
        .from(ruleVersions)
        .where(and(eq(ruleVersions.ruleId, ruleId), eq(ruleVersions.status, "draft")))
        .limit(1);
      if (draft) throw new RuleRepositoryError(409, "该规则已存在草稿版本，请先更新该草稿");

      const [latest] = await tx
        .select({ version: ruleVersions.version })
        .from(ruleVersions)
        .where(eq(ruleVersions.ruleId, ruleId))
        .orderBy(desc(ruleVersions.version))
        .limit(1);

      const [row] = await tx
        .insert(ruleVersions)
        .values({
          ruleId,
          version: (latest?.version ?? 0) + 1,
          params: input.params,
          stances: input.stances,
          status: "draft",
        })
        .returning();
      await tx.update(rules).set({ updatedAt: new Date() }).where(eq(rules.id, ruleId));
      return toVersion(row);
    });
  }

  /**
   * Revises an open draft's parameters and stances in place. Published versions
   * are immutable — they are what a past assessment cited.
   */
  async updateDraft(
    ruleId: string,
    versionId: string,
    input: { params: RuleParams; stances: RuleStances },
  ): Promise<RuleVersionRecord> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(ruleVersions)
        .where(and(eq(ruleVersions.id, versionId), eq(ruleVersions.ruleId, ruleId)))
        .limit(1);
      if (!existing) throw new RuleRepositoryError(404, "规则版本不存在");
      if (existing.status !== "draft") throw new RuleRepositoryError(409, "只有草稿版本可以修改");

      const [row] = await tx
        .update(ruleVersions)
        .set({ params: input.params, stances: input.stances })
        .where(eq(ruleVersions.id, versionId))
        .returning();
      await tx.update(rules).set({ updatedAt: new Date() }).where(eq(rules.id, ruleId));
      return toVersion(row);
    });
  }

  /** Persists one validation run and points the version at it. */
  async recordValidation(input: {
    ruleVersionId: string;
    ruleCode: string;
    triggeredBy: string;
    startedAt: Date;
    summary: ValidationSummary;
    details: ValidationCaseResult[];
  }): Promise<ValidationRunRecord> {
    const status: ValidationRunStatus = input.summary.failed === 0 ? "passed" : "failed";
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(validationRuns)
        .values({
          ruleVersionId: input.ruleVersionId,
          ruleCode: input.ruleCode,
          triggeredBy: input.triggeredBy,
          startedAt: input.startedAt,
          finishedAt: new Date(),
          status,
          summary: input.summary,
          details: input.details,
        })
        .returning();
      await tx
        .update(ruleVersions)
        .set({ lastValidationRunId: row.id })
        .where(eq(ruleVersions.id, input.ruleVersionId));
      return toRun(row);
    });
  }

  /**
   * Publishes the open draft. The gate is the draft's latest validation run:
   * no run, or a red run, is a 409 with the reason the UI shows, so the button
   * can explain itself rather than failing after the click.
   */
  async publish(
    ruleId: string,
    publishedBy: string,
  ): Promise<{ rule: RuleRecord; version: RuleVersionRecord; retiredVersionId: string | null }> {
    return this.db.transaction(async (tx) => {
      const [ruleRow] = await tx.select().from(rules).where(eq(rules.id, ruleId)).limit(1);
      if (!ruleRow) throw new RuleRepositoryError(404, "规则不存在");

      const [draft] = await tx
        .select()
        .from(ruleVersions)
        .where(and(eq(ruleVersions.ruleId, ruleId), eq(ruleVersions.status, "draft")))
        .limit(1)
        .for("update");
      if (!draft) throw new RuleRepositoryError(409, "没有待发布的草稿版本");
      if (!draft.lastValidationRunId) throw new RuleRepositoryError(409, "尚未运行验证");

      const [run] = await tx
        .select()
        .from(validationRuns)
        .where(eq(validationRuns.id, draft.lastValidationRunId))
        .limit(1);
      if (run?.status !== "passed") {
        const failed = run?.summary.failed ?? 0;
        throw new RuleRepositoryError(409, `验证未通过：${failed} 例失败`);
      }

      // A green run with zero cases means there is nothing to validate — the
      // golden set is empty. The only exception is SUBJECT_RED_LINE_RISK, whose
      // subject dimension is determined by external verification, not contract cases.
      const PUBLISH_WITHOUT_CONTRACT_GOLDEN: readonly string[] = ["SUBJECT_RED_LINE_RISK"];
      if (run?.summary.total === 0 && !PUBLISH_WITHOUT_CONTRACT_GOLDEN.includes(ruleRow.code)) {
        throw new RuleRepositoryError(409, "没有可验证的案例，不能发布");
      }

      const retired = await tx
        .update(ruleVersions)
        .set({ status: "retired" })
        .where(and(eq(ruleVersions.ruleId, ruleId), eq(ruleVersions.status, "published")))
        .returning({ id: ruleVersions.id });

      const [published] = await tx
        .update(ruleVersions)
        .set({ status: "published", publishedBy, publishedAt: new Date() })
        .where(eq(ruleVersions.id, draft.id))
        .returning();
      await tx.update(rules).set({ updatedAt: new Date() }).where(eq(rules.id, ruleId));

      return {
        rule: toRule(ruleRow),
        version: toVersion(published),
        retiredVersionId: retired[0]?.id ?? null,
      };
    });
  }

  /**
   * The published version of each requested rule code, for the audit path to
   * read parameters from. Absent codes are simply missing from the map, so a
   * caller falls back to code defaults rather than failing the audit.
   */
  async getPublishedVersions(
    codes: readonly string[],
  ): Promise<Map<string, { versionId: string; version: number; params: RuleParams }>> {
    if (codes.length === 0) return new Map();
    const rows = await this.db
      .select({
        code: rules.code,
        versionId: ruleVersions.id,
        version: ruleVersions.version,
        params: ruleVersions.params,
      })
      .from(ruleVersions)
      .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
      .where(
        and(
          inArray(rules.code, [...codes]),
          eq(ruleVersions.status, "published"),
          eq(rules.enabled, true),
        ),
      );
    return new Map(
      rows.map((row) => [
        row.code,
        { versionId: row.versionId, version: row.version, params: row.params },
      ]),
    );
  }

  // ── Validation case catalog ────────────────────────────────────

  /**
   * The materialised golden cases, each carrying its result in the newest run
   * of its rule — the list the 案例验证 page renders.
   */
  async listValidationCases(
    filter: { ruleCode?: string; caseType?: ValidationCaseType } = {},
  ): Promise<ValidationCaseListItem[]> {
    const conditions = [];
    if (filter.ruleCode !== undefined) {
      conditions.push(eq(validationCases.ruleCode, filter.ruleCode));
    }
    if (filter.caseType !== undefined) {
      conditions.push(eq(validationCases.caseType, filter.caseType));
    }
    const caseRows = await this.db
      .select()
      .from(validationCases)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(validationCases.ruleCode, validationCases.caseType, validationCases.name);
    if (caseRows.length === 0) return [];

    const codes = [...new Set(caseRows.map((row) => row.ruleCode))];
    const runRows = await this.db
      .select()
      .from(validationRuns)
      .where(inArray(validationRuns.ruleCode, codes))
      .orderBy(desc(validationRuns.finishedAt), desc(validationRuns.startedAt));
    const latestRunByCode = new Map<string, (typeof runRows)[number]>();
    for (const run of runRows) {
      if (!latestRunByCode.has(run.ruleCode)) latestRunByCode.set(run.ruleCode, run);
    }

    return caseRows.map((row) => {
      const run = latestRunByCode.get(row.ruleCode);
      const result = run?.details.find((item) => item.caseName === row.name);
      return {
        id: row.id,
        ruleCode: row.ruleCode,
        caseType: row.caseType,
        name: row.name,
        input: row.input,
        expectedDisposition: row.expectedDisposition,
        expectedNote: row.expectedNote,
        createdAt: row.createdAt.toISOString(),
        latest:
          run !== undefined && result !== undefined
            ? {
                runId: run.id,
                finishedAt: run.finishedAt.toISOString(),
                outcome: classifyValidationOutcome(result),
                expected: result.expected,
                actual: result.actual,
              }
            : null,
      };
    });
  }

  /**
   * Materialises seed cases. Identity is (rule code, name), so a case an
   * operator has annotated is never rewritten and only genuinely new cases
   * are inserted on a later boot.
   */
  async bootstrapValidationCases(seeds: readonly SeedValidationCase[]): Promise<number> {
    if (seeds.length === 0) return 0;
    const rows = await this.db
      .insert(validationCases)
      .values([...seeds])
      .onConflictDoNothing({ target: [validationCases.ruleCode, validationCases.name] })
      .returning({ id: validationCases.id });
    return rows.length;
  }

  async countValidationCases(): Promise<number> {
    const rows = await this.db.select({ id: validationCases.id }).from(validationCases);
    return rows.length;
  }

  // ── Validation run history ─────────────────────────────────────

  /** Runs newest first, optionally scoped to one rule code. */
  async listValidationRuns(
    options: { ruleCode?: string; limit?: number } = {},
  ): Promise<ValidationRunListItem[]> {
    const rows = await this.runJoin(
      options.ruleCode === undefined ? undefined : eq(validationRuns.ruleCode, options.ruleCode),
    )
      .orderBy(desc(validationRuns.finishedAt), desc(validationRuns.startedAt))
      .limit(options.limit ?? 100);
    return rows.map(toRunListItem);
  }

  async getValidationRunDetail(id: string): Promise<ValidationRunDetail | null> {
    const [row] = await this.runJoin(eq(validationRuns.id, id)).limit(1);
    if (!row) return null;
    return { ...toRunListItem(row), details: row.details };
  }

  /**
   * The run immediately older than `currentId` for the same rule, whatever
   * version it validated — the baseline a regression diff is read against.
   */
  async getPreviousValidationRun(
    ruleCode: string,
    currentId: string,
  ): Promise<ValidationRunDetail | null> {
    const rows = await this.runJoin(eq(validationRuns.ruleCode, ruleCode))
      .orderBy(desc(validationRuns.finishedAt), desc(validationRuns.startedAt))
      .limit(50);
    const index = rows.findIndex((row) => row.id === currentId);
    const prior =
      index >= 0 ? (rows[index + 1] ?? null) : (rows.find((row) => row.id !== currentId) ?? null);
    if (!prior) return null;
    return { ...toRunListItem(prior), details: prior.details };
  }

  /** Every run join projects the same columns; only the filter differs. */
  private runJoin(condition?: SQL) {
    return this.db
      .select({
        id: validationRuns.id,
        ruleCode: validationRuns.ruleCode,
        triggeredBy: validationRuns.triggeredBy,
        startedAt: validationRuns.startedAt,
        finishedAt: validationRuns.finishedAt,
        status: validationRuns.status,
        summary: validationRuns.summary,
        details: validationRuns.details,
        ruleId: rules.id,
        ruleName: rules.name,
        ruleVersion: ruleVersions.version,
        versionStatus: ruleVersions.status,
      })
      .from(validationRuns)
      .innerJoin(ruleVersions, eq(ruleVersions.id, validationRuns.ruleVersionId))
      .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
      .where(condition);
  }

  /**
   * Idempotent bootstrap: inserts the seed rules that do not exist yet, each
   * with a published v1. Existing rows — including ones an operator has since
   * versioned — are never rewritten.
   */
  async bootstrapRules(seeds: readonly SeedRule[], publishedBy: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      let created = 0;
      for (const seed of seeds) {
        const [existing] = await tx
          .select({ id: rules.id })
          .from(rules)
          .where(eq(rules.code, seed.code))
          .limit(1);
        if (existing) continue;

        const [ruleRow] = await tx
          .insert(rules)
          .values({
            code: seed.code,
            name: seed.name,
            contractType: seed.contractType,
            description: seed.description,
          })
          .returning({ id: rules.id });
        await tx.insert(ruleVersions).values({
          ruleId: ruleRow.id,
          version: 1,
          params: seed.params,
          stances: seed.stances,
          status: "published",
          publishedBy,
          publishedAt: new Date(),
        });
        created += 1;
      }
      return created;
    });
  }
}

export function createRuleRepository(databaseUrl: string): RuleRepository {
  const client = postgres(databaseUrl);
  return new RuleRepository(drizzle({ client, schema }));
}
