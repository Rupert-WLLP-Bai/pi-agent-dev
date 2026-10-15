import type { OcrBlock, OcrPort, OcrProbe, OcrResult } from "./types";

/**
 * MinerU 4.x recognizer. The HTTP contract and the response schema implemented
 * here were verified from the official source (`mineru/parser/task_api.py`,
 * `api_server.py`, `docvortex.schema`) and documentation for `mineru==4.0.12` —
 * see `docs/research/2026-10-14-mineru-deployment-recheck.md`.
 *
 * The request: `POST {endpoint}/v1/file_parse` as multipart/form-data carrying
 * **only** the `files` field (any other form field is a 400). Every option is a
 * query parameter, and `output_formats` is repeated per format — a
 * comma-joined value is rejected as one unknown format. The endpoint is the
 * API *root* (`http://127.0.0.1:8000`), never `.../v1`, which this adapter
 * appends. The options object is `extra="forbid"`, so only `tier`, `ocr_mode`,
 * `page_range`, `output_formats` and `wait_timeout` are sent.
 *
 * The response: docvortex MiddleJSON **version 2.0**, whose shape is
 * `{ pages: [{ page_idx, blocks: [{ type, index, content }] }],
 * is_full_document, metadata }`. A text block's `content` is an array of
 * `{ type: "text", content }` items; a table block's is `{ type: "table",
 * html }`. The legacy 3.x `pdf_info` layout is deliberately not supported —
 * it is not the 4.x contract, and guessing at both would be untestable.
 *
 * Status handling: a terminal `failed`/`canceled` job answers **409** with the
 * payload attached; a `wait_timeout` expiry and a not-yet-terminal job both
 * answer **202** with `task_id`/`status_url`/`result_url`. The status field
 * decides which state that is — the HTTP code alone cannot.
 *
 * Only a `--api-key` deployment requires `Authorization: Bearer <key>` on
 * non-public `/v1/*` routes (`/v1/health`, `/v1/models`, `/v1/tiers` are
 * public), and an empty bearer is never sent.
 *
 * A 202 means the task is not terminal yet; the result is then polled from
 * `GET /v1/tasks/{task_id}/result?response_format=json`, which is the only
 * route that serves it (the synchronous response carried no content).
 */

/** How long one synchronous parse may take before the server answers 202. */
const WAIT_TIMEOUT = 600;

/** Output formats requested: the readable text plus the 4.x block geometry. */
const OUTPUT_FORMATS = ["markdown", "middle_json"] as const;

/** The inline content keys the 4.x server may serve block geometry under. */
const CONTENT_KEYS = ["structured_content", "middle_json"] as const;

/** Job states that mean the parse is over, whichever side of success they are. */
const TERMINAL_STATUSES: Record<string, true> = {
  completed: true,
  partial: true,
  failed: true,
  canceled: true,
};

/** How often the result route is re-asked while the task keeps running. */
const RESULT_POLL_INTERVAL_MS = 2_000;

/**
 * Reads a not-yet-terminal task's result. The route answers 202 while the job
 * runs and the payload once it has settled, so this loops until one of those
 * two states arrives or the budget runs out.
 */
const pollResult = async (root: string, taskId: string, timeoutMs: number): Promise<TaskResult> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(
      `${root}/v1/tasks/${encodeURIComponent(taskId)}/result?response_format=json`,
      { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) },
    );
    const payload = (await response.json().catch(() => null)) as TaskResult | null;
    if (payload?.status !== undefined && TERMINAL_STATUSES[payload.status] === true) return payload;
    if (Date.now() >= deadline) {
      throw new Error(`MinerU 解析未在预算内完成（status=${payload?.status ?? "未知"}）`);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, RESULT_POLL_INTERVAL_MS);
    await promise;
  }
};

/**
 * The docvortex block types that carry text a contract audit can read. Every
 * other type (image, header, footer, page number, formula, seal) is prose-
 * free structure: keeping it would either drop an empty block into the
 * reading order or transcribe a logo as contract language.
 */
const TEXTUAL_BLOCK_TYPES: Record<string, true> = {
  text: true,
  title: true,
  table: true,
  list: true,
};

interface ContentItem {
  type?: string;
  content?: unknown;
}

interface DocvortexBlock {
  type?: string;
  index?: number;
  content?: unknown;
}

interface DocvortexPage {
  page_idx?: number;
  blocks?: DocvortexBlock[];
}

interface StructuredContent {
  pages?: DocvortexPage[];
}

interface ParsedFile {
  file_id?: string;
  name?: string;
  status?: string;
  error?: unknown;
  content?: unknown;
}

interface TaskResult {
  task_id?: string;
  status?: string;
  files?: ParsedFile[];
  detail?: unknown;
  message?: unknown;
}

