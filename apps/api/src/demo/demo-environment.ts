import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/repositories";

/**
 * The demo reset's environmental guard.
 *
 * A reset deletes rows. The only thing that makes that safe is proof, before
 * any DELETE runs, that this process is pointed at a database that was
 * *registered for demonstration*. Every refusal below names its reason, and
 * none of them can be satisfied by accident: the checks are ordered so the
 * cheapest disqualifications (environment, missing confirmation) happen before
 * a connection is even opened.
 */

/** Which environments a reset is allowed to run in. */
export type DemoResetEnvironment = "demo" | "test";

/** A refused reset: a stable code plus the human reason. */
export interface DemoResetRefusal {
  code:
    | "app_env_not_demo"
    | "confirmation_required"
    | "database_url_missing"
    | "environment_id_missing"
    | "database_name_missing"
    | "database_identity_mismatch"
    | "registration_mismatch";
  /** The full reason, in the operator's language. Safe to print: no credentials. */
  reason: string;
}

export type DemoResetGuard =
  | { ok: true; environment: DemoResetEnvironment; environmentId: string; databaseName: string }
  | { ok: false; refusal: DemoResetRefusal };

/**
 * Reads `APP_ENV` and maps it to the reset-permitted environments. Unknown
 * values are refused rather than guessed: a deployment that forgot to set
 * APP_ENV must not inherit a demo identity from a default.
 */
export const demoResetEnvironmentOf = (appEnv: string | undefined): DemoResetEnvironment | null => {
  const normalized = appEnv?.trim().toLowerCase();
  if (normalized === "demo" || normalized === "test") return normalized;
  return null;
};

/**
 * The pure half of the guard: environment and confirmation. A caller that
 * fails here never reaches the database, which is what keeps `CI=true` and a
 * half-configured environment from being mistaken for authorization.
 */
export function checkDemoResetEnvironment(input: {
  appEnv: string | undefined;
  /** The confirmation the operator supplied; must match the target exactly. */
  confirmation: string | undefined;
  environmentId: string | undefined;
  databaseName: string | undefined;
  databaseUrl: string | undefined;
}): DemoResetGuard {
  const environment = demoResetEnvironmentOf(input.appEnv);
  if (environment === null) {
    return {
      ok: false,
      refusal: {
        code: "app_env_not_demo",
        reason:
          `APP_ENV 必须为 demo 或 test 才允许重置演示数据（当前：${input.appEnv?.trim() || "未设置"}）。` +
          "未知或生产环境一律拒绝，不能靠默认值获得演示身份。",
      },
    };
  }
  const expected = input.databaseName?.trim() ?? "";
  if (expected === "" || input.confirmation?.trim() !== expected) {
    return {
      ok: false,
      refusal: {
        code: "confirmation_required",
        reason:
          "重置需要显式确认：请传入目标数据库名作为确认值。" +
          "CI 环境变量或任何隐式授权都不能代替这一步。",
      },
    };
  }
  if (input.databaseUrl === undefined || input.databaseUrl.trim() === "") {
    return {
      ok: false,
      refusal: {
        code: "database_url_missing",
        reason: "DATABASE_URL 未设置，无法确认目标数据库身份。",
      },
    };
  }
  const environmentId = input.environmentId?.trim() ?? "";
  if (environmentId === "") {
    return {
      ok: false,
      refusal: {
        code: "environment_id_missing",
        reason: "DEMO_ENVIRONMENT_ID 未设置；演示环境必须先注册再重置。",
      },
    };
  }
  return { ok: true, environment, environmentId, databaseName: expected };
}

/** What the connected server says about this database's identity. */
export interface DemoEnvironmentIdentity {
  /** The server's own `current_database()`. */
  currentDatabase: string;
  /** The `demo_environments` row's stored name, or null when unregistered. */
  registeredDatabase: string | null;
}

/**
 * Reads both halves of the identity in one round trip: which database this
 * connection is actually attached to, and what that environment registered as.
 */
export async function readDemoEnvironmentIdentity(
  db: DrizzleDB,
  environmentId: string,
): Promise<DemoEnvironmentIdentity> {
  const rows = await db.execute<{ current_database: string; database_name: string | null }>(sql`
    SELECT current_database() AS current_database,
           (SELECT database_name FROM demo_environments WHERE id = ${environmentId}) AS database_name
  `);
  const row = rows[0];
  return {
    currentDatabase: row?.current_database ?? "",
    registeredDatabase: row?.database_name ?? null,
  };
}

/**
 * The database half of the guard: the connected database and its registration
 * row must both be the environment the operator asked to reset.
 */
export function checkDemoResetIdentity(input: {
  environmentId: string;
  databaseName: string;
  identity: DemoEnvironmentIdentity;
}): DemoResetGuard {
  if (input.identity.currentDatabase !== input.databaseName) {
    return {
      ok: false,
      refusal: {
        code: "database_identity_mismatch",
        reason:
          `目标库不匹配：当前连接的是 ${input.identity.currentDatabase}，` +
          `而 DEMO_DATABASE_NAME 指向 ${input.databaseName}。拒绝重置。`,
      },
    };
  }
  if (input.identity.registeredDatabase !== input.databaseName) {
    return {
      ok: false,
      refusal: {
        code: "registration_mismatch",
        reason:
          input.identity.registeredDatabase === null
            ? `环境 ${input.environmentId} 未注册（demo_environments 无该行）；生产库不会自动获得演示身份。`
            : `环境 ${input.environmentId} 注册的库是 ${input.identity.registeredDatabase}，` +
              `与 DEMO_DATABASE_NAME（${input.databaseName}）不符。拒绝重置。`,
      },
    };
  }
  return {
    ok: true,
    environment: "demo",
    environmentId: input.environmentId,
    databaseName: input.databaseName,
  };
}

/**
 * Registers this database as a demo environment, or refuses.
 *
 * Registration is the only way a database acquires a demo identity: the
 * migration never inserts a row, and a production deployment never calls this.
 * It runs only after the environment check passes and the connected database
 * is proven to be the one the operator named.
 */
export async function registerDemoEnvironment(
  db: DrizzleDB,
  input: { environmentId: string; databaseName: string; appEnv: string | undefined },
): Promise<DemoResetGuard> {
  const guard = checkDemoResetEnvironment({
    appEnv: input.appEnv,
    // Registration destroys nothing, so it does not ask for a typed
    // confirmation of the database name; the identity checks below are what
    // it must pass instead.
    confirmation: input.databaseName,
    environmentId: input.environmentId,
    databaseName: input.databaseName,
    databaseUrl: "registration",
  });
  if (!guard.ok) return guard;
  const identity = await readDemoEnvironmentIdentity(db, input.environmentId);
  if (identity.currentDatabase !== input.databaseName) {
    return {
      ok: false,
      refusal: {
        code: "database_identity_mismatch",
        reason:
          `拒绝注册：当前连接的库是 ${identity.currentDatabase}，` +
          `而 DEMO_DATABASE_NAME 指向 ${input.databaseName}。`,
      },
    };
  }
  await db.execute(sql`
    INSERT INTO demo_environments (id, database_name)
    VALUES (${input.environmentId}, ${input.databaseName})
    ON CONFLICT (id) DO UPDATE SET database_name = EXCLUDED.database_name
  `);
  return {
    ok: true,
    environment: "demo",
    environmentId: input.environmentId,
    databaseName: input.databaseName,
  };
}
