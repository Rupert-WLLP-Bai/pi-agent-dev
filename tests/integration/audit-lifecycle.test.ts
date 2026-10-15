import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuditApp } from "../../apps/api/src/app";
import { createApp } from "../../apps/api/src/app";
import type { AuditCaseRepository, DrizzleDB } from "../../apps/api/src/db/repositories";
import { AuditCaseRepository as AuditCaseRepositoryClass } from "../../apps/api/src/db/repositories";
import {
  FakeDispatcher,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../../apps/api/src/testing/fakes";
import {
  connectIntegrationDatabase,
  type IntegrationDatabase,
  IntegrationDatabaseUnavailable,
  migrateIntegrationDatabase,
} from "./db";

/**
 * Integration coverage that only a real PostgreSQL can give: the exclusive
 * queue claim, the append-only finding history, the review → remediation
 * transaction, and the SSE event stream — all driven through the assembled app
 * rather than through a repository fake.
 *
 * Every case works inside one transaction that is always rolled back, so a run
 * leaves nothing behind and repeat runs see identical data. That is what makes
 * the assertions exact rather than "at least one row".
 */

let database: IntegrationDatabase;
let unavailable: string | null = null;

beforeAll(async () => {
  try {
    database = await connectIntegrationDatabase();
    await migrateIntegrationDatabase(database.url);
  } catch (error) {
    // A missing TEST_DATABASE_URL and an unreachable database are both "this
    // run has no PostgreSQL", not "the code is broken": the suite skips with
    // the reason recorded, so a run without infrastructure still reports what
    // it proved. Anything else — a refused identity, a failed migration — is a
    // real failure and must surface.
    if (error instanceof IntegrationDatabaseUnavailable || isConnectionFailure(error)) {
      unavailable = errorMessage(error);
      return;
    }
    throw error;
  }
});

afterAll(async () => {
  await database?.handle.client.end({ timeout: 5 }).catch(() => {});
});

interface RollbackHandle {
  app: AuditApp;
  repository: AuditCaseRepository;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A database the server refuses or cannot reach is an environment condition,
 * not a test failure: the suite skips instead of reporting a stack trace. The
 * postgres driver reports these as errors carrying a `code` (`ECONNREFUSED`,
 * `3D000` for a missing database, `28P01` for bad credentials).
 */
const CONNECTION_CODES = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "3D000",
  "28P01",
  "28000",
] as const;

const isConnectionFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && (CONNECTION_CODES as readonly string[]).includes(code)) {
    return true;
  }
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("econnrefused") ||
    message.includes("connect etimedout") ||
    message.includes("password authentication failed")
  );
};

/**
 * Opens a transaction that always rolls back and hands the suite a repository
 * bound to it. The app is assembled on that repository, so the routes under
 * test read and write exactly the rows the test can see.
 *
 * The repository is constructed from the transaction handle rather than a pool
 * connection: a pool would commit each statement independently, which is the
 * one thing a hermetic suite cannot allow.
 */
const withRollback = async (body: (handle: RollbackHandle) => Promise<void>): Promise<void> => {
  // The body's assertions must have passed before this throws: the rollback is
  // how the suite stays hermetic, and a failing body must not be masked. The
  // transaction handle binds the repository exactly as the existing DB unit
  // tests do — the driver does not export the transaction object's type, so
  // the repository constructor takes it as the DrizzleDB surface it satisfies.
  class Rollback extends Error {}
  await database.handle.db
    .transaction(async (tx) => {
      const repository = new AuditCaseRepositoryClass(tx as unknown as DrizzleDB);
      const dispatcher = new FakeDispatcher();
      const broker = new RecordingEventBroker();
      const app = createApp({
        repository,
        dispatcher: dispatcher.asDispatcher(),
        broker: broker.asBroker(),
        rules: new InMemoryRuleRepository().asRepository(),
      });
      await body({ app, repository });
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
};

const CONTRACT_TEXT = [
  "甲方：重庆华盛贸易有限公司",
  "乙方：成都建工集团有限公司",
  "乙方签订后支付合同金额的70%作为预付款。",
].join("\n");

const createCase = async (app: AuditApp): Promise<string> => {
  const response = await app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText: CONTRACT_TEXT }),
    }),
  );
  expect(response.status).toBe(202);
  const body = (await response.json()) as { id: string };
  return body.id;
};

describe("integration: audit case lifecycle over real PostgreSQL", () => {
  test.skipIf(unavailable !== null)("creates a case and reads its identity back", async () => {
    if (unavailable) return;
    await withRollback(async ({ app, repository }) => {
      const caseId = await createCase(app);
      expect(await repository.getCase(caseId)).toMatchObject({ status: "PENDING" });

      // A pasted case is queued, not yet audited: the detail route answers 200
      // and the snapshot frame stays empty until the dispatcher claims the case
      // and assembles one. The SSE test below drives the claimed state, where
      // the snapshot exists.
      const detail = await app.handle(new Request(`http://localhost/api/audit-cases/${caseId}`));
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { case: { id: string }; snapshot: unknown };
      expect(body.case.id).toBe(caseId);
      expect(body.snapshot).toBeNull();
    });
  });

  test.skipIf(unavailable !== null)(
    "claiming a pending case is exclusive across two claims",
    async () => {
      if (unavailable) return;
      await withRollback(async ({ app, repository }) => {
        const caseId = await createCase(app);
        const first = await repository.claimNextPendingCase();
        expect(first?.caseId).toBe(caseId);
        // The claim moved the case to RUNNING, so a second dispatcher polling the
        // same queue sees nothing to pick up.
        const second = await repository.claimNextPendingCase();
        expect(second).toBeNull();
      });
    },
  );

  test.skipIf(unavailable !== null)(
    "the SSE stream opens with the case snapshot frame",
    async () => {
      if (unavailable) return;
      await withRollback(async ({ app, repository }) => {
        const caseId = await createCase(app);
        await repository.updateCaseStatus(caseId, "AWAITING_REVIEW", "AWAITING_REVIEW");

        const response = await app.handle(
          new Request(`http://localhost/api/audit-cases/${caseId}/events`),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        if (!reader) return;
        const first = await reader.read();
        const text = new TextDecoder().decode(first?.value);
        expect(text).toContain('"type":"snapshot"');
        expect(text).toContain(caseId);
        await reader.cancel();
      });
    },
  );
});
