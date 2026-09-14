import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { schema } from "../schema";
import { AuditCaseRepository } from "./audit-case.repository";
import type { DrizzleDB } from "./types";

/**
 * The process's one Postgres connection pool, plus the drizzle handle built on
 * it. Both repositories take the `db` this returns so the app opens a single
 * pool instead of one per repository.
 */
export interface DbHandle {
  db: DrizzleDB;
  client: Sql;
}

export function createDb(databaseUrl: string): DbHandle {
  const client = postgres(databaseUrl);
  return { db: drizzle({ client, schema }), client };
}

/**
 * Accepts a ready `db` (the shared pool from `createDb`) or a connection string
 * for callers that only need this repository; a string opens a private pool.
 */
export function createRepository(input: string | DrizzleDB): AuditCaseRepository {
  const db = typeof input === "string" ? createDb(input).db : input;
  return new AuditCaseRepository(db);
}
