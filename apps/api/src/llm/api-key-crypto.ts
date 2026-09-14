import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

const keyBytes = (secret: string): Buffer => createHash("sha256").update(secret).digest();

export function llmKeyEncryptionSecret(): string | null {
  const secret = process.env.LLM_KEY_ENCRYPTION_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

export function encryptApiKey(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptApiKey(stored: string, secret: string | null): string {
  if (!stored.startsWith(PREFIX)) return stored;
  if (!secret) throw new Error("LLM_KEY_DECRYPT_UNAVAILABLE");
  const payload = stored.slice(PREFIX.length);
  const [ivPart, cipherPart, tagPart] = payload.split(".");
  if (!ivPart || !cipherPart || !tagPart) throw new Error("LLM_KEY_DECRYPT_MALFORMED");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(secret),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Stores encrypted when a secret is configured; otherwise keeps plaintext (local dev). */
export function sealApiKey(plain: string): string {
  const secret = llmKeyEncryptionSecret();
  if (!secret) return plain;
  return encryptApiKey(plain, secret);
}

export function openApiKey(stored: string): string {
  return decryptApiKey(stored, llmKeyEncryptionSecret());
}

export function apiKeyHint(stored: string): string | null {
  const plain = openApiKey(stored);
  return plain.length > 0 ? `…${plain.slice(-4)}` : null;
}
