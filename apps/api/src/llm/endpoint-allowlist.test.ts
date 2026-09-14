import { expect, test } from "bun:test";
import { assertAllowedLlmEndpoint } from "./endpoint-allowlist";

test("assertAllowedLlmEndpoint allows public https hosts by default", () => {
  expect(() => assertAllowedLlmEndpoint("https://api.example.com/v1")).not.toThrow();
});

test("assertAllowedLlmEndpoint blocks private hosts without allowlist", () => {
  expect(() => assertAllowedLlmEndpoint("http://127.0.0.1:8080/v1")).toThrow();
});

test("assertAllowedLlmEndpoint honors LLM_ENDPOINT_ALLOWLIST", () => {
  const previous = process.env.LLM_ENDPOINT_ALLOWLIST;
  process.env.LLM_ENDPOINT_ALLOWLIST = "127.0.0.1";
  try {
    expect(() => assertAllowedLlmEndpoint("http://127.0.0.1:8080/v1")).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.LLM_ENDPOINT_ALLOWLIST;
    else process.env.LLM_ENDPOINT_ALLOWLIST = previous;
  }
});
