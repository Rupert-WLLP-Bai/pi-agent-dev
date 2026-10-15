import { afterEach, beforeEach, expect, test } from "bun:test";
import { assertAllowedLlmEndpoint } from "./endpoint-allowlist";

/**
 * The ambient `.env` may set `LLM_ENDPOINT_ALLOWLIST` (this deployment does,
 * for its local model endpoint). These tests describe the *default* policy, so
 * the variable is cleared for their duration and restored afterwards —
 * otherwise the verdict depends on which developer's `.env` is present.
 */
let previousAllowlist: string | undefined;

beforeEach(() => {
  previousAllowlist = process.env.LLM_ENDPOINT_ALLOWLIST;
  delete process.env.LLM_ENDPOINT_ALLOWLIST;
});

afterEach(() => {
  if (previousAllowlist === undefined) delete process.env.LLM_ENDPOINT_ALLOWLIST;
  else process.env.LLM_ENDPOINT_ALLOWLIST = previousAllowlist;
});

test("assertAllowedLlmEndpoint allows public https hosts by default", () => {
  expect(() => assertAllowedLlmEndpoint("https://api.example.com/v1")).not.toThrow();
});

test("assertAllowedLlmEndpoint blocks private hosts without allowlist", () => {
  expect(() => assertAllowedLlmEndpoint("http://127.0.0.1:8080/v1")).toThrow();
});

test("assertAllowedLlmEndpoint rejects a malformed or non-http endpoint", () => {
  expect(() => assertAllowedLlmEndpoint("not-a-url")).toThrow();
  expect(() => assertAllowedLlmEndpoint("ftp://api.example.com/v1")).toThrow();
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
