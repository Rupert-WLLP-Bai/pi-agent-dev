import { eq, sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { createDb, type DrizzleDB } from "../db/repositories";
import { llmProviders, ocrSettings } from "../db/schema";
import { decryptApiKey, encryptApiKey } from "./api-key-crypto";

export interface KeyRotationResult {
  applied: boolean;
  providerKeys: number;
  ocrKeys: number;
}
/** Rewraps both credential stores atomically; callers stop the API before changing its key. */
export async function rotateStoredApiKeys(
  db: DrizzleDB,
  currentSecret: string | null,
  nextSecret: string,
  apply: boolean,
): Promise<KeyRotationResult> {
  if (nextSecret.length < 32 || nextSecret.length > 512 || /\s/u.test(nextSecret)) {
    throw new Error("NEXT_ENCRYPTION_SECRET_REQUIRES_32_TO_512_CHARACTERS");
  }
  if (nextSecret === currentSecret) throw new Error("NEXT_ENCRYPTION_SECRET_MUST_DIFFER");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('contract-audit-key-rotation'))`);
    const providers = await tx
      .select({ id: llmProviders.id, stored: llmProviders.apiKey })
      .from(llmProviders)
      .for("update");
    const recognizers = await tx
      .select({ id: ocrSettings.id, stored: ocrSettings.vlmApiKey })
      .from(ocrSettings)
      .for("update");
    let providerKeys = 0;
    let ocrKeys = 0;
    for (const row of providers) {
      if (!row.stored) continue;
      const plain = decryptApiKey(row.stored, currentSecret);
      if (apply) {
        await tx
          .update(llmProviders)
          .set({ apiKey: encryptApiKey(plain, nextSecret), updatedAt: new Date() })
          .where(eq(llmProviders.id, row.id));
      }
      providerKeys += 1;
    }
    for (const row of recognizers) {
      if (!row.stored) continue;
      const plain = decryptApiKey(row.stored, currentSecret);
      if (apply) {
        await tx
          .update(ocrSettings)
          .set({ vlmApiKey: encryptApiKey(plain, nextSecret), updatedAt: new Date() })
          .where(eq(ocrSettings.id, row.id));
      }
      ocrKeys += 1;
    }
    return { applied: apply, providerKeys, ocrKeys };
  });
}

if (import.meta.main) {
  let client: Sql | undefined;
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_.some((argument) => argument !== "--apply")) throw new Error("INVALID_ARGUMENT");
    const databaseUrl = process.env.DATABASE_URL;
    const databaseName = process.env.ROTATE_DATABASE_NAME;
    const nextSecret = process.env.LLM_KEY_ENCRYPTION_SECRET_NEXT;
    if (!databaseUrl || !databaseName || !nextSecret)
      throw new Error("ROTATION_ENVIRONMENT_REQUIRED");
    const handle = createDb(databaseUrl);
    client = handle.client;
    const [identity] = await handle.db.execute<{ database_name: string }>(
      sql`SELECT current_database() AS database_name`,
    );
    if (identity?.database_name !== databaseName)
      throw new Error("ROTATION_DATABASE_IDENTITY_MISMATCH");
    const result = await rotateStoredApiKeys(
      handle.db,
      process.env.LLM_KEY_ENCRYPTION_SECRET?.trim() || null,
      nextSecret,
      arguments_.includes("--apply"),
    );
    console.info(JSON.stringify({ event: "key_rotation", databaseName, ...result }));
  } catch {
    // Crypto/database errors may contain connection details. The CLI exposes only a stable code.
    console.error("KEY_ROTATION_FAILED_CHECK_DATABASE_IDENTITY_AND_SECRETS");
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
