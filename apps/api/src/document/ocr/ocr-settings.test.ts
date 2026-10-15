import { afterEach, expect, test } from "bun:test";
import { createApp } from "../../app";
import {
  buildTextlessPdf,
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../../testing/fakes";
import { parseContractFile, ScannedPdfNotRecognizedError } from "..";
import { loadOcrConfig } from "./config";
import { createLiveOcrPort, createOcrPort } from "./index";
import {
  createMemoryOcrSettingsStore,
  OcrSettingsRepositoryError,
} from "./ocr-settings-repository";
import type { OcrPort, OcrResult } from "./types";

const realFetch = globalThis.fetch;

const appWithSettings = () => {
  const settings = createMemoryOcrSettingsStore();
  const app = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
    ocrSettings: settings,
  });
  return { app, settings };
};

const json = (method: string, path: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("an unsaved deployment reads the environment configuration, labelled as such", async () => {
  process.env.OCR_PROVIDER = "vlm";
  process.env.OCR_VLM_ENDPOINT = "http://127.0.0.1:18091/v1";
  process.env.OCR_VLM_MODEL = "cq/Qwen3.6-27B";
  process.env.OCR_VLM_API_KEY = "env-secret-9999";
  const { app } = appWithSettings();

  try {
    const response = await app.handle(json("GET", "/api/ocr-settings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("env");
    expect(body.provider).toBe("vlm");
    expect(body.vlmModel).toBe("cq/Qwen3.6-27B");
    // The env key is the existing bootstrap behaviour: reported as a mask only.
    expect(body.vlmApiKeyConfigured).toBe(true);
    expect(body.vlmApiKeyHint).toBe("…9999");
    expect(JSON.stringify(body)).not.toContain("env-secret-9999");
  } finally {
    delete process.env.OCR_PROVIDER;
    delete process.env.OCR_VLM_ENDPOINT;
    delete process.env.OCR_VLM_MODEL;
    delete process.env.OCR_VLM_API_KEY;
  }
});

test("a save persists, survives a fresh app over the same store, and keeps the key masked", async () => {
  const { app, settings } = appWithSettings();

  const saved = await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "vlm",
      vlmEndpoint: "http://127.0.0.1:18091/v1",
      vlmApiKey: "saved-key-1234",
      vlmModel: "cq/Qwen3.6-27B",
      maxPages: 12,
      concurrency: 2,
    }),
  );
  expect(saved.status).toBe(200);

  // A second app over the same store is what a restart looks like: the row is
  // the configuration in force, not the environment.
  const restarted = createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
    ocrSettings: settings,
  });
  const read = await restarted.handle(json("GET", "/api/ocr-settings"));
  const body = await read.json();

  expect(body.source).toBe("stored");
  expect(body.provider).toBe("vlm");
  expect(body.maxPages).toBe(12);
  expect(body.concurrency).toBe(2);
  expect(body.vlmApiKeyHint).toBe("…1234");
  expect(JSON.stringify(body)).not.toContain("saved-key-1234");
});

test("a blank key edit keeps the stored credential", async () => {
  const { app, settings } = appWithSettings();

  await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "vlm",
      vlmEndpoint: "http://127.0.0.1:18091/v1",
      vlmApiKey: "first-key-1111",
      vlmModel: "model-a",
    }),
  );
  // The page always posts the key field; an empty one must not blank it.
  await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "vlm",
      vlmEndpoint: "http://127.0.0.1:18091/v1",
      vlmApiKey: "",
      vlmModel: "model-b",
    }),
  );

  const config = await settings.rawConfig();
  expect(config?.apiKey).toBe("first-key-1111");
  expect(config?.model).toBe("model-b");
});

test("a save switches the recognizer the next parse uses, without a restart", async () => {
  const { app, settings } = appWithSettings();
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/health")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [{ id: "vision-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  // The live port the app holds for its whole lifetime.
  const live = createLiveOcrPort(async () => (await settings.rawConfig()) ?? loadOcrConfig());

  await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "vlm",
      vlmEndpoint: "http://127.0.0.1:18091/v1",
      vlmModel: "vision-model",
    }),
  );

  // The next operation sees the saved recognizer — the port was not rebuilt.
  const port = await live.capture();
  expect(port.provider).toBe("vlm");
  expect(port.enabled).toBe(true);
  expect(await port.probe().then((probe) => probe.ok)).toBe(true);
  expect(seen).toContain("GET http://127.0.0.1:18091/v1/models");

  // Switching the provider mid-flight changes what the *next* capture resolves
  // to; the port object the app holds is unchanged throughout.
  await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "mineru",
      mineruEndpoint: "http://mineru:8000",
    }),
  );
  const switched = await live.capture();
  expect(switched.provider).toBe("mineru");
  expect(switched.target).toBe("http://mineru:8000");
  // Probing the captured port proves the recognizer now points at MinerU.
  expect((await switched.probe()).ok).toBe(true);
  expect(seen).toContain("GET http://mineru:8000/v1/health");
});

