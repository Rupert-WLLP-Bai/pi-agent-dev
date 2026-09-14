import { expect, test } from "bun:test";
import { decryptApiKey, encryptApiKey, sealApiKey } from "./api-key-crypto";

test("encryptApiKey round-trips with a secret", () => {
  const secret = "test-secret-for-llm-keys";
  const plain = "sk-live-abcdef1234";
  const sealed = encryptApiKey(plain, secret);
  expect(sealed.startsWith("enc:v1:")).toBe(true);
  expect(decryptApiKey(sealed, secret)).toBe(plain);
});

test("sealApiKey leaves plaintext when no secret is configured", () => {
  const previous = process.env.LLM_KEY_ENCRYPTION_SECRET;
  delete process.env.LLM_KEY_ENCRYPTION_SECRET;
  try {
    expect(sealApiKey("plain-key")).toBe("plain-key");
  } finally {
    if (previous === undefined) delete process.env.LLM_KEY_ENCRYPTION_SECRET;
    else process.env.LLM_KEY_ENCRYPTION_SECRET = previous;
  }
});
