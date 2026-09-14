import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiConfig } from "./config";
import type { OcrPort, OcrProbe } from "./document/ocr";
import { buildHealthSnapshot, type HealthInputs } from "./health";
import type { VerificationCache } from "./qcc/cache";

let uploadDir: string;
let previousUploadDir: string | undefined;

const redisClient = (ping: boolean | (() => Promise<boolean>)): VerificationCache => ({
  async get() {
    return null;
  },
  async set() {},
  async ping() {
    return typeof ping === "boolean" ? ping : ping();
  },
});

const ocrPort = (probe: OcrProbe, enabled = true): OcrPort => ({
  provider: "vlm",
  target: "cq/Qwen3.6-27B @ http://127.0.0.1:18091/v1",
  enabled,
  async probe() {
    return probe;
  },
  async recognizePdf() {
    throw new Error("not used in health tests");
  },
});

const baseConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  databaseUrl: "postgresql://contract_audit:contract_audit@localhost:5433/contract_audit",
  agentTimeoutMs: 300_000,
  maxConcurrentAudits: 1,
  apiPort: 3000,
  webOrigin: "http://localhost:5173",
  agentMode: "pi",
  subjectVerificationMode: "qcc",
  reviewSlaHours: 24,
  qccCompanyEndpoint: "https://agent.qcc.com/mcp/company/stream",
  qccRiskEndpoint: "https://agent.qcc.com/mcp/risk/stream",
  qccToken: "qcc-token-present",
  llmConfigured: true,
  ...overrides,
});

const baseInputs = (overrides: Partial<HealthInputs> = {}): HealthInputs => ({
  config: baseConfig(),
  databaseOk: true,
  dispatcherOk: true,
  redis: { url: "redis://redis:6379", client: redisClient(true) },
  objectStore: {
    accessKey: "key",
    secretKey: "secret",
    bucket: "contract-originals",
    region: "us-east-1",
  },
  agent: {
    mode: "pi",
    providerName: "deepseek",
    endpoint: "http://221.178.103.68",
    model: "deepseek-v4-flash",
    configured: true,
  },
  qcc: {
    companyEndpoint: "https://agent.qcc.com/mcp/company/stream",
    riskEndpoint: "https://agent.qcc.com/mcp/risk/stream",
    tokenConfigured: true,
  },
  ocr: ocrPort({ ok: true, detail: null }),
  ...overrides,
});

