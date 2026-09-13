import { expect, test } from "bun:test";
import { InMemoryRuleRepository } from "../testing/fakes";
import { SEED_RULE_DEFINITIONS, seedRules } from "./seed-rules";

test("seedRules inserts every catalogue rule as a published v1", async () => {
  const repository = new InMemoryRuleRepository();
  const created = await seedRules(repository.asRepository());
  expect(created).toBe(SEED_RULE_DEFINITIONS.length);

  const listed = await repository.listRules();
  expect(listed.map((rule) => rule.code).sort()).toEqual(
    SEED_RULE_DEFINITIONS.map((rule) => rule.code).sort(),
  );
  expect(listed.every((rule) => rule.status === "published")).toBe(true);
});

test("seedRules is idempotent: a second start inserts nothing", async () => {
  const repository = new InMemoryRuleRepository();
  await seedRules(repository.asRepository());
  expect(await seedRules(repository.asRepository())).toBe(0);
  expect((await repository.listRules()).length).toBe(SEED_RULE_DEFINITIONS.length);
});
