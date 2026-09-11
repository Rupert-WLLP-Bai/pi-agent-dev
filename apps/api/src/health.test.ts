import { beforeEach, expect, test } from "bun:test";
import { createApp } from "./app";
import { FakeDispatcher, InMemoryAuditCaseRepository, RecordingEventBroker } from "./testing/fakes";

let repository: InMemoryAuditCaseRepository;
let dispatcher: FakeDispatcher;
let broker: RecordingEventBroker;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  repository = new InMemoryAuditCaseRepository();
  dispatcher = new FakeDispatcher();
  broker = new RecordingEventBroker();
  app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: broker.asBroker(),
  });
});

test("reports database and dispatcher readiness", async () => {
  repository.databaseAvailable = true;
  dispatcher.isStarted = true;

  const response = await app.handle(new Request("http://localhost/api/health"));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("reports 503 when the database is unreachable", async () => {
  repository.databaseAvailable = false;
  dispatcher.isStarted = true;

  const response = await app.handle(new Request("http://localhost/api/health"));

  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.status).toBe("unavailable");
  expect(body.database).toBe(false);
});

test("reports 503 when the dispatcher has not started", async () => {
  repository.databaseAvailable = true;
  dispatcher.isStarted = false;

  const response = await app.handle(new Request("http://localhost/api/health"));

  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.dispatcher).toBe(false);
});