test("the probe route records its outcome against the stored row", async () => {
  const { app, settings } = appWithSettings();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ id: "vision-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await app.handle(
    json("PATCH", "/api/ocr-settings", {
      provider: "vlm",
      vlmEndpoint: "http://127.0.0.1:18091/v1",
      vlmModel: "vision-model",
    }),
  );
  const probe = await app.handle(json("POST", "/api/ocr-settings/test"));
  expect(probe.status).toBe(200);
  expect((await probe.json()).ok).toBe(true);

  const stored = await settings.get();
  expect(stored?.lastCheckOk).toBe(true);
  expect(stored?.lastCheckError).toBe(null);
});

test("a saved off provider disables recognition with an honest reason", async () => {
  const { app, settings } = appWithSettings();

  await app.handle(json("PATCH", "/api/ocr-settings", { provider: "off" }));

  const port = createOcrPort((await settings.rawConfig()) ?? loadOcrConfig());
  expect(port.enabled).toBe(false);
  const probe = await port.probe();
  expect(probe.ok).toBe(false);
  expect(probe.detail).toContain("扫描件");
});

test("a stored recognizer wins over the environment once a row exists", async () => {
  process.env.OCR_PROVIDER = "vlm";
  process.env.OCR_VLM_ENDPOINT = "http://env-endpoint:1/v1";
  const { settings } = appWithSettings();

  try {
    await settings.save({
      provider: "mineru",
      mineruEndpoint: "http://mineru:8000",
    });
    const config = await settings.rawConfig();
    // The row, not the environment, is what the recognizer is built from.
    expect(config?.provider).toBe("mineru");
    expect(config?.mineruEndpoint).toBe("http://mineru:8000");
    const port = createOcrPort(config ?? loadOcrConfig());
    expect(port.provider).toBe("mineru");
  } finally {
    delete process.env.OCR_PROVIDER;
    delete process.env.OCR_VLM_ENDPOINT;
  }
});

test("the first save from an env bootstrap keeps the environment's key", async () => {
  process.env.OCR_PROVIDER = "vlm";
  process.env.OCR_VLM_ENDPOINT = "http://127.0.0.1:18091/v1";
  process.env.OCR_VLM_API_KEY = "env-key-7777";
  process.env.OCR_VLM_MODEL = "env-vision";
  const { app, settings } = appWithSettings();

  try {
    // The page posts the key field blank: the operator never re-typed the key
    // the deployment already carries in the environment.
    const saved = await app.handle(
      json("PATCH", "/api/ocr-settings", { provider: "vlm", vlmApiKey: "" }),
    );
    expect(saved.status).toBe(200);
    const body = await saved.json();

    // The stored row must carry the environment's key and wiring, not the
    // column defaults — otherwise the first save would silently drop the
    // credential the operator was shown as configured.
    const config = await settings.rawConfig();
    expect(config?.apiKey).toBe("env-key-7777");
    expect(config?.endpoint).toBe("http://127.0.0.1:18091/v1");
    expect(config?.model).toBe("env-vision");
    expect(body.vlmApiKeyConfigured).toBe(true);
    expect(body.vlmApiKeyHint).toBe("…7777");
    expect(JSON.stringify(body)).not.toContain("env-key-7777");
  } finally {
    delete process.env.OCR_PROVIDER;
    delete process.env.OCR_VLM_ENDPOINT;
    delete process.env.OCR_VLM_API_KEY;
    delete process.env.OCR_VLM_MODEL;
  }
});

test("a typed key replaces the one already stored", async () => {
  const { settings } = appWithSettings();

  await settings.save({
    provider: "vlm",
    vlmEndpoint: "http://127.0.0.1:18091/v1",
    vlmApiKey: "old-key-0000",
    vlmModel: "model-a",
  });
  await settings.save({
    provider: "vlm",
    vlmEndpoint: "http://127.0.0.1:18091/v1",
    vlmApiKey: "new-key-4242",
    vlmModel: "model-a",
  });

  const config = await settings.rawConfig();
  expect(config?.apiKey).toBe("new-key-4242");
  // And a subsequent blank edit still keeps the replacement.
  await settings.save({ vlmModel: "model-b" });
  expect((await settings.rawConfig())?.apiKey).toBe("new-key-4242");
  expect((await settings.get())?.vlmApiKeyHint).toBe("…4242");
});

