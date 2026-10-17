import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { operatorFrom } from "./operator-header";
import { createRequestContext, type RequestAccessEvent } from "./request-context";

describe("request context", () => {
  test("rejects a foreign-origin write before the handler can change state", async () => {
    let changed = false;
    const app = new Elysia()
      .use(createRequestContext({ onAccess: () => {} }))
      .post("/api/change", () => {
        changed = true;
        return { changed };
      });
    const response = await app.handle(
      new Request("http://localhost/api/change", {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(changed).toBe(false);
  });

  test("access observations omit query values, credentials and returned contract content", async () => {
    const secret = "private-test-credential";
    const observed = Promise.withResolvers<RequestAccessEvent>();
    const app = new Elysia()
      .use(createRequestContext({ onAccess: (event) => observed.resolve(event) }))
      .get("/api/contracts/:id/original", () => new Response("private contract bytes"));
    const response = await app.handle(
      new Request(`http://localhost/api/contracts/private/original?secret=${secret}`, {
        headers: { authorization: `Bearer ${secret}`, cookie: `private=${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const event = await observed.promise;
    expect(event).toMatchObject({
      method: "GET",
      route: "/api/contracts/:id/original",
      status: 200,
    });
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain("private contract bytes");
    expect(JSON.stringify(event)).not.toContain("/private/");
  });

  test("operator attribution trims decoded names and rejects control or oversized values", () => {
    expect(operatorFrom({ "x-operator": encodeURIComponent("  法务张三  ") })).toBe("法务张三");
    for (const value of ["%broken", "%0Aadministrator", "x".repeat(129), "%20%20"]) {
      expect(operatorFrom({ "x-operator": value })).toBeUndefined();
    }
  });
});
