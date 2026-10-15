import type { DbHandle } from "../../apps/api/src/db/repositories";
import { createDb } from "../../apps/api/src/db/repositories";

/**
 * Integration-test database identity.
 *
 * These tests run against a real PostgreSQL, but never the developer's own
 * database: `TEST_DATABASE_URL` (falling back to `DATABASE_URL` only when the
 * run explicitly opts in with `INTEGRATION_ALLOW_DEFAULT_DB=1`) must name a
 * database whose identity is printed before any statement runs, and the helper
 * refuses to continue when that identity looks like production. Nothing here
 * resets, drops or truncates a database — each suite works inside a
 * transaction that always rolls back, the same discipline the existing DB unit
 * tests use.
 *
 * The connection is opened through the API package's own `createDb`, so the
 * driver and the drizzle handle come from one module graph. Opening a second
 * pool from the test project's resolution would mix two copies of the driver's
 * types and make the transaction object incompatible with the repository
 * constructor.
 */

const PROTECTED_NAMES = ["production", "prod"] as const;

export interface IntegrationDatabase {
  url: string;
  /** The database name the server reported, read back from the connection. */
  name: string;
  /** The pool and drizzle handle from the API package's `createDb`. */
  handle: DbHandle;
}

export class IntegrationDatabaseUnavailable extends Error {}

export class IntegrationDatabaseRefused extends Error {}

export function resolveIntegrationDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const fallback = process.env.DATABASE_URL?.trim();
  if (fallback && process.env.INTEGRATION_ALLOW_DEFAULT_DB === "1") return fallback;
  throw new IntegrationDatabaseUnavailable(
    "TEST_DATABASE_URL is not set. Point it at a disposable test database " +
      "(for example postgresql://contract_audit:contract_audit@localhost:5432/contract_audit_test). " +
      "Set INTEGRATION_ALLOW_DEFAULT_DB=1 to reuse DATABASE_URL instead.",
  );
}

const databaseNameOf = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "unknown";
  } catch {
    return "unknown";
  }
};

/**
 * Connects and verifies the identity before returning. A name that matches a
 * protected value aborts the run even when the environment asked for it.
 */
export async function connectIntegrationDatabase(): Promise<IntegrationDatabase> {
  const url = resolveIntegrationDatabaseUrl();
  const name = databaseNameOf(url);
  if ((PROTECTED_NAMES as readonly string[]).includes(name.toLowerCase())) {
    throw new IntegrationDatabaseRefused(
      `refusing to run integration tests against database "${name}"`,
    );
  }
  const handle = createDb(url);
  try {
    const rows = await handle.client`SELECT current_database() AS name`;
    const reported = String(rows[0]?.name ?? "");
    if (reported && reported !== name) {
      throw new IntegrationDatabaseRefused(
        `database identity mismatch: expected "${name}", server reports "${reported}"`,
      );
    }
    return { url, name: reported || name, handle };
  } catch (error) {
    await handle.client.end({ timeout: 5 }).catch(() => {});
    throw error;
  }
}

/** Applies the committed Drizzle migrations to the test database. */
export async function migrateIntegrationDatabase(url: string): Promise<void> {
  const proc = Bun.spawnSync(["bun", "run", "migrate"], {
    cwd: new URL("../../apps/api", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`drizzle migrate failed with exit code ${proc.exitCode}`);
  }
}
