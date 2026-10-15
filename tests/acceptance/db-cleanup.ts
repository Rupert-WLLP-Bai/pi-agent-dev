import postgres from "postgres";

/**
 * The database URL the acceptance run actually talks to.
 *
 * `playwright.config.ts` passes `PLAYWRIGHT_DATABASE_URL` to the API web server
 * through its structured `env` option (never through the command string, and
 * without sourcing root `.env`), so the specs and the API share one connection
 * string. This helper reads the same variable, which keeps cleanup pointed at
 * exactly the database the run wrote to.
 *
 * The `.env` fallback is gone, deliberately. Reading it pointed cleanup at the
 * developer's demo data whenever `PLAYWRIGHT_DATABASE_URL` happened to be
 * unset — the deletes then missed the rows the specs had just created and ran
 * against live data instead. An unset variable now fails the cleanup loudly,
 * because a cleanup that cannot name its target must not run at all. A local
 * dev run against the dev database is still possible: export
 * `PLAYWRIGHT_DATABASE_URL` with that URL, which is the same thing the browser
 * stack and the report layer are required to see.
 */
export function acceptanceDatabaseUrl(): string {
  const override = process.env.PLAYWRIGHT_DATABASE_URL;
  if (override === undefined || override.trim() === "") {
    throw new Error(
      "acceptance cleanup: PLAYWRIGHT_DATABASE_URL is not set — export the disposable database this run is scoped to (the same value playwright.config.ts passes to the API web server)",
    );
  }
  return override.trim();
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
      const sourceRows = await tx.unsafe<{ id: string }[]>(
        `SELECT DISTINCT source_record_id AS id FROM audit_cases WHERE id = ANY($1::uuid[])`,
        [unique],
      );
      for (const table of CASE_CHILD_TABLES) {
        await tx.unsafe(`DELETE FROM ${table} WHERE audit_case_id = ANY($1::uuid[])`, [unique]);
      }
      await tx.unsafe(`DELETE FROM audit_cases WHERE id = ANY($1::uuid[])`, [unique]);

      // Source Records only referenced by the removed cases: their originals
      // stay on disk (UPLOAD_DIR/S3) — a cleanup must not reach into storage,
      // which may be shared with a live stack.
      const unreferencedSources = await tx.unsafe<{ id: string }[]>(
        `SELECT id FROM source_records s WHERE id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM audit_cases c WHERE c.source_record_id = s.id)
           AND NOT EXISTS (
             SELECT 1 FROM contract_revisions r JOIN audit_cases c ON c.contract_revision_id = r.id
             WHERE r.source_record_id = s.id
           )`,
        [sourceRows.map((row) => row.id)],
      );
      const sourceIds = unreferencedSources.map((row) => row.id);
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
