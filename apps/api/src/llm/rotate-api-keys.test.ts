import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDb, type DrizzleDB } from "../db/repositories";
import { llmProviders, ocrSettings } from "../db/schema";
import { decryptApiKey, encryptApiKey } from "./api-key-crypto";
import { rotateStoredApiKeys } from "./rotate-api-keys";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://contract_audit:contract_audit@localhost:5432/contract_audit";
const probe = createDb(databaseUrl);
const reachable = await probe.client`SELECT 1`.then(() => true).catch(() => false);
await probe.client.end();
const dbTest = reachable ? test : test.skip;
const oldSecret = "old-encryption-secret-for-rotation-tests";
const nextSecret = "next-encryption-secret-for-rotation-tests";

// PostgreSQL temporary tables shadow only this connection's credential tables.
// This exercises real transactions and row locks without touching stored user keys.
dbTest(
  "credential rotation dry-run, apply and corrupt-row rollback span both key stores",
  async () => {
    const { db, client } = createDb(databaseUrl);
    const providerId = crypto.randomUUID();
    const ocrId = crypto.randomUUID();
    try {
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`CREATE TEMP TABLE llm_providers (id uuid PRIMARY KEY, api_key text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`,
        );
        await transaction.execute(
          sql`CREATE TEMP TABLE ocr_settings (id uuid PRIMARY KEY, vlm_api_key text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`,
        );
        await transaction.execute(
          sql`INSERT INTO llm_providers (id, api_key) VALUES (${providerId}, ${encryptApiKey("provider-secret", oldSecret)})`,
        );
        await transaction.execute(
          sql`INSERT INTO ocr_settings (id, vlm_api_key) VALUES (${ocrId}, ${encryptApiKey("ocr-secret", oldSecret)})`,
        );
        // Drizzle transactions support the same nested transaction/savepoint surface.
        const scoped = transaction as unknown as DrizzleDB;
        const before = await scoped.select({ stored: llmProviders.apiKey }).from(llmProviders);
        expect(await rotateStoredApiKeys(scoped, oldSecret, nextSecret, false)).toEqual({
          applied: false,
          providerKeys: 1,
          ocrKeys: 1,
        });
        expect(await scoped.select({ stored: llmProviders.apiKey }).from(llmProviders)).toEqual(
          before,
        );
        expect(await rotateStoredApiKeys(scoped, oldSecret, nextSecret, true)).toEqual({
          applied: true,
          providerKeys: 1,
          ocrKeys: 1,
        });
        const [provider] = await scoped.select({ stored: llmProviders.apiKey }).from(llmProviders);
        const [recognizer] = await scoped
          .select({ stored: ocrSettings.vlmApiKey })
          .from(ocrSettings);
        expect(decryptApiKey(provider.stored, nextSecret)).toBe("provider-secret");
        expect(decryptApiKey(recognizer.stored, nextSecret)).toBe("ocr-secret");
        expect(() => decryptApiKey(provider.stored, oldSecret)).toThrow();
        await scoped
          .update(ocrSettings)
          .set({ vlmApiKey: "enc:v1:corrupt" })
          .where(eq(ocrSettings.id, ocrId));
        const stableProvider = provider.stored;
        await expect(rotateStoredApiKeys(scoped, nextSecret, oldSecret, true)).rejects.toThrow();
        const [afterFailure] = await scoped
          .select({ stored: llmProviders.apiKey })
          .from(llmProviders);
        expect(afterFailure.stored).toBe(stableProvider);
        await expect(rotateStoredApiKeys(scoped, nextSecret, "short", true)).rejects.toThrow(
          "NEXT_ENCRYPTION_SECRET_REQUIRES_32_TO_512_CHARACTERS",
        );
      });
    } finally {
      await client.end();
    }
  },
);
