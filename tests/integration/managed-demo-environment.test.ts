import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadManagedDemoEnvironment,
  redactDemoOutput,
} from "../../scripts/demo/managed-environment";

test("generated demo credentials stay private and stable across repeated launches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "managed-demo-environment-"));
  const previous = process.env.DEMO_ENV_FILE;
  process.env.DEMO_ENV_FILE = join(dir, ".demo.env");
  try {
    const first = await loadManagedDemoEnvironment(true);
    const second = await loadManagedDemoEnvironment();
    expect((await stat(first.path)).mode & 0o777).toBe(0o600);
    expect(first.values.S3_SECRET_KEY).toBe(second.values.S3_SECRET_KEY);
    expect(first.values.POSTGRES_PASSWORD === second.values.POSTGRES_PASSWORD).toBe(true);
    expect((first.values.LLM_KEY_ENCRYPTION_SECRET?.length ?? 0) >= 32).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.DEMO_ENV_FILE;
    else process.env.DEMO_ENV_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("demo command logs exclude S3 credentials provider tokens and database passwords", () => {
  const values = {
    POSTGRES_PASSWORD: "SYNTHETIC_DATABASE_PASSWORD_6258",
    S3_SECRET_KEY: "SYNTHETIC_S3_SECRET_7246",
    QCC_TOKEN: "SYNTHETIC_PROVIDER_TOKEN_8362",
    LLM_KEY_ENCRYPTION_SECRET: "SYNTHETIC_ENCRYPTION_SECRET_1937",
  };
  const log = redactDemoOutput(
    "source=synthetic-id postgres://user:SYNTHETIC_DATABASE_PASSWORD_6258@localhost/demo " +
      "SYNTHETIC_S3_SECRET_7246 SYNTHETIC_PROVIDER_TOKEN_8362 SYNTHETIC_ENCRYPTION_SECRET_1937",
    values,
  );
  expect(log).not.toContain(values.POSTGRES_PASSWORD);
  expect(log).not.toContain(values.S3_SECRET_KEY);
  expect(log).not.toContain(values.QCC_TOKEN);
  expect(log).not.toContain(values.LLM_KEY_ENCRYPTION_SECRET);
  expect(log).toContain("source=synthetic-id");
});
