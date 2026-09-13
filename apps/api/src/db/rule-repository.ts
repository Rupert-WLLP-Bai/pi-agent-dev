import type { ValidationCaseResult, ValidationSummary } from "@contract-audit/audit/golden-eval";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { DrizzleDB } from "./repositories";
import type { RuleParams, RuleStances, RuleVersionStatus, ValidationRunStatus } from "./schema";
import { rules, ruleVersions, schema, validationRuns } from "./schema";

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
    readonly status: 404 | 409,
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
      if (!run || run.status !== "passed") {
        const failed = run?.summary.failed ?? 0;
        throw new RuleRepositoryError(409, `验证未通过：${failed} 例失败`);
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
      .where(and(inArray(rules.code, [...codes]), eq(ruleVersions.status, "published")));
    return new Map(
      rows.map((row) => [
        row.code,
        { versionId: row.versionId, version: row.version, params: row.params },
      ]),
    );
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
