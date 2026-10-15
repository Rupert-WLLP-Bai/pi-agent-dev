import { afterEach, expect, test } from "bun:test";
import { buildTextlessPdf } from "../../testing/fakes";
import { createMineruOcrPort } from "./mineru";

/**
 * The MinerU adapter against the verified 4.x contract. Every fixture here is
 * the docvortex MiddleJSON/structured-content shape the official documentation
 * describes (`pages[].blocks[]`, `page_idx` 0-based, `content` an array of
 * `{ type, content }` items) — not the 3.x `pdf_info` layout, which is not the
 * 4.x contract and is deliberately unsupported.
 */

const realFetch = globalThis.fetch;

/** One request as the adapter saw it. */
interface Captured {
  url: string;
  method: string;
  body: unknown;
}

const captureFetch = (
  handler: (captured: Captured) => Response | Promise<Response>,
): { requests: Captured[] } => {
  const requests: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = init?.body;
    if (body instanceof FormData) {
      body = { formKeys: [...body.keys()] };
    }
    requests.push({ url, method: init?.method ?? "GET", body });
    return handler({ url, method: init?.method ?? "GET", body });
  }) as typeof fetch;
  return { requests };
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The 4.x structured content for one two-block page. */
const structuredContent = {
  pages: [
    {
      page_idx: 0,
      blocks: [
        { type: "text", index: 0, content: [{ type: "text", content: "第一条 服务内容" }] },
        { type: "text", index: 1, content: [{ type: "text", content: "第二条 服务期限" }] },
      ],
    },
  ],
  is_full_document: true,
};

const parseBody = (files: unknown) => ({ task_id: "t1", status: "completed", files });

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("structured content becomes blocks in the parser's reading order", async () => {
  captureFetch(() =>
    jsonResponse(
      parseBody([
        {
          file_id: "f1",
          name: "c.pdf",
          status: "completed",
          content: { middle_json: structuredContent },
        },
      ]),
    ),
  );

  const result = await createMineruOcrPort("http://mineru:8000").recognizePdf(buildTextlessPdf());

  expect(result.blocks).toEqual([
    { page: 1, index: 0, text: "第一条 服务内容" },
    { page: 1, index: 1, text: "第二条 服务期限" },
  ]);
  expect(result.pagesRead).toBe(1);
  expect(result.degradedPages).toEqual([]);
  expect(result.engine).toBe("mineru:http://mineru:8000");
});

test("the request carries only the file field and one output_formats per format", async () => {
  const { requests } = captureFetch(() =>
    jsonResponse(
      parseBody([
        { file_id: "f1", status: "completed", content: { middle_json: structuredContent } },
      ]),
    ),
  );

  await createMineruOcrPort("http://mineru:8000", { maxPages: 12 }).recognizePdf(
    buildTextlessPdf(),
  );

  const [request] = requests;
  expect(request.method).toBe("POST");
  expect(request.url).toBe(
    "http://mineru:8000/v1/file_parse?tier=basic&ocr_mode=ocr&wait_timeout=600&output_formats=markdown&output_formats=middle_json&page_range=1-12",
  );
  // A second form field is a 400 on the server; the file is the only one sent.
  expect(request.body).toEqual({ formKeys: ["files"] });
});

test("a failed job is a parse error carrying the server's own reason", async () => {
  captureFetch(() =>
    jsonResponse(
      {
        task_id: "t1",
        status: "failed",
        files: [
          {
            file_id: "f1",
            status: "failed",
            error: { code: "model_not_loaded", message: "VLM 权重未加载" },
          },
        ],
      },
      409,
    ),
  );

  await expect(
    createMineruOcrPort("http://mineru:8000").recognizePdf(buildTextlessPdf()),
  ).rejects.toThrow("VLM 权重未加载");
});

test("a task still running after the budget is a gap, never silent success", async () => {
  let polls = 0;
  captureFetch((captured) => {
    if (captured.url.includes("file_parse")) {
      return jsonResponse({ task_id: "t1", status: "running", status_url: "/v1/tasks/t1" }, 202);
    }
    // The result route keeps answering "still running": the gap must be
    // reported once the budget is spent, not looped forever.
    polls += 1;
    return jsonResponse(
      { task_id: "t1", status: "running", result_url: "/v1/tasks/t1/result" },
      202,
    );
  });

  await expect(
    createMineruOcrPort("http://mineru:8000", { resultBudgetMs: 50 }).recognizePdf(
      buildTextlessPdf(),
    ),
  ).rejects.toThrow("未在预算内完成");
  expect(polls).toBeGreaterThan(0);
});

test("a partially recognized file is reported as degraded, not as complete", async () => {
  captureFetch(() =>
    jsonResponse(
      parseBody([
        { file_id: "f1", status: "partial", content: { middle_json: structuredContent } },
      ]),
    ),
  );

  const result = await createMineruOcrPort("http://mineru:8000").recognizePdf(buildTextlessPdf());

  expect(result.blocks).toHaveLength(2);
  expect(result.degradedPages).toEqual([1]);
});

test("a health 503 — models not preloaded — is a failed probe, not a working recognizer", async () => {
  captureFetch(() => jsonResponse({ status: "error", detail: "模型预载失败" }, 503));

  const probe = await createMineruOcrPort("http://mineru:8000").probe();

  expect(probe.ok).toBe(false);
  expect(probe.detail).toContain("503");
});

test("an endpoint without the requested format is reported as not ready", async () => {
  captureFetch(() => jsonResponse({ status: "ok", features: { output_formats: ["markdown"] } }));

  const probe = await createMineruOcrPort("http://mineru:8000").probe();

  expect(probe.ok).toBe(false);
  expect(probe.detail).toContain("middle_json");
});

test("an unconfigured endpoint is disabled and says so instead of guessing", async () => {
  const port = createMineruOcrPort("");

  expect(port.enabled).toBe(false);
  expect((await port.probe()).detail).toContain("未配置");
});
