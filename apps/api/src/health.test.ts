import { beforeEach, expect, test } from "bun:test";
import type { AuditApp } from "./app";
import { createApp } from "./app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "./testing/fakes";

let repository: InMemoryAuditCaseRepository;
let dispatcher: FakeDispatcher;
let broker: RecordingEventBroker;
let app: AuditApp;

const buildApp = () =>
  createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: broker.asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });

const readHealth = async (target: ReturnType<typeof createApp>) =>
  target.handle(new Request("http://localhost/api/health"));

beforeEach(() => {
  repository = new InMemoryAuditCaseRepository();
  dispatcher = new FakeDispatcher();
  broker = new RecordingEventBroker();
  app = buildApp();
});

test("reports database and dispatcher readiness", async () => {
  repository.databaseAvailable = true;
  dispatcher.isStarted = true;

  const response = await readHealth(app);

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.database).toBe(true);
  expect(body.dispatcher).toBe(true);
});

test("reports every integration field alongside the aggregate status", async () => {
  repository.databaseAvailable = true;
  dispatcher.isStarted = true;

  const body = await (await readHealth(app)).json();

  expect(typeof body.database).toBe("boolean");
  expect(typeof body.dispatcher).toBe("boolean");
  expect(["pi", "fake"]).toContain(body.agentMode);
  expect(typeof body.qccConfigured).toBe("boolean");
  expect(typeof body.llmConfigured).toBe("boolean");
});

test("reports 503 when the database is unreachable", async () => {
  repository.databaseAvailable = false;
  dispatcher.isStarted = true;

  const response = await readHealth(app);

  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.status).toBe("unavailable");
  expect(body.database).toBe(false);
  // The failing integration is named without hiding the healthy ones.
  expect(body.dispatcher).toBe(true);
});

test("reports 503 when the dispatcher has not started", async () => {
  repository.databaseAvailable = true;
  dispatcher.isStarted = false;

  const response = await readHealth(app);

  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.dispatcher).toBe(false);
});

test("reports credential presence without echoing credential values", async () => {
  const qccToken = "qcc-secret-9f8e7d";
  const llmKey = "llm-secret-1a2b3c";
  const previousQccToken = process.env.QCC_TOKEN;
  const previousLlmKey = process.env.XYG_API_KEY;
  process.env.QCC_TOKEN = qccToken;
  process.env.XYG_API_KEY = llmKey;
  try {
    repository.databaseAvailable = true;
    dispatcher.isStarted = true;
    // createApp reads the environment when it is built, so probe a fresh app.
    const response = await readHealth(buildApp());

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(qccToken);
    expect(text).not.toContain(llmKey);

    const body = JSON.parse(text);
    expect(body.qccConfigured).toBe(true);
    expect(body.llmConfigured).toBe(true);
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("secret");
    expect(body).not.toHaveProperty("qccToken");
  } finally {
    if (previousQccToken === undefined) delete process.env.QCC_TOKEN;
    else process.env.QCC_TOKEN = previousQccToken;
    if (previousLlmKey === undefined) delete process.env.XYG_API_KEY;
    else process.env.XYG_API_KEY = previousLlmKey;
  }
});
