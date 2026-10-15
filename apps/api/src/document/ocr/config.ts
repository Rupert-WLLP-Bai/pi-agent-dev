import type { OcrProviderName } from "../../db/schema";

/**
 * The OCR wiring as the environment describes it.
 *
 * This is the bootstrap only. Once an operator has saved OCR settings, the
 * stored row is the configuration in force and this module is never consulted
 * again — see `ocr-settings-repository.ts`.
 */
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

/** The `OCR_*` defaults a saved row falls back to before any field is set. */
export const OCR_CONFIG_DEFAULTS: OcrConfig = loadOcrConfig({});
