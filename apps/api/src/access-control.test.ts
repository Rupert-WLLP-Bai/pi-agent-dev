import { describe, expect, test, vi } from "bun:test";
import { Elysia } from "elysia";
import { type AccessEvent, createAccessControl } from "./access-control";
import { operatorFrom } from "./operator-header";
import { AuditEventBroker, sseResponse } from "./sse";

const TOKEN = "workspace-access-test-secret-32-characters";

function protectedApp(
  options: { now?: () => number; onAccess?: (event: AccessEvent) => void } = {},
) {
  return new Elysia()
    .use(createAccessControl({ token: TOKEN, secureCookies: true, onAccess: () => {}, ...options }))
    .get("/api/health", () => ({ status: "ok" }))
    .get("/api/contracts/:id/original", () => new Response("private contract bytes"))
    .get("/api/decisions/:id", () => ({ answer: "private observation" }));
}

describe("workspace access control", () => {
  test("protects downstream resources while health and session discovery stay public", async () => {
    const app = protectedApp();
    for (const path of [
      "/api/contracts/private/original",
      "/api/decisions/private",
      `/api/decisions/private?token=${TOKEN}`,
    ]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "authentication_required" });
    }
    expect((await app.handle(new Request("http://localhost/api/health"))).status).toBe(200);
    const session = await app.handle(new Request("http://localhost/api/session"));
    expect(await session.json()).toEqual({ authenticationRequired: true, authenticated: false });
  });

  test("accepts the configured bearer and rejects a different token without exposing credentials", async () => {
    const app = protectedApp();
    const denied = await app.handle(
      new Request("http://localhost/api/decisions/private", {
        headers: { authorization: "Bearer incorrect-secret" },
      }),
    );
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain("incorrect-secret");
    const allowed = await app.handle(
      new Request("http://localhost/api/contracts/private/original", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("private contract bytes");
  });

  test("login issues a protected cookie and logout revokes a captured cookie", async () => {
    const app = protectedApp();
    const denied = await app.handle(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "incorrect" }),
      }),
    );
    expect(denied.status).toBe(401);
    const login = await app.handle(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      }),
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain(TOKEN);
    const cookie = setCookie.split(";")[0];
    const authorized = await app.handle(
      new Request("http://localhost/api/session", { headers: { cookie } }),
    );
    expect(await authorized.json()).toEqual({ authenticationRequired: true, authenticated: true });
    const original = await app.handle(
      new Request("http://localhost/api/contracts/private/original", { headers: { cookie } }),
    );
    expect(original.status).toBe(200);
    const logout = await app.handle(
      new Request("http://localhost/api/session", { method: "DELETE", headers: { cookie } }),
    );
    expect(logout.status).toBe(204);
    const replay = await app.handle(
      new Request("http://localhost/api/contracts/private/original", { headers: { cookie } }),
    );
    expect(replay.status).toBe(401);
  });

  test("expired and forged sessions cannot authorize a read", async () => {
    let now = Date.parse("2026-10-15T00:00:00Z");
    const app = protectedApp({ now: () => now });
    const login = await app.handle(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      }),
    );
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    now += 365 * 24 * 60 * 60 * 1000;
    for (const supplied of [cookie, `audit_session=${"a".repeat(64)}`]) {
      const response = await app.handle(
        new Request("http://localhost/api/decisions/private", { headers: { cookie: supplied } }),
      );
      expect(response.status).toBe(401);
    }
  });

  test("logout closes an existing session stream before later private events", async () => {
    const broker = new AuditEventBroker();
    const app = protectedApp().get("/api/events", ({ request }) =>
      sseResponse(broker, "private-case", async () => null, request.signal),
    );
    const login = await app.handle(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      }),
    );
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const response = await app.handle(
      new Request("http://localhost/api/events", { headers: { cookie } }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    await app.handle(
      new Request("http://localhost/api/session", { method: "DELETE", headers: { cookie } }),
    );
    broker.publish({ type: "agent.started", auditCaseId: "private-case" });
    const next = await reader.read().then(
      (value) => (value.done ? "closed" : "private-event"),
      () => "closed",
    );
    await reader.cancel().catch(() => {});
    expect(next).toBe("closed");
  });

  test("a session stream expires without another client request", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const broker = new AuditEventBroker();
      const app = protectedApp({ now: () => now }).get("/api/events", ({ request }) =>
        sseResponse(broker, "private-case", async () => null, request.signal),
      );
      const login = await app.handle(
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN }),
        }),
      );
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      now = 8 * 60 * 60 * 1000 - 10;
      const response = await app.handle(
        new Request("http://localhost/api/events", { headers: { cookie } }),
      );
      const reader = response.body!.getReader();
      await reader.read();
      vi.advanceTimersByTime(10);
      broker.publish({ type: "agent.started", auditCaseId: "private-case" });
      const next = await reader.read().then(
        (value) => (value.done ? "closed" : "private-event"),
        () => "closed",
      );
      await reader.cancel().catch(() => {});
      expect(next).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects a foreign-origin write before the handler can change state", async () => {
    let changed = false;
    const app = protectedApp().post("/api/change", () => {
      changed = true;
      return { changed };
    });
    const response = await app.handle(
      new Request("http://localhost/api/change", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, origin: "https://untrusted.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(changed).toBe(false);
  });

  test("access observations omit query values, credentials and returned contract content", async () => {
    const observed = Promise.withResolvers<AccessEvent>();
    const app = protectedApp({ onAccess: (event) => observed.resolve(event) });
    const response = await app.handle(
      new Request(`http://localhost/api/contracts/private/original?secret=${TOKEN}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const event = await observed.promise;
    expect(event).toMatchObject({
      method: "GET",
      route: "/api/contracts/:id/original",
      status: 200,
      authenticated: true,
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(JSON.stringify(event)).not.toContain("private contract bytes");
  });

  test("operator attribution trims decoded names and rejects control or oversized values", () => {
    expect(operatorFrom({ "x-operator": encodeURIComponent("  法务张三  ") })).toBe("法务张三");
    for (const value of ["%broken", "%0Aadministrator", "x".repeat(129), "%20%20"]) {
      expect(operatorFrom({ "x-operator": value })).toBeUndefined();
    }
  });
});
