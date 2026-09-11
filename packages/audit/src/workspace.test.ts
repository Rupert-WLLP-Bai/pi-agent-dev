import { expect, test } from "bun:test";
import { workspaceName } from "./workspace";

test("exports the audit workspace identity", () => {
  expect(workspaceName).toBe("@contract-audit/audit");
});
