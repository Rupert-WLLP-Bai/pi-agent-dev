import type { DemoResetOutcome } from "../db/repositories";
import { checkDemoResetEnvironment } from "./demo-environment";
import { type DemoWorldView, plantDemoCases } from "./seed-world";

/**
 * One atomic demo-world operation.
 *
 * A reset and a rebuild are the same dangerous thing seen from two sides, so
 * they share one path: the environment guard, the database identity and its
 * registration row, the active-run refusal, the exclusive advisory lock, the
 * delete and — for a rebuild — the seeding all run inside a single transaction
 * on a single connection. No second operation can observe a half-deleted or
 * half-seeded world, and no claim can hand out a case the reset is deleting.
 */

/** What a completed operation reports. */
export interface DemoWorldOperationResult {
  outcome: DemoResetOutcome;
  /** The world after a successful rebuild; null when refused or reset-only. */
  view: DemoWorldView | null;
  /** Cases planted in this operation; zero for a reset-only run. */
  planted: number;
}

export interface DemoWorldOperationInput {
  appEnv: string | undefined;
  confirmation: string | undefined;
  environmentId: string | undefined;
  databaseName: string | undefined;
  databaseUrl: string | undefined;
  /** When set, the world is rebuilt after the reset, in the same transaction. */
  seed?: { fillerCount?: number; rngSeed?: number };
}

/**
 * The repository surface the operation needs. The repository owns the
 * transaction because only it can read the identity, check active runs, delete
 * and seed without crossing a connection boundary in between.
 */
export interface DemoWorldOperationRepository {
  rebuildDemoWorld(input: {
    environmentId: string;
    databaseName: string;
    /** Null performs the guarded reset only. */
    seed: { fillerCount?: number; rngSeed?: number } | null;
  }): Promise<DemoWorldOperationResult>;
}

/**
 * Runs the guarded demo operation. Refusals return a code and reason; they are
 * never thrown, so a caller maps them directly to an HTTP status or an exit
 * code. The pure environment half runs before the repository is touched, so a
 * misconfigured deployment is refused without opening a connection.
 */
export async function runDemoWorldOperation(
  repository: DemoWorldOperationRepository,
  input: DemoWorldOperationInput,
): Promise<DemoWorldOperationResult> {
  const guard = checkDemoResetEnvironment(input);
  if (!guard.ok) {
    return {
      outcome: { ok: false, code: guard.refusal.code, reason: guard.refusal.reason },
      view: null,
      planted: 0,
    };
  }
  return repository.rebuildDemoWorld({
    environmentId: guard.environmentId,
    databaseName: guard.databaseName,
    seed: input.seed ?? null,
  });
}

/** The seeding half, called by the repository inside its transaction. */
export async function seedInOperation(
  repository: Parameters<typeof plantDemoCases>[0],
  seed: { fillerCount?: number; rngSeed?: number },
): Promise<Awaited<ReturnType<typeof plantDemoCases>>> {
  return plantDemoCases(repository, seed);
}