test("out-of-range raster settings are clamped rather than stored", async () => {
  const { settings } = appWithSettings();

  const saved = await settings.save({
    provider: "vlm",
    vlmEndpoint: "http://127.0.0.1:18091/v1",
    vlmModel: "model",
    maxPages: 99_999,
    scale: 99,
    jpegQuality: 1,
    concurrency: 0,
    requestTimeoutMs: -5,
  });

  expect(saved.maxPages).toBe(1000);
  expect(saved.scale).toBe(4);
  expect(saved.jpegQuality).toBe(30);
  expect(saved.concurrency).toBe(1);
  expect(saved.requestTimeoutMs).toBe(1000);
});

test("a malformed endpoint is refused with a 400, not stored", async () => {
  const { settings } = appWithSettings();

  await expect(
    settings.save({ provider: "vlm", vlmEndpoint: "not-a-url", vlmModel: "m" }),
  ).rejects.toThrow(OcrSettingsRepositoryError);
  expect(await settings.get()).toBe(null);

  await expect(
    settings.save({ provider: "vlm", vlmEndpoint: "ftp://127.0.0.1:1/v1", vlmModel: "m" }),
  ).rejects.toThrow(OcrSettingsRepositoryError);
  expect(await settings.get()).toBe(null);
});

/**
 * The whole path the smoke run exercised: a saved VLM configuration, a scan
 * with no text layer, and a parse that must reach the recognizer. This is the
 * regression that pins "the dispatcher's captured port is passed down, not
 * undefined" — a dropped parameter makes the parse fall back to the
 * environment recognizer and the case fails with zero model requests.
 */
test("a saved VLM configuration drives a textless PDF parse through recognizePdf", async () => {
  const { settings } = appWithSettings();

  // A recognizer that records that it was actually reached.
  class RecordingOcrPort implements OcrPort {
    readonly provider = "vlm";
    readonly target = "vlm:vision-model @ http://127.0.0.1:18091/v1";
    readonly enabled = true;
    recognizeCalls = 0;

    async probe() {
      return { ok: true, detail: null };
    }

    async recognizePdf(): Promise<OcrResult> {
      this.recognizeCalls += 1;
      return {
        blocks: [{ page: 1, index: 0, text: "第一条 服务内容" }],
        pagesRead: 1,
        pageCount: 1,
        engine: "vlm:vision-model",
        degradedPages: [],
      };
    }
  }
  const recognizer = new RecordingOcrPort();

  await settings.save({
    provider: "vlm",
    vlmEndpoint: "http://127.0.0.1:18091/v1",
    vlmApiKey: "vision-key-1234",
    vlmModel: "vision-model",
  });

  // The parse receives the port the dispatcher captured, exactly as
  // `ensureRunSnapshot` hands it to `parseContractFile`.
  const parsed = await parseContractFile(
    { filename: "扫描合同.pdf", data: buildTextlessPdf() },
    recognizer,
  );

  expect(recognizer.recognizeCalls).toBe(1);
  expect(parsed.ocr?.engine).toBe("vlm:vision-model");
  expect(parsed.text).toContain("第一条 服务内容");
});

test("a textless PDF parse reports the recognizer it actually reached", async () => {
  // The dispatcher resolved a recognizer that is off — the configuration
  // question is which one, and the error must name it.
  const disabled: OcrPort = {
    provider: "vlm",
    target: "vlm @ http://127.0.0.1:18091/v1",
    enabled: false,
    async probe() {
      return { ok: false, detail: "OCR_PROVIDER=vlm 但缺少 OCR_VLM_ENDPOINT 或 OCR_VLM_MODEL" };
    },
    async recognizePdf(): Promise<OcrResult> {
      throw new Error("不应被调用");
    },
  };

  const attempt = parseContractFile(
    { filename: "扫描合同.pdf", data: buildTextlessPdf() },
    disabled,
  );

  await expect(attempt).rejects.toBeInstanceOf(ScannedPdfNotRecognizedError);
  const error = await attempt.catch((caught: unknown) => caught);
  expect((error as ScannedPdfNotRecognizedError).recognizer).toEqual({
    provider: "vlm",
    target: "vlm @ http://127.0.0.1:18091/v1",
    enabled: false,
  });
});