interface HealthFeatures {
  output_formats?: string[];
}

interface HealthBody {
  status?: string;
  version?: string;
  features?: HealthFeatures;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A provider's error payload as one sentence, never `[object Object]`. */
const errorText = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "object" && value !== null) {
    if ("message" in value) {
      const message = (value as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
    if ("code" in value) {
      const code = (value as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
  }
  return null;
};

/**
 * The text one block carries. `content` is an array of `{ type, content }`
 * items for text blocks, a single `{ type: "table", html }` object for tables,
 * and absent for everything this port ignores.
 */
const blockText = (block: DocvortexBlock): string => {
  const items: ContentItem[] = Array.isArray(block.content) ? block.content : [];
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item.content === "string" && item.content.trim().length > 0) {
      parts.push(item.content);
      continue;
    }
    // A table renders as HTML; the audit reads its cells as prose, so the
    // tags are stripped and the cells are joined the way a reader scans them.
    if (typeof item.content === "object" && item.content !== null && "html" in item.content) {
      const html = (item.content as { html?: unknown }).html;
      if (typeof html === "string")
        parts.push(
          html
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        );
    }
  }
  return parts.join("\n").trim();
};

/** Reading order across one page's blocks; the parser's `index` is the order. */
const pageBlocks = (page: DocvortexPage): DocvortexBlock[] => page.blocks ?? [];

/**
 * Flattens structured content into the port's block model. A page with no
 * textual blocks still counts as read — a blank scanned page is legitimately
 * empty, and calling it degraded would mark every contract's cover page as a
 * failure.
 */
const toBlocks = (content: StructuredContent): { blocks: OcrBlock[]; pagesRead: number } => {
  const pages = content.pages ?? [];
  const blocks: OcrBlock[] = [];
  for (const page of pages) {
    const pageNumber = (page.page_idx ?? 0) + 1;
    const ordered = pageBlocks(page)
      .map((block, position) => ({ block, index: block.index ?? position }))
      .sort((left, right) => left.index - right.index);
    for (const { block, index } of ordered) {
      if (block.type === undefined || TEXTUAL_BLOCK_TYPES[block.type] !== true) continue;
      const text = blockText(block);
      if (text.length === 0) continue;
      blocks.push({ page: pageNumber, index, text });
    }
  }
  return { blocks, pagesRead: pages.length };
};

/**
 * The block geometry from whichever key the server chose to serve it under.
 * `structured_content` and `middle_json` are both docvortex v2 layouts; the
 * first one present wins, and `markdown` is not parsed (prose without page
 * anchors cannot become `OcrBlock`).
 */
const blockGeometryOf = (content: unknown): StructuredContent | null => {
  if (typeof content !== "object" || content === null) return null;
  const served = content as Record<string, unknown>;
  for (const key of CONTENT_KEYS) {
    const value = served[key];
    if (typeof value === "object" && value !== null) return value as StructuredContent;
  }
  return null;
};

export interface MineruOcrOptions {
  /** Quality tier; `basic` needs no VLM weights, so it is the safe default. */
  tier?: string;
  /** `auto` reads the text layer when there is one; `ocr` always recognizes. */
  ocrMode?: "auto" | "ocr";
  /** Hard cap on pages, sent as `page_range=1-N` so the server does the cut. */
  maxPages?: number;
  /** Wall-clock budget for one parse, in milliseconds. */
  requestTimeoutMs?: number;
  /**
   * How long a not-yet-terminal task's result is polled for. Defaults to the
   * configured timeout; overridable so a test can bound the loop.
   */
  resultBudgetMs?: number;
}

/** The query string: one `output_formats` entry per requested format. */
const parseQuery = (options: MineruOcrOptions): string => {
  const params = new URLSearchParams({
    tier: options.tier ?? "basic",
    ocr_mode: options.ocrMode ?? "ocr",
    wait_timeout: String(WAIT_TIMEOUT),
  });
  // One `output_formats` entry per format: a comma-joined value is parsed as a
  // single unknown format and rejected with 400.
  for (const format of OUTPUT_FORMATS) params.append("output_formats", format);
  // A capped parse tells the server where to stop rather than recognizing a
  // 500-page scan and discarding all but the configured number of pages.
  if (options.maxPages !== undefined && options.maxPages > 0) {
    params.set("page_range", `1-${Math.floor(options.maxPages)}`);
  }
  return params.toString();
};

export function createMineruOcrPort(endpoint: string, options: MineruOcrOptions = {}): OcrPort {
  const root = endpoint.replace(/\/+$/u, "");
  const configured = root.length > 0;

  const parseUrl = `${root}/v1/file_parse?${parseQuery(options)}`;
  // The server's own wait budget plus a margin for the response transfer; the
  // configured timeout is the operator's ceiling when it is larger.
  const timeoutMs = Math.max(WAIT_TIMEOUT * 1000 + 30_000, options.requestTimeoutMs ?? 0);
  // Polling a not-yet-terminal task uses the same ceiling, so a deployment
  // that allows a long parse is not cut off by a hardcoded constant.
  const resultBudgetMs = options.resultBudgetMs ?? timeoutMs;

  return {
    provider: "mineru",
    target: configured ? root : "未配置",
    enabled: configured,

    async probe(): Promise<OcrProbe> {
      if (!configured) {
        return { ok: false, detail: "未配置 MinerU 接口地址（OCR 设置 → MinerU）" };
      }
      try {
        const response = await fetch(`${root}/v1/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        // A 503 means the server answered but its models failed to preload:
        // the recognizer is not usable, and saying "连接成功" would be a lie.
        if (!response.ok) {
          return { ok: false, detail: `MinerU /v1/health 返回 ${response.status}` };
        }
        const body = (await response.json()) as HealthBody;
        const formats = body.features?.output_formats ?? [];
        // An endpoint that does not advertise a format cannot produce it.
        const missing = OUTPUT_FORMATS.filter(
          (format) => formats.length > 0 && !formats.includes(format),
        );
        if (missing.length > 0) {
          return { ok: false, detail: `MinerU 未提供所需产物：${missing.join(", ")}` };
        }
        return { ok: true, detail: null };
      } catch (error) {
        return { ok: false, detail: describeError(error) };
      }
    },

    async recognizePdf(data: Uint8Array): Promise<OcrResult> {
      if (!configured) throw new Error("未配置 MinerU 接口地址");
      const form = new FormData();
      // The form carries the file and nothing else: a second field is a 400.
      form.append(
        "files",
        new Blob([new Uint8Array(data)], { type: "application/pdf" }),
        "contract.pdf",
      );

      const response = await fetch(parseUrl, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let payload = (await response.json().catch(() => null)) as TaskResult | null;
      // 409 (terminal failed/canceled) and 202 (still running) are not
      // transport errors; both carry the payload that explains the state.
      if (response.status !== 200 && response.status !== 202 && response.status !== 409) {
        throw new Error(
          errorText(payload?.detail) ??
            errorText(payload?.message) ??
            `MinerU 返回 HTTP ${response.status}`,
        );
      }
      if (payload?.status === undefined) {
        throw new Error(
          errorText(payload?.detail) ??
            errorText(payload?.message) ??
            "MinerU 返回了无法识别的响应",
        );
      }
      // A 202 means the task is not terminal yet. Its result lives on
      // `/v1/tasks/{task_id}/result`, which serves it once the job settles;
      // polling it is the documented way to finish a parse the wait budget
      // could not. A still-running answer after that is a real gap, never a
      // silent empty document.
      if (TERMINAL_STATUSES[payload.status] !== true) {
        if (payload.task_id === undefined) {
          throw new Error(`MinerU 解析未在 ${WAIT_TIMEOUT} 秒内完成（status=${payload.status}）`);
        }
        const settled = await pollResult(root, payload.task_id, resultBudgetMs);
        payload = settled;
      }
      if (payload.status === "failed" || payload.status === "canceled") {
        const reason = errorText(payload.files?.[0]?.error) ?? errorText(payload.detail);
        throw new Error(
          `MinerU 解析${payload.status === "canceled" ? "已取消" : "失败"}：${reason ?? "未知原因"}`,
        );
      }

      const files = payload.files ?? [];
      const blocks: OcrBlock[] = [];
      const degradedPages: number[] = [];
      let pagesRead = 0;

      for (const file of files) {
        if (file.status === "failed" || file.status === "canceled") {
          throw new Error(
            `MinerU 解析失败：${errorText(file.error) ?? file.name ?? file.file_id ?? "未知文件"}`,
          );
        }
        const content = blockGeometryOf(file.content);
        if (!content) {
          // No usable block geometry: the server served only markdown, or the
          // parse produced nothing readable. Both are gaps, not silence.
          degradedPages.push(1);
          continue;
        }
        const flattened = toBlocks(content);
        blocks.push(...flattened.blocks);
        pagesRead += flattened.pagesRead;
        // `partial` means some pages of this file were recognized and some
        // were not; the block model cannot say which, so the whole file is
        // reported as degraded rather than silently presented as complete.
        if (file.status === "partial") degradedPages.push(1);
      }

      return {
        blocks,
        pagesRead,
        // The parser does not report the source page count in this response;
        // pagesRead is the only honest number available here.
        pageCount: pagesRead,
        engine: `mineru:${root}`,
        degradedPages,
      };
    },
  };
}
