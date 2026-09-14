import { afterEach, expect, test } from "bun:test";
import { buildTextlessPdf } from "../../testing/fakes";
import { createOcrPort, loadOcrConfig } from "./index";
import { createVlmOcrPort, type VlmOcrConfig } from "./vlm";

const config = (overrides: Partial<VlmOcrConfig> = {}): VlmOcrConfig => ({
  endpoint: "http://127.0.0.1:18091/v1",
  apiKey: "panda-local",
  model: "cq/Qwen3.6-27B",
  fallbackModel: "cq1/qwen3.6",
  maxPages: 40,
  scale: 1,
  jpegQuality: 60,
  concurrency: 2,
  requestTimeoutMs: 5_000,
  ...overrides,
});

const realFetch = globalThis.fetch;

/** Replaces fetch with a handler that sees the parsed request body. */
function stubFetch(handler: (body: Record<string, unknown>, url: string) => Response): string[] {
  const modelsSeen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
    if (typeof body.model === "string") modelsSeen.push(body.model);
    return handler(body, url);
  }) as typeof fetch;
  return modelsSeen;
}

const chatResponse = (content: string, finishReason = "stop"): Response =>
  new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("each transcribed line becomes a block carrying its page and reading order", async () => {
  stubFetch(() =>
    chatResponse("编号：JB2022019021\n四、 乙方的权利和义务\n\n1. 乙方负责提供服务。"),
  );

  const result = await createVlmOcrPort(config()).recognizePdf(buildTextlessPdf());

  expect(result.blocks).toHaveLength(3);
  expect(result.blocks[0]).toEqual({ page: 1, index: 0, text: "编号：JB2022019021" });
  expect(result.blocks[2]).toEqual({ page: 1, index: 2, text: "1. 乙方负责提供服务。" });
  expect(result.engine).toBe("vlm:cq/Qwen3.6-27B");
  expect(result.pagesRead).toBe(1);
  expect(result.degradedPages).toEqual([]);
});

test("the page image is sent inline as a JPEG data URL, with the key as a bearer token", async () => {
  let captured: Record<string, unknown> = {};
  stubFetch((body) => {
    captured = body;
    return chatResponse("条款");
  });

  await createVlmOcrPort(config()).recognizePdf(buildTextlessPdf());

  const content = (
    captured.messages as { content: { type: string; image_url?: { url: string } }[] }[]
  )[0].content;
  const image = content.find((part) => part.type === "image_url");
  expect(image?.image_url?.url).toStartWith("data:image/jpeg;base64,");
  // Transcription must be deterministic: a resampled reading is a different contract.
  expect(captured.temperature).toBe(0);
});

test("a page truncated by the output budget is retried on the larger-budget model", async () => {
  const modelsSeen = stubFetch((body) =>
    body.model === "cq/Qwen3.6-27B"
      ? chatResponse("第一条 服务内容", "length")
      : chatResponse("第一条 服务内容\n第二条 服务期限\n第三条 结算方式"),
  );

  const result = await createVlmOcrPort(config()).recognizePdf(buildTextlessPdf());

  expect(modelsSeen).toEqual(["cq/Qwen3.6-27B", "cq1/qwen3.6"]);
  expect(result.blocks).toHaveLength(3);
  expect(result.degradedPages).toEqual([]);
});

test("a page still truncated after the retry keeps its text but is reported as degraded", async () => {
  stubFetch(() => chatResponse("第一条 服务内容", "length"));

  const result = await createVlmOcrPort(config()).recognizePdf(buildTextlessPdf());

  expect(result.blocks).toHaveLength(1);
  expect(result.degradedPages).toEqual([1]);
});

test("one failed page is reported as degraded without losing the others", async () => {
  let call = 0;
  stubFetch(() => {
    call += 1;
    if (call === 1)
      return new Response(JSON.stringify({ error: { message: "上游超时" } }), { status: 502 });
    return chatResponse("可读页内容");
  });

  // Serial so the failing call is deterministically the first page.
  const result = await createVlmOcrPort(config({ concurrency: 1 })).recognizePdf(
    buildTextlessPdf(2),
  );

  expect(result.degradedPages).toEqual([1]);
  expect(result.blocks).toEqual([{ page: 2, index: 0, text: "可读页内容" }]);
});

test("the page cap bounds recognition while still reporting the true page count", async () => {
  stubFetch(() => chatResponse("一行"));

  const result = await createVlmOcrPort(config({ maxPages: 2 })).recognizePdf(buildTextlessPdf(5));

  expect(result.pagesRead).toBe(2);
  expect(result.pageCount).toBe(5);
});

test("the probe fails when the endpoint does not list the configured model", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ data: [{ id: "cq1/qwen3.6" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  const probe = await createVlmOcrPort(config()).probe();

  expect(probe.ok).toBe(false);
  expect(probe.detail).toContain("cq/Qwen3.6-27B");
});

test("an unreachable endpoint is a failed probe, never a thrown error", async () => {
  stubFetch(() => {
    throw new Error("connect ECONNREFUSED");
  });

  const probe = await createVlmOcrPort(config()).probe();

  expect(probe.ok).toBe(false);
  expect(probe.detail).toBe("connect ECONNREFUSED");
});

test("recognition stays off unless an endpoint is configured, and off is honoured explicitly", async () => {
  expect(loadOcrConfig({}).provider).toBe("off");
  expect(loadOcrConfig({ OCR_VLM_ENDPOINT: "http://127.0.0.1:18091/v1" }).provider).toBe("vlm");
  expect(
    loadOcrConfig({ OCR_PROVIDER: "off", OCR_VLM_ENDPOINT: "http://127.0.0.1:18091/v1" }).provider,
  ).toBe("off");
  // An unparseable numeric override must fall back, never become NaN pages.
  expect(loadOcrConfig({ OCR_MAX_PAGES: "abc" }).maxPages).toBe(40);
  expect(loadOcrConfig({ OCR_MAX_PAGES: "-3" }).maxPages).toBe(40);
});

test("a half-configured provider yields a disabled port that explains itself", async () => {
  const port = createOcrPort(
    loadOcrConfig({ OCR_PROVIDER: "vlm", OCR_VLM_ENDPOINT: "http://127.0.0.1:18091/v1" }),
  );

  expect(port.enabled).toBe(false);
  expect((await port.probe()).detail).toContain("OCR_VLM_MODEL");
});

test("the MinerU slot is reachable but honestly reports itself unimplemented", async () => {
  const port = createOcrPort(
    loadOcrConfig({ OCR_PROVIDER: "mineru", MINERU_ENDPOINT: "http://mineru:8000" }),
  );

  expect(port.provider).toBe("mineru");
  expect(port.enabled).toBe(false);
  expect((await port.probe()).detail).toContain("尚未实现");
});
