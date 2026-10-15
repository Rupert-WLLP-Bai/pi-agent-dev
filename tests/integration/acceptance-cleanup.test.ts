import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { deleteCasesAndRelations } from "../acceptance/db-cleanup";
import { connectIntegrationDatabase } from "./db";

const configured = Boolean(
  process.env.TEST_DATABASE_URL ||
    (process.env.INTEGRATION_ALLOW_DEFAULT_DB === "1" && process.env.DATABASE_URL),
);

test.skipIf(!configured)(
  "acceptance cleanup removes exclusive sources and preserves a shared revision's other case",
  async () => {
    const database = await connectIntegrationDatabase();
    const sql = database.handle.client;
    const soleSource = randomUUID();
    const sharedSource = randomUUID();
    const soleContract = randomUUID();
    const sharedContract = randomUUID();
    const soleRevision = randomUUID();
    const sharedRevision = randomUUID();
    const soleCase = randomUUID();
    const sharedCase = randomUUID();
    const neighbor = randomUUID();
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO source_records (id, source_text) VALUES
          (${soleSource}, 'cleanup sole source'), (${sharedSource}, 'cleanup shared source')`;
        await tx`INSERT INTO contracts (id, title) VALUES
          (${soleContract}, 'cleanup sole contract'), (${sharedContract}, 'cleanup shared contract')`;
        await tx`INSERT INTO contract_revisions (id, contract_id, version, source_record_id) VALUES
          (${soleRevision}, ${soleContract}, 1, ${soleSource}),
          (${sharedRevision}, ${sharedContract}, 1, ${sharedSource})`;
        await tx`INSERT INTO audit_cases
          (id, status, stage, source_record_id, contract_revision_id) VALUES
          (${soleCase}, 'COMPLETED', 'COMPLETED', ${soleSource}, ${soleRevision}),
          (${sharedCase}, 'COMPLETED', 'COMPLETED', ${sharedSource}, ${sharedRevision}),
          (${neighbor}, 'COMPLETED', 'COMPLETED', ${sharedSource}, ${sharedRevision})`;
      });
      const previous = process.env.PLAYWRIGHT_DATABASE_URL;
      process.env.PLAYWRIGHT_DATABASE_URL = database.url;
      try {
        await deleteCasesAndRelations([soleCase, sharedCase]);
      } finally {
        if (previous === undefined) delete process.env.PLAYWRIGHT_DATABASE_URL;
        else process.env.PLAYWRIGHT_DATABASE_URL = previous;
      }
      const [remaining] = await sql`SELECT
        (SELECT count(*)::int FROM source_records WHERE id = ${soleSource}) AS sole_source,
        (SELECT count(*)::int FROM contract_revisions WHERE id = ${soleRevision}) AS sole_revision,
        (SELECT count(*)::int FROM contracts WHERE id = ${soleContract}) AS sole_contract,
        (SELECT count(*)::int FROM source_records WHERE id = ${sharedSource}) AS shared_source,
        (SELECT count(*)::int FROM contract_revisions WHERE id = ${sharedRevision}) AS shared_revision,
        (SELECT count(*)::int FROM contracts WHERE id = ${sharedContract}) AS shared_contract,
        (SELECT count(*)::int FROM audit_cases WHERE id = ${neighbor}) AS neighbor,
        (SELECT count(*)::int FROM audit_cases WHERE id IN (${soleCase}, ${sharedCase})) AS removed_cases`;
      expect(remaining).toEqual({
        sole_source: 0,
        sole_revision: 0,
        sole_contract: 0,
        shared_source: 1,
        shared_revision: 1,
        shared_contract: 1,
        neighbor: 1,
        removed_cases: 0,
      });
    } finally {
      try {
        await sql.begin(async (tx) => {
          await tx`DELETE FROM audit_cases WHERE id IN (${soleCase}, ${sharedCase}, ${neighbor})`;
          await tx`DELETE FROM contract_revisions WHERE id IN (${soleRevision}, ${sharedRevision})`;
          await tx`DELETE FROM contracts WHERE id IN (${soleContract}, ${sharedContract})`;
          await tx`DELETE FROM source_records WHERE id IN (${soleSource}, ${sharedSource})`;
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  },
);
