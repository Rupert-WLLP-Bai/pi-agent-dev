import { afterEach, beforeEach, expect, test } from "bun:test";
import { createApp } from "../app";
import { createMemoryLlmProviderStore } from "../llm/provider-repository";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

let previousAllowlist: string | undefined;
beforeEach(() => {
  previousAllowlist = process.env.LLM_ENDPOINT_ALLOWLIST;
  process.env.LLM_ENDPOINT_ALLOWLIST = "api.example.com,127.0.0.1";
});
afterEach(() => {
  if (previousAllowlist === undefined) delete process.env.LLM_ENDPOINT_ALLOWLIST;
  else process.env.LLM_ENDPOINT_ALLOWLIST = previousAllowlist;
});

const appWithProviders = () => {
  const providers = createMemoryLlmProviderStore();
  const app = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
    llmProviders: providers,
  });
  return { app, providers };
};

const json = (method: string, path: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("POST /api/llm-providers creates a provider without leaking the raw key", async () => {
  const { app } = appWithProviders();
  const response = await app.handle(
    json("POST", "/api/llm-providers", {
      name: "演示模型",
      endpoint: "https://api.example.com/v1",
      model: "demo-model",
      apiKey: "sk-secret-key-1234",
    }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.name).toBe("演示模型");
  expect(body.apiKeyConfigured).toBe(true);
  expect(body.apiKeyHint).toBe("…1234");
  expect(JSON.stringify(body)).not.toContain("sk-secret-key-1234");
});

test("GET /api/llm-providers lists providers without raw keys", async () => {
  const { app, providers } = appWithProviders();
  await providers.create({
    name: "已有模型",
    endpoint: "https://api.example.com/v1",
    model: "m",
    apiKey: "sk-abcdefg",
  });

  const response = await app.handle(json("GET", "/api/llm-providers"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toHaveLength(1);
  expect(body[0].apiKeyHint).toBe("…defg");
  expect(JSON.stringify(body)).not.toContain("sk-abcdefg");
});

test("activating a provider makes it the only active row", async () => {
  const { app, providers } = appWithProviders();
  const first = await providers.create({
    name: "一号",
    endpoint: "https://api.example.com/v1",
    model: "a",
    apiKey: "sk-1111",
  });
  const second = await providers.create({
    name: "二号",
    endpoint: "https://api.example.com/v1",
    model: "b",
    apiKey: "sk-2222",
  });

  const activate = await app.handle(json("POST", `/api/llm-providers/${second.id}/activate`));
  expect(activate.status).toBe(200);

  const listed = await providers.list();
  expect(listed.find((row) => row.id === second.id)?.isActive).toBe(true);
  expect(listed.find((row) => row.id === first.id)?.isActive).toBe(false);
});

test("draft model discovery needs no saved provider or API key and reports known limits", async () => {
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.has("authorization")) return new Response(null, { status: 401 });
      return Response.json({
        data: [
          { id: "local-16k", max_model_len: 16384, max_output_tokens: 4096 },
          { id: "cloud-64k", context_length: 65536, top_provider: { max_completion_tokens: 8192 } },
          { id: "unknown-limits" },
          { id: "invalid-limits", context_length: -1, max_output_tokens: 0.5 },
        ],
      });
    },
  });
  try {
    const { app, providers } = appWithProviders();
    const response = await app.handle(
      json("POST", "/api/llm-providers/models", {
        endpoint: `http://127.0.0.1:${gateway.port}/v1`,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        { id: "local-16k", maxInput: 16384, maxOutput: 4096 },
        { id: "cloud-64k", maxInput: 65536, maxOutput: 8192 },
        { id: "unknown-limits", maxInput: null, maxOutput: null },
        { id: "invalid-limits", maxInput: null, maxOutput: null },
      ],
    });
    expect(await providers.list()).toEqual([]);
  } finally {
    gateway.stop(true);
  }
});

test("POST /api/llm-providers accepts a blank API key for local compatible endpoints", async () => {
  const { app, providers } = appWithProviders();
  const response = await app.handle(
    json("POST", "/api/llm-providers", {
      name: "本地免密模型",
      endpoint: "https://api.example.com/v1",
      model: "local-model",
      apiKey: "",
    }),
  );
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.apiKeyConfigured).toBe(false);
  expect(created.apiKeyHint).toBeNull();
  expect((await providers.credentialsFor(created.id))?.apiKey).toBe("");
});

test("draft discovery uses saved credentials only for the saved destination", async () => {
  const headers: (string | null)[] = [];
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      headers.push(request.headers.get("authorization"));
      return Response.json({ data: [{ id: "local-model" }] });
    },
  });
  try {
    const { app, providers } = appWithProviders();
    const endpoint = `http://127.0.0.1:${gateway.port}/v1`;
    const provider = await providers.create({
      name: "已存服务",
      endpoint,
      model: "local-model",
      apiKey: "stored-secret",
    });
    for (const input of [
      { endpoint: `${endpoint}/`, providerId: provider.id },
      { endpoint: endpoint.replace("/v1", "/v2"), providerId: provider.id },
      { endpoint, providerId: provider.id, apiKey: "replacement-secret" },
      { endpoint, providerId: provider.id, apiKey: "" },
    ]) {
      const response = await app.handle(json("POST", "/api/llm-providers/models", input));
      expect(response.status).toBe(200);
    }
    expect(headers).toEqual(["Bearer stored-secret", null, "Bearer replacement-secret", null]);
    expect((await providers.credentialsFor(provider.id))?.apiKey).toBe("stored-secret");
  } finally {
    gateway.stop(true);
  }
});

test("draft discovery reports an upstream failure without presenting an empty catalog", async () => {
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  });
  try {
    const { app } = appWithProviders();
    const response = await app.handle(
      json("POST", "/api/llm-providers/models", {
        endpoint: `http://127.0.0.1:${gateway.port}/v1`,
      }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("HTTP 503");
  } finally {
    gateway.stop(true);
  }
});
