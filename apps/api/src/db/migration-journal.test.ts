import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Guard: every SQL migration under drizzle/ must be journaled, and the journal
 * must not reference a missing file. Complements `drizzle-kit check`, which
 * verifies schema.ts against the snapshot chain.
 */
test("drizzle journal entries match migration SQL files", async () => {
  const drizzleDir = join(import.meta.dir, "../../drizzle");
  const journal = await Bun.file(join(drizzleDir, "meta/_journal.json")).json();
  const entries = journal.entries as Array<{ tag: string }>;
  const tags = new Set(entries.map((entry) => entry.tag));

  const files = (await readdir(drizzleDir)).filter((name) => name.endsWith(".sql"));
  expect(files.length).toBe(tags.size);
  for (const file of files) {
    const tag = file.replace(/\.sql$/, "");
    expect(tags.has(tag)).toBe(true);
  }
});