beforeEach(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(join(tmpdir(), "health-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(async () => {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  await rm(uploadDir, { recursive: true, force: true });
});

test("all healthy inputs report ok with every connection up", async () => {
  const snapshot = await buildHealthSnapshot(baseInputs());

  expect(snapshot.status).toBe("ok");
  expect(snapshot.database).toBe(true);
  expect(snapshot.dispatcher).toBe(true);
  expect(snapshot.agentMode).toBe("pi");
  expect(snapshot.qccConfigured).toBe(true);
  expect(snapshot.llmConfigured).toBe(true);
  for (const name of [
    "database",
    "redis",
    "objectStore",
    "llm",
    "qcc",
    "ocr",
    "dispatcher",
  ] as const) {
    expect(snapshot.connections[name].ok).toBe(true);
    expect(snapshot.connections[name].detail).toBeNull();
  }
  expect(snapshot.connections.database.target).toBe("localhost:5433/contract_audit");
  expect(snapshot.connections.redis.target).toBe("redis:6379");
  expect(snapshot.connections.objectStore.target).toContain(uploadDir);
  expect(snapshot.connections.llm.target).toBe("deepseek-v4-flash @ http://221.178.103.68");
});

test("a down or unconfigured Redis degrades without changing status", async () => {
  const down = await buildHealthSnapshot(
    baseInputs({ redis: { url: "redis://redis:6379", client: redisClient(false) } }),
  );

  expect(down.status).toBe("ok");
  expect(down.connections.redis.ok).toBe(false);
  expect(down.connections.redis.target).toBe("redis:6379");
  expect(down.connections.redis.detail).not.toBeNull();

  const unconfigured = await buildHealthSnapshot(
    baseInputs({ redis: { url: undefined, client: null } }),
  );

  expect(unconfigured.status).toBe("ok");
  expect(unconfigured.connections.redis.ok).toBe(false);
  expect(unconfigured.connections.redis.target).toBe("未配置");
  expect(unconfigured.connections.redis.detail).not.toBeNull();
});

test("a client that rejects its ping is reported as a failed probe, never thrown", async () => {
  const rejected = await buildHealthSnapshot(
    baseInputs({
      redis: {
        url: "redis://redis:6379",
        client: redisClient(() => Promise.reject(new Error("redis ping exploded"))),
      },
    }),
  );

  expect(rejected.status).toBe("ok");
  expect(rejected.connections.redis.ok).toBe(false);
  expect(rejected.connections.redis.detail).toBe("redis ping exploded");
});

test("a failed object-store probe degrades without changing status", async () => {
  // Point the local fallback at a path whose parent is a file, so mkdir fails.
  const blocker = join(uploadDir, "blocker");
  await writeFile(blocker, "not a directory");
  process.env.UPLOAD_DIR = join(blocker, "uploads");

  const snapshot = await buildHealthSnapshot(baseInputs());

  expect(snapshot.status).toBe("ok");
  expect(snapshot.connections.objectStore.ok).toBe(false);
  expect(snapshot.connections.objectStore.target).toContain("（本地目录）");
  expect(snapshot.connections.objectStore.detail).not.toBeNull();
});

test("an unreachable or disabled OCR provider degrades without changing status", async () => {
  const unreachable = await buildHealthSnapshot(
    baseInputs({ ocr: ocrPort({ ok: false, detail: "模型列表返回 503" }) }),
  );

  expect(unreachable.status).toBe("ok");
  expect(unreachable.connections.ocr.ok).toBe(false);
  expect(unreachable.connections.ocr.detail).toBe("模型列表返回 503");

  const disabled = await buildHealthSnapshot(
    baseInputs({ ocr: ocrPort({ ok: false, detail: "未设置 OCR_VLM_ENDPOINT" }, false) }),
  );

  expect(disabled.status).toBe("ok");
  expect(disabled.connections.ocr.ok).toBe(false);
  expect(disabled.connections.ocr.detail).toBe("未设置 OCR_VLM_ENDPOINT");
});

test("an OCR probe that rejects is reported as a failed probe, never thrown", async () => {
  const snapshot = await buildHealthSnapshot(
    baseInputs({
      ocr: {
        ...ocrPort({ ok: true, detail: null }),
        probe: () => Promise.reject(new Error("connect ECONNREFUSED")),
      },
    }),
  );

  expect(snapshot.status).toBe("ok");
  expect(snapshot.connections.ocr.ok).toBe(false);
  expect(snapshot.connections.ocr.detail).toBe("connect ECONNREFUSED");
});

test("a database or dispatcher failure makes the snapshot unavailable", async () => {
  const databaseDown = await buildHealthSnapshot(baseInputs({ databaseOk: false }));

  expect(databaseDown.status).toBe("unavailable");
  expect(databaseDown.database).toBe(false);
  expect(databaseDown.connections.database.ok).toBe(false);

  const dispatcherDown = await buildHealthSnapshot(baseInputs({ dispatcherOk: false }));

  expect(dispatcherDown.status).toBe("unavailable");
  expect(dispatcherDown.dispatcher).toBe(false);
  expect(dispatcherDown.connections.dispatcher.ok).toBe(false);
});

test("no credential value can be reached from the serialized snapshot", async () => {
  const password = "sup3r-s3cret-pw";
  const snapshot = await buildHealthSnapshot(
    baseInputs({
      config: baseConfig({
        databaseUrl: `postgresql://contract_audit:${password}@localhost:5433/contract_audit`,
      }),
      redis: { url: "redis://:hunter2@redis:6379", client: redisClient(true) },
    }),
  );

  const serialized = JSON.stringify(snapshot);

  expect(serialized).not.toContain(password);
  expect(serialized).not.toContain("hunter2");
  expect(snapshot.connections.database.target).toBe("localhost:5433/contract_audit");
  expect(snapshot.qccConfigured).toBe(true);
  expect(snapshot.llmConfigured).toBe(true);
});

test("Redis target rendering strips credentials from the URL", async () => {
  const snapshot = await buildHealthSnapshot(
    baseInputs({ redis: { url: "redis://:hunter2@redis:6379", client: redisClient(true) } }),
  );

  expect(snapshot.connections.redis.target).toBe("redis:6379");
  expect(snapshot.connections.redis.target).not.toContain("hunter2");
});
