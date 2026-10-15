import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * The database URL the acceptance run actually talks to.
 *
 * The Playwright webServer is started by `playwright.config.ts` with `.env`
 * sourced and then `PLAYWRIGHT_DATABASE_URL` applied on top, so the specs and
 * the API share one connection string. Reading `.env` alone — as these specs
 * used to do — pointed the cleanup at whatever `.env` holds even when the run
 * was explicitly scoped to a scratch database: the deletes then missed the rows
 * the specs had just created and silently ran against the developer's demo
 * data instead. Both layers are applied here in the same order, and a missing
 * `PLAYWRIGHT_DATABASE_URL` means "no override", exactly as in the config.
 *
 * Resolving the URL is not enough on its own: the specs connect to it directly,
 * so an unset value must fail the cleanup loudly rather than fall back to some
 * other default and delete nothing (or worse, something else).
 */
export function acceptanceDatabaseUrl(): string {
  const override = process.env.PLAYWRIGHT_DATABASE_URL;
  if (override !== undefined && override.trim() !== "") return override.trim();

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) {
    throw new Error(
      "acceptance cleanup: .env not found and PLAYWRIGHT_DATABASE_URL unset — refusing to guess a database",
    );
  }
  const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envPath, "utf8"));
  if (!match || match[1].trim() === "") {
    throw new Error(
      "acceptance cleanup: DATABASE_URL missing from .env — refusing to guess a database",
    );
  }
  return match[1].trim();
}

/** Tables that carry an `audit_case_id` column, in child-first delete order. */
const CASE_CHILD_TABLES = [
  "remediations",
  "finding_revisions",
  "agent_trace_steps",
  "agent_runs",
  "party_history_records",
  "subject_verifications",
  "audit_snapshots",
] as const;

/**
 * Removes every row that belongs to the given audit cases, then the cases
 * themselves, then the Source Records / Contract Revisions / Contracts they
 * were the only revision of.
 *
 * The scope is exact: only ids collected during this run are touched, and the
 * relation walk stops at the first revision that still has a case, so a
 * contract the operator is working on elsewhere survives. This is a cleanup
 * helper for data these specs created — it is never a database reset, and it
 * deliberately shares the demo-seeder's table list so a spec that planted a
 * demo case can also be cleaned up by it.
 *
 * Each statement is one round trip per id list; a failure aborts before the
 * case rows are deleted so the caller can inspect what is left.
 */
export async function deleteCasesAndRelations(caseIds: readonly string[]): Promise<void> {
  const unique = [...new Set(caseIds)];
  if (unique.length === 0) return;
  const sql = postgres(acceptanceDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      for (const table of CASE_CHILD_TABLES) {
        await tx.unsafe(`DELETE FROM ${table} WHERE audit_case_id = ANY($1::uuid[])`, [unique]);
      }
      await tx.unsafe(`DELETE FROM audit_cases WHERE id = ANY($1::uuid[])`, [unique]);

      // Source Records only referenced by the removed cases: their originals
      // stay on disk (UPLOAD_DIR/S3) — a cleanup must not reach into storage,
      // which may be shared with a live stack.
      const sourceRows = await tx.unsafe<{ id: string }[]>(
        `SELECT id FROM source_records WHERE id IN (
           SELECT source_record_id FROM audit_cases WHERE id = ANY($1::uuid[])
         )`,
        [unique],
      );
      const sourceIds = sourceRows.map((row) => row.id);
      if (sourceIds.length === 0) return;

      const revisionRows = await tx.unsafe<{ contract_id: string }[]>(
        `SELECT contract_id FROM contract_revisions WHERE source_record_id = ANY($1::uuid[])`,
        [sourceIds],
      );
      await tx.unsafe(`DELETE FROM contract_revisions WHERE source_record_id = ANY($1::uuid[])`, [
        sourceIds,
      ]);

      // A contract is dropped only when this cleanup removed its last
      // revision — the operator's own contracts are never touched.
      const contractIds = [...new Set(revisionRows.map((row) => row.contract_id))];
      for (const contractId of contractIds) {
        const remaining = await tx.unsafe<{ id: string }[]>(
          `SELECT id FROM contract_revisions WHERE contract_id = $1 LIMIT 1`,
          [contractId],
        );
        if (remaining.length === 0) {
          await tx.unsafe(`DELETE FROM contracts WHERE id = $1`, [contractId]);
        }
      }
      await tx.unsafe(`DELETE FROM source_records WHERE id = ANY($1::uuid[])`, [sourceIds]);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
