import { rasterizePdf } from "./rasterize";
import type { OcrBlock, OcrPort, OcrProbe, OcrResult } from "./types";

export interface VlmOcrConfig {
  /** OpenAI-compatible base URL, e.g. `http://127.0.0.1:18091/v1`. */
  endpoint: string;
  apiKey: string;
  model: string;
  /**
   * Retried with when the primary model stops on `length`. The primary is
   * chosen for speed and paragraph merging; the fallback trades latency for a
   * far larger output budget, which is what a full-page table needs.
   */
  fallbackModel: string | null;
  maxPages: number;
  scale: number;
  jpegQuality: number;
  /** Pages recognized in parallel. Each page is one request. */
  concurrency: number;
  requestTimeoutMs: number;
}

/**
 * Transcription, not interpretation: the model must not summarize, translate,
 * or comment, because every downstream rule reads these blocks as if they were
 * the contract's own words.
 */
const TRANSCRIBE_PROMPT =
  "这是一页合同扫描件。逐行转录页面上的全部文字，保持原有顺序与换行。" +
  "直接输出转录结果，不要任何前言、解释或总结。";

interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

/** Splits one page's transcription into blocks, dropping the model's blank padding. */
function toBlocks(page: number, content: string): OcrBlock[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text, index) => ({ page, index, text }));
}

/** Runs `work` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const current = next;
      next += 1;
      if (current >= items.length) return;
      results[current] = await work(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

export function createVlmOcrPort(config: VlmOcrConfig): OcrPort {
  const chatUrl = `${config.endpoint.replace(/\/+$/u, "")}/chat/completions`;

  const complete = async (
    model: string,
    jpeg: Buffer,
  ): Promise<{ content: string; finishReason: string }> => {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TRANSCRIBE_PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
              },
            ],
          },
        ],
      }),
    });

    const payload = (await response.json()) as ChatResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OCR 模型返回 ${response.status}`);
    }
    const choice = payload.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? "stop",
    };
  };

  return {
    provider: "vlm",
    target: `${config.model} @ ${config.endpoint}`,
    enabled: true,

    async probe(): Promise<OcrProbe> {
      try {
        const response = await fetch(`${config.endpoint.replace(/\/+$/u, "")}/models`, {
          headers: { authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return { ok: false, detail: `模型列表返回 ${response.status}` };
        const listed = (await response.json()) as { data?: { id?: string }[] };
        const ids = (listed.data ?? []).map((entry) => entry.id).filter(Boolean);
        if (ids.length > 0 && !ids.includes(config.model)) {
          return { ok: false, detail: `端点未提供 ${config.model}（可用：${ids.join(", ")}）` };
        }
        return { ok: true, detail: null };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },

    async recognizePdf(data: Uint8Array): Promise<OcrResult> {
      const raster = await rasterizePdf(data, {
        scale: config.scale,
        maxPages: config.maxPages,
        quality: config.jpegQuality,
      });

      const degradedPages: number[] = [];
      const perPage = await mapWithConcurrency(
        raster.pages,
        config.concurrency,
        async (rendered): Promise<OcrBlock[]> => {
          try {
            let { content, finishReason } = await complete(config.model, rendered.jpeg);
            // A page truncated by the output budget is retried on the
            // larger-budget model rather than silently handed on short.
            if (finishReason === "length" && config.fallbackModel !== null) {
              const retried = await complete(config.fallbackModel, rendered.jpeg);
              if (retried.finishReason !== "length") {
                content = retried.content;
                finishReason = retried.finishReason;
              } else {
                content = retried.content.length > content.length ? retried.content : content;
              }
            }
            if (finishReason === "length") degradedPages.push(rendered.page);
            return toBlocks(rendered.page, content);
          } catch {
            // One unreadable page must not lose the other twenty-one.
            degradedPages.push(rendered.page);
            return [];
          }
        },
      );

      return {
        blocks: perPage.flat(),
        pagesRead: raster.pages.length,
        pageCount: raster.pageCount,
        engine: `vlm:${config.model}`,
        degradedPages: [...degradedPages].sort((left, right) => left - right),
      };
    },
  };
}
