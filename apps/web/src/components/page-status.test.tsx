import { describe, expect, test } from "bun:test";

describe("page status exports", () => {
  test("module loads shared page helpers", async () => {
    const mod = await import("./page-status");
    expect(typeof mod.PageHead).toBe("function");
    expect(typeof mod.PageQueryBody).toBe("function");
    expect(typeof mod.PageError).toBe("function");
  });
});
