import { eq, not, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/repositories";
import { llmProviders } from "../db/schema";
import { llmKeyEncryptionSecret, openApiKey, sealApiKey } from "./api-key-crypto";

/** One-time style migration: encrypt plaintext rows when a secret is configured. */
export async function reencryptPlainLlmProviderKeys(db: DrizzleDB): Promise<number> {
  const secret = llmKeyEncryptionSecret();
  if (!secret) return 0;
  const rows = await db
    .select({ id: llmProviders.id, apiKey: llmProviders.apiKey })
    .from(llmProviders)
    .where(not(sql`${llmProviders.apiKey} LIKE 'enc:v1:%'`));
  let updated = 0;
  for (const row of rows) {
    const plain = openApiKey(row.apiKey);
    await db
      .update(llmProviders)
      .set({ apiKey: sealApiKey(plain), updatedAt: new Date() })
      .where(eq(llmProviders.id, row.id));
    updated += 1;
  }
  return updated;
}
