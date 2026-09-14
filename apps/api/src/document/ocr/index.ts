import { createMineruOcrPort } from "./mineru";
import type { OcrPort, OcrProbe, OcrResult } from "./types";
import { createVlmOcrPort } from "./vlm";

export { createMineruOcrPort } from "./mineru";
export type { OcrBlock, OcrPort, OcrProbe, OcrResult } from "./types";
export { createVlmOcrPort } from "./vlm";

export type OcrProviderName = "vlm" | "mineru" | "off";

export interface OcrConfig {
  provider: OcrProviderName;
  endpoint: string;
  apiKey: string;
  model: string;
  fallbackModel: string | null;
  maxPages: number;
  scale: number;
  jpegQuality: number;
  concurrency: number;
  requestTimeoutMs: number;
  mineruEndpoint: string;
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const positiveNumber = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Reads the OCR wiring from the environment. The provider defaults to `off`
 * rather than `vlm`: recognition sends contract page images to a model
 * endpoint, and that must be an explicit decision, never a side effect of
 * leaving a variable unset.
 */
export function loadOcrConfig(env: Record<string, string | undefined> = process.env): OcrConfig {
  const endpoint = env.OCR_VLM_ENDPOINT?.trim() ?? "";
  const declared = env.OCR_PROVIDER?.trim().toLowerCase();
  const provider: OcrProviderName =
    declared === "vlm" || declared === "mineru" || declared === "off"
      ? declared
      : endpoint.length > 0
        ? "vlm"
        : "off";

  const fallback = env.OCR_VLM_FALLBACK_MODEL?.trim() ?? "";

  return {
    provider,
    endpoint,
    apiKey: env.OCR_VLM_API_KEY?.trim() ?? "",
    model: env.OCR_VLM_MODEL?.trim() ?? "",
    fallbackModel: fallback.length > 0 ? fallback : null,
    maxPages: positiveInt(env.OCR_MAX_PAGES, 40),
    scale: positiveNumber(env.OCR_SCALE, 2),
    jpegQuality: positiveInt(env.OCR_JPEG_QUALITY, 85),
    concurrency: positiveInt(env.OCR_CONCURRENCY, 3),
    requestTimeoutMs: positiveInt(env.OCR_TIMEOUT_MS, 120_000),
    mineruEndpoint: env.MINERU_ENDPOINT?.trim() ?? "",
  };
}

/** The no-op recognizer: scanned contracts stay unreadable, and say so. */
function createDisabledOcrPort(detail: string): OcrPort {
  return {
    provider: "off",
    target: "未配置",
    enabled: false,
    async probe(): Promise<OcrProbe> {
      return { ok: false, detail };
    },
    async recognizePdf(): Promise<OcrResult> {
      return {
        blocks: [],
        pagesRead: 0,
        pageCount: 0,
        engine: "off",
        degradedPages: [],
      };
    },
  };
}

/** Builds the configured recognizer. Never throws — a misconfigured OCR is `off`. */
export function createOcrPort(config: OcrConfig = loadOcrConfig()): OcrPort {
  if (config.provider === "mineru") return createMineruOcrPort(config.mineruEndpoint);
  if (config.provider === "off") {
    return createDisabledOcrPort("未设置 OCR_VLM_ENDPOINT，扫描件合同无法识别");
  }
  if (config.endpoint === "" || config.model === "") {
    return createDisabledOcrPort("OCR_PROVIDER=vlm 但缺少 OCR_VLM_ENDPOINT 或 OCR_VLM_MODEL");
  }
  return createVlmOcrPort({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
    fallbackModel: config.fallbackModel,
    maxPages: config.maxPages,
    scale: config.scale,
    jpegQuality: config.jpegQuality,
    concurrency: config.concurrency,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}
