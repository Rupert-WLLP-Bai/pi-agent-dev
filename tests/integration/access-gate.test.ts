import { describe, expect, test } from "bun:test";
import type { AuditApp } from "../../apps/api/src/app";
import { createApp } from "../../apps/api/src/app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../../apps/api/src/testing/fakes";

/**
 * Black-box access-gate coverage over real HTTP semantics (SEC3).
 *
 * These tests drive `app.handle` exactly as a browser would: they read the
 * session endpoint, log in, carry the cookie the server sets, and then touch
 * protected resources. Nothing is asserted about how the gate is implemented —
 * only about what an anonymous caller, an authenticated caller and a logged-out
 * caller can reach. That is what keeps the suite honest when the gate is
 * reworked.
 *
 * The gate is composed through the public `createApp` API with
 * `AppDeps.access`; there is no feature detection and no skip here, because a
 * build whose app does not honour the dependency would be a real regression and
 * must fail loudly rather than report itself as not applicable.
 */

const TOKEN = "qa-integration-access-token-0123456789abcdef";

const setup = () => {
  const repository = new InMemoryAuditCaseRepository();
  const dispatcher = new FakeDispatcher();
  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
    access: { token: TOKEN },
  });
  return { repository, dispatcher, app };
};

const CONTRACT_TEXT = "甲方应于签订后支付合同金额的70%作为预付款。";

const createCase = async (app: AuditApp): Promise<string> => {
  const response = await app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText: CONTRACT_TEXT }),
    }),
  );
  return ((await response.json()) as { id: string }).id;
};

/** Logs in and returns the raw Set-Cookie value the server answered with. */
const login = async (app: AuditApp): Promise<string> => {
  const response = await app.handle(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie") ?? "";
};

describe("integration: workspace access gate", () => {
  test("the session endpoint reports the gate without requiring a token", async () => {
    const { app } = setup();
    const response = await app.handle(new Request("http://localhost/api/session"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      authenticationRequired: boolean;
      authenticated: boolean;
    };
    expect(body).toEqual({ authenticationRequired: true, authenticated: false });
  });

  test("a wrong token is refused and grants nothing", async () => {
    const { app } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-the-token" }),
      }),
    );
    expect(response.status).toBe(401);
    // No session cookie is issued with a refusal.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("protected resources are refused anonymously, including SSE and originals", async () => {
    const { app, repository } = setup();
    const caseId = await createCase(app);
    const sourceRecordId = repository.sourceRecordIdsByCase.get(caseId) as string;

    for (const path of [
      "/api/audit-cases",
      `/api/audit-cases/${caseId}`,
      `/api/audit-cases/${caseId}/trace`,
      `/api/audit-cases/${caseId}/events`,
      `/api/source-records/${sourceRecordId}/original`,
      "/api/rules",
      "/api/remediations",
    ]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status, `${path} must require authentication`).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("authentication_required");
    }
  });

  test("health stays reachable without a session", async () => {
    const { app } = setup();
    const response = await app.handle(new Request("http://localhost/api/health"));
    // 200 or 503 — the point is that the gate did not answer 401.
    expect(response.status === 200 || response.status === 503).toBe(true);
  });

  test("a session cookie unlocks the protected reads it was issued for", async () => {
    const { app, repository } = setup();
    const caseId = await createCase(app);
    const sourceRecordId = repository.sourceRecordIdsByCase.get(caseId) as string;
    const cookie = await login(app);
    const session = cookie.split(";")[0];
    const headers = { cookie: session };

    const detail = await app.handle(
      new Request(`http://localhost/api/audit-cases/${caseId}`, { headers }),
    );
    expect(detail.status).toBe(200);
    // The SSE stream opens and its first frame is the case snapshot.
    const events = await app.handle(
      new Request(`http://localhost/api/audit-cases/${caseId}/events`, { headers }),
    );
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    // A pasted submission has no original, so the download answers 404 rather
    // than 401: the caller is authenticated and the resource genuinely is absent.
    const original = await app.handle(
      new Request(`http://localhost/api/source-records/${sourceRecordId}/original`, { headers }),
    );
    expect(original.status).toBe(404);
  });

  test("the Bearer token is accepted as an alternative to the cookie", async () => {
    const { app } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/audit-cases", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(response.status).toBe(200);
  });

  test("logout revokes the session and the cookie stops working", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const session = cookie.split(";")[0];
    const headers = { cookie: session };

    const before = await app.handle(new Request("http://localhost/api/audit-cases", { headers }));
    expect(before.status).toBe(200);

    const logout = await app.handle(
      new Request("http://localhost/api/session", { method: "DELETE", headers }),
    );
    expect(logout.status).toBe(204);

    const after = await app.handle(new Request("http://localhost/api/audit-cases", { headers }));
    expect(after.status).toBe(401);
  });

  test("a forged cookie value is rejected, not trusted", async () => {
    const { app } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/audit-cases", {
        headers: { cookie: `audit_session=${"0".repeat(64)}` },
      }),
    );
    expect(response.status).toBe(401);
  });
});
