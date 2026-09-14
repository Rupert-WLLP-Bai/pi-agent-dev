import { expect, test } from "bun:test";
import {
  DEFAULT_FILLER_COUNT,
  demoScenarioCases,
  generateFillerCases,
} from "@contract-audit/audit/demo-scenarios";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { InMemoryAuditCaseRepository } from "../testing/fakes";
import { seedDemoWorld } from "./seed-world";

test("every authored scenario case still extracts a 乙方 the history rule can join", () => {
  for (const spec of demoScenarioCases) {
    const snapshot = createAuditSnapshot({
      sourceRecordId: spec.id,
      document: normalizeContractDocument(spec.text),
    });
    expect(
      snapshot.parties.some((party) => party.label === "乙方"),
      spec.id,
    ).toBe(true);
  }
});

test("filler generation is deterministic for a fixed seed", () => {
  const a = generateFillerCases(7, DEFAULT_FILLER_COUNT);
  const b = generateFillerCases(7, DEFAULT_FILLER_COUNT);
  expect(a.map((item) => item.text)).toEqual(b.map((item) => item.text));
});

test("seedDemoWorld plants the featured history pair in memory", async () => {
  const repository = new InMemoryAuditCaseRepository();
  const result = await seedDemoWorld(repository, { reset: false, fillerCount: 0, rngSeed: 1 });
  expect(result.planted).toBe(demoScenarioCases.length);
  const featured = result.scenarios.find((scenario) => scenario.id === "cross-case-missed-link");
  expect(featured?.cases).toHaveLength(2);
  const nextCase = featured?.cases.find((item) => item.caseKey === "history-new-clean-look");
  expect(nextCase).toBeDefined();
  if (!nextCase) return;
  const history = await repository.getPartyHistory(nextCase.caseId);
  expect(history?.assessment.disposition).toBe("POLICY_CONFLICT");
  expect(history?.hits.some((hit) => hit.title.includes("重型设备租赁"))).toBe(true);

  const clean = result.scenarios.find((scenario) => scenario.id === "clean-pass");
  expect(clean?.cases[0]?.stage).toBe("COMPLETED");

  const board = await repository.getRemediationBoard({ now: new Date("2026-09-14T00:00:00.000Z") });
  expect(board.columns.map((column) => [column.status, column.count])).toEqual([
    ["pending", 1],
    ["in_progress", 1],
    ["awaiting_review", 1],
    ["closed", 2],
  ]);
});

test("seedDemoWorld reset removes only previously planted demo cases", async () => {
  const repository = new InMemoryAuditCaseRepository();
  await seedDemoWorld(repository, { reset: false, fillerCount: 0, rngSeed: 1 });
  const first = await repository.listDemoSeededCases();
  const again = await seedDemoWorld(repository, { reset: true, fillerCount: 0, rngSeed: 1 });
  expect(again.removed).toBe(first.length);
  expect(again.planted).toBe(demoScenarioCases.length);
});
