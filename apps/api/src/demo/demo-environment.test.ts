import { describe, expect, test } from "bun:test";
import {
  checkDemoResetEnvironment,
  checkDemoResetIdentity,
  demoResetEnvironmentOf,
} from "./demo-environment";

/**
 * The guard is the only thing standing between a typo and a deleted database,
 * so its refusals are tested as strictly as its approvals. These are pure
 * functions on purpose: the environment a deployment declares and the identity
 * the server reports are the inputs, and no test needs a live database.
 */

describe("demoResetEnvironmentOf", () => {
  test("only demo and test are reset-permitted", () => {
    expect(demoResetEnvironmentOf("demo")).toBe("demo");
    expect(demoResetEnvironmentOf("test")).toBe("test");
    expect(demoResetEnvironmentOf("DEMO")).toBe("demo");
    expect(demoResetEnvironmentOf(" production ")).toBeNull();
    expect(demoResetEnvironmentOf("development")).toBeNull();
    expect(demoResetEnvironmentOf(undefined)).toBeNull();
  });
});

const base = {
  appEnv: "demo" as const,
  confirmation: "contract_audit_demo",
  environmentId: "demo-local",
  databaseName: "contract_audit_demo",
  databaseUrl: "postgresql://contract_audit@localhost:5432/contract_audit_demo",
};

describe("checkDemoResetEnvironment", () => {
  test("a demo environment with matching confirmation passes", () => {
    const guard = checkDemoResetEnvironment(base);
    expect(guard.ok).toBe(true);
  });

  test("test also passes, because the acceptance suite resets a scratch database", () => {
    expect(checkDemoResetEnvironment({ ...base, appEnv: "test" }).ok).toBe(true);
  });

  test("production is refused even with every other value correct", () => {
    const guard = checkDemoResetEnvironment({ ...base, appEnv: "production" });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("app_env_not_demo");
    expect(guard.refusal.reason).toContain("APP_ENV");
  });

  test("an unset APP_ENV is refused rather than defaulted into a demo identity", () => {
    const guard = checkDemoResetEnvironment({ ...base, appEnv: undefined });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("app_env_not_demo");
  });

  test("a missing confirmation is refused", () => {
    const guard = checkDemoResetEnvironment({ ...base, confirmation: undefined });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("confirmation_required");
  });

  test("CI=true is not a confirmation: only the exact database name is", () => {
    const guard = checkDemoResetEnvironment({ ...base, confirmation: "true" });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("confirmation_required");
  });

  test("a confirmation with surrounding whitespace still matches the trimmed name", () => {
    expect(checkDemoResetEnvironment({ ...base, confirmation: "  contract_audit_demo  " }).ok).toBe(
      true,
    );
  });

  test("a missing environment id is refused: registration precedes reset", () => {
    const guard = checkDemoResetEnvironment({ ...base, environmentId: undefined });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("environment_id_missing");
  });

  test("a missing database url is refused before any connection is attempted", () => {
    const guard = checkDemoResetEnvironment({ ...base, databaseUrl: undefined });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("database_url_missing");
  });
});

describe("checkDemoResetIdentity", () => {
  const input = {
    environmentId: "demo-local",
    databaseName: "contract_audit_demo",
    identity: { currentDatabase: "contract_audit_demo", registeredDatabase: "contract_audit_demo" },
  };

  test("a matching connection and registration passes", () => {
    expect(checkDemoResetIdentity(input).ok).toBe(true);
  });

  test("a connection to the production database is refused", () => {
    const guard = checkDemoResetIdentity({
      ...input,
      identity: { currentDatabase: "contract_audit", registeredDatabase: "contract_audit" },
    });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("database_identity_mismatch");
    // The refusal names both databases so the operator can see the mismatch.
    expect(guard.refusal.reason).toContain("contract_audit");
  });

  test("an unregistered database is refused: migrations never grant demo identity", () => {
    const guard = checkDemoResetIdentity({
      ...input,
      identity: { currentDatabase: "contract_audit_demo", registeredDatabase: null },
    });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("registration_mismatch");
  });

  test("a registration pointing at a different database is refused", () => {
    const guard = checkDemoResetIdentity({
      ...input,
      identity: { currentDatabase: "contract_audit_demo", registeredDatabase: "contract_audit_prod" },
    });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.refusal.code).toBe("registration_mismatch");
    expect(guard.refusal.reason).toContain("contract_audit_prod");
  });
});
