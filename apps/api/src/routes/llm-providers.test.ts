import { expect, test } from "bun:test";
import { createApp } from "../app";
import { createMemoryLlmProviderStore } from "../llm/provider-repository";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

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
