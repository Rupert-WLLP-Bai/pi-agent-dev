import { expect, test } from "bun:test";
import {
  DEFAULT_FILLER_COUNT,
  demoScenarioCases,
  generateFillerCases,
} from "@contract-audit/audit/demo-scenarios";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import type { DemoResetOutcome } from "../db/repositories";
import { InMemoryAuditCaseRepository } from "../testing/fakes";
import { plantDemoCases } from "./seed-world";
import { runDemoWorldOperation } from "./demo-world-operation";

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

test("plantDemoCases fills the featured history pair in memory", async () => {
  const repository = new InMemoryAuditCaseRepository();
  const result = await plantDemoCases(repository, { fillerCount: 0, rngSeed: 1 });
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

/**
 * The in-memory repository records demo rows but has no database identity, so
 * the test supplies the guarded operation directly: the same contract the real
 * repository implements (identity, activity, delete and seed in one
 * transaction), minus the SQL. The environment guard still applies, which is
 * what the refusal below asserts.
 */
const guardedInMemoryRepository = (
  base: InMemoryAuditCaseRepository,
  options: { databaseName?: string } = {},
) => {
  const repository = base as unknown as InMemoryAuditCaseRepository & {
    rebuildDemoWorld(input: {
      environmentId: string;
      databaseName: string;
      seed: { fillerCount?: number; rngSeed?: number } | null;
    }): Promise<{ outcome: DemoResetOutcome; view: null; planted: number }>;
  };
  repository.rebuildDemoWorld = async (input) => {
    if (input.databaseName !== (options.databaseName ?? "contract_audit_demo")) {
      return {
        outcome: { ok: false, code: "database_identity_mismatch", reason: "目标库不匹配" },
        view: null,
        planted: 0,
      };
    }
    const removed = (await base.listDemoSeededCases()).length;
    await base.deleteDemoSeededCases();
    return { outcome: { ok: true, removed }, view: null, planted: 0 };
  };
  return repository;
};

const GUARD_INPUT = {
  appEnv: "demo",
  confirmation: "contract_audit_demo",
  environmentId: "demo-local",
  databaseName: "contract_audit_demo",
  databaseUrl: "postgresql://localhost/contract_audit_demo",
} as const;

test("a refused operation deletes nothing and plants nothing", async () => {
  const base = new InMemoryAuditCaseRepository();
  const repository = guardedInMemoryRepository(base, { databaseName: "other_database" });
  await plantDemoCases(repository, { fillerCount: 0, rngSeed: 1 });
  const before = await repository.listDemoSeededCases();
  const result = await runDemoWorldOperation(repository, {
    ...GUARD_INPUT,
    seed: { fillerCount: 0, rngSeed: 1 },
  });
  expect(result.outcome.ok).toBe(false);
  if (result.outcome.ok) return;
  expect(result.outcome.code).toBe("database_identity_mismatch");
  expect(result.view).toBeNull();
  expect(result.planted).toBe(0);
  // Nothing was deleted either: a refusal leaves the world exactly as it was.
  expect(await repository.listDemoSeededCases()).toEqual(before);
});

test("the environment guard runs before any database work", async () => {
  const base = new InMemoryAuditCaseRepository();
  const repository = guardedInMemoryRepository(base);
  const result = await runDemoWorldOperation(repository, {
    ...GUARD_INPUT,
    appEnv: "production",
  });
  expect(result.outcome.ok).toBe(false);
  if (result.outcome.ok) return;
  expect(result.outcome.code).toBe("app_env_not_demo");
});
