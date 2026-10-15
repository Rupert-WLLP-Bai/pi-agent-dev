import { and, eq, ne, not, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/repositories";
import { llmProviders, ocrSettings } from "../db/schema";
import { encryptApiKey, llmKeyEncryptionSecret } from "./api-key-crypto";

/** Encrypts legacy plaintext model and OCR keys before the API accepts work. */
export async function reencryptPlainApiKeys(db: DrizzleDB): Promise<number> {
  const secret = llmKeyEncryptionSecret();
  if (!secret) return 0;
  return db.transaction(async (tx) => {
    const providers = await tx
      .select({ id: llmProviders.id, apiKey: llmProviders.apiKey })
      .from(llmProviders)
      .where(and(ne(llmProviders.apiKey, ""), not(sql`${llmProviders.apiKey} LIKE 'enc:v1:%'`)))
      .for("update");
    const recognizers = await tx
      .select({ id: ocrSettings.id, apiKey: ocrSettings.vlmApiKey })
      .from(ocrSettings)
      .where(and(ne(ocrSettings.vlmApiKey, ""), not(sql`${ocrSettings.vlmApiKey} LIKE 'enc:v1:%'`)))
      .for("update");
    for (const row of providers) {
      await tx
        .update(llmProviders)
        .set({ apiKey: encryptApiKey(row.apiKey, secret), updatedAt: new Date() })
        .where(eq(llmProviders.id, row.id));
    }
    for (const row of recognizers) {
      await tx
        .update(ocrSettings)
        .set({ vlmApiKey: encryptApiKey(row.apiKey, secret), updatedAt: new Date() })
        .where(eq(ocrSettings.id, row.id));
    }
    return providers.length + recognizers.length;
  });
}
