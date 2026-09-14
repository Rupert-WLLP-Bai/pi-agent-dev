import { expect, test } from "bun:test";
import { AuditCaseRepository, createDb, createRepository, type DrizzleDB } from "./repositories";
import { createRuleRepository, RuleRepository } from "./rule-repository";

/**
 * Reads the pool a repository holds. AuditCaseRepository is a facade: the
 * shared `db` lives on its queue aggregate. RuleRepository still owns `db`
 * directly.
 */
const poolOf = (repository: AuditCaseRepository | RuleRepository): unknown => {
  if (repository instanceof RuleRepository) {
    return (repository as unknown as { db: unknown }).db;
  }
  return (repository as unknown as { queue: { db: unknown } }).queue.db;
};

/** A stand-in whose identity survives into whichever factory receives it. */
const markerDb = { tag: "shared" } as unknown as DrizzleDB;

test("createRepository uses the db it is handed", () => {
  const repository = createRepository(markerDb);
  expect(repository).toBeInstanceOf(AuditCaseRepository);
  expect(poolOf(repository)).toBe(markerDb);
});

test("createRuleRepository uses the db it is handed", () => {
  const repository = createRuleRepository(markerDb);
  expect(repository).toBeInstanceOf(RuleRepository);
  expect(poolOf(repository)).toBe(markerDb);
});

test("createDb hands both repositories the same pool", async () => {
  const { db, client } = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
  try {
    expect(poolOf(createRepository(db))).toBe(db);
    expect(poolOf(createRuleRepository(db))).toBe(db);
  } finally {
    await client.end();
  }
});
