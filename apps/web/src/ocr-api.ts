import { ApiRequestError, api } from "./api";

/**
 * Scanned-contract recognition settings.
 *
 * The raw key never leaves the server: the client only ever sees
 * `vlmApiKeyConfigured` and the masked `vlmApiKeyHint`, so a key cannot be
 * rendered even by mistake — the same contract the model-service page holds to.
 */

export type OcrProvider = "off" | "vlm" | "mineru";

/** The OCR configuration as `GET /api/ocr-settings` returns it. */
export interface OcrSettings {
  provider: OcrProvider;
  vlmEndpoint: string;
  vlmApiKeyConfigured: boolean;
  vlmApiKeyHint: string | null;
  vlmModel: string;
  vlmFallbackModel: string | null;
  mineruEndpoint: string;
  maxPages: number;
  scale: number;
  jpegQuality: number;
  concurrency: number;
  requestTimeoutMs: number;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  updatedAt: string;
  /** `env` while no settings row has been saved; `stored` once one has. */
  source: "stored" | "env";
}

/** The save payload; an omitted or empty `vlmApiKey` keeps the stored key. */
export interface OcrSettingsUpdateInput {
  provider?: OcrProvider;
  vlmEndpoint?: string;
  vlmApiKey?: string;
  vlmModel?: string;
  vlmFallbackModel?: string | null;
  mineruEndpoint?: string;
  maxPages?: number;
  scale?: number;
  jpegQuality?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
}

/** The outcome of a live connectivity probe. */
export interface OcrSettingsTestResult {
  ok: boolean;
  error: string | null;
  latencyMs: number;
}

/** The probe body without a recorded check — used for instant readiness. */
export interface OcrProbeResult {
  ok: boolean;
  detail: string | null;
}

/** Picks the server's Chinese reason out of an Eden error body. */
function serverReason(error: { value: unknown }, fallback: string): string {
  const value = error.value;
  if (typeof value === "object" && value !== null && "error" in value) {
    const detail = (value as { error?: unknown }).error;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return fallback;
}

export async function getOcrSettings(): Promise<OcrSettings> {
  const { data, error } = await api.api["ocr-settings"].get();
  if (error)
    throw new ApiRequestError(serverReason(error, "读取 OCR 设置失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("读取 OCR 设置失败", 500);
  return data;
}

export async function saveOcrSettings(input: OcrSettingsUpdateInput): Promise<OcrSettings> {
  const { data, error } = await api.api["ocr-settings"].patch(input);
  if (error)
    throw new ApiRequestError(serverReason(error, "保存 OCR 设置失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("保存 OCR 设置失败", 500);
  return data;
}

/** Probes the configuration in force and records the outcome on the row. */
export async function testOcrSettings(): Promise<OcrSettingsTestResult> {
  const { data, error } = await api.api["ocr-settings"].test.post();
  if (error)
    throw new ApiRequestError(serverReason(error, "测试 OCR 连通性失败"), Number(error.status));
  if (!data || !("ok" in data)) throw new ApiRequestError("测试 OCR 连通性失败", 500);
  return data;
}

/** The same probe without recording, for refreshing readiness on a provider switch. */
export async function probeOcrSettings(): Promise<OcrProbeResult> {
  const { data, error } = await api.api["ocr-settings"].probe.get();
  if (error)
    throw new ApiRequestError(serverReason(error, "探测 OCR 就绪状态失败"), Number(error.status));
  if (!data || !("ok" in data)) throw new ApiRequestError("探测 OCR 就绪状态失败", 500);
  return data;
}

/** One model a vision endpoint advertises, with the limits it reports. */
export interface VisionModel {
  id: string;
  maxInput: number | null;
  maxOutput: number | null;
}

/**
 * The vision models an endpoint advertises, fetched from a draft — before the
 * settings row exists. The key is optional: a deployment that requires none
 * still gets its catalog, and an explicit empty key means unauthenticated.
 */
export async function fetchVisionModels(input: {
  endpoint: string;
  apiKey?: string;
}): Promise<VisionModel[]> {
  const response = await fetch("/api/llm-providers/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const reason =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error ?? "")
        : "";
    throw new ApiRequestError(
      reason || `获取模型列表失败（HTTP ${response.status}）`,
      response.status,
    );
  }
  const body = (await response.json()) as { models?: unknown };
  if (!Array.isArray(body.models)) return [];
  return body.models.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ id: entry, maxInput: null, maxOutput: null }];
    }
    if (typeof entry === "object" && entry !== null && "id" in entry) {
      const record = entry as { id?: unknown; maxInput?: unknown; maxOutput?: unknown };
      if (typeof record.id !== "string") return [];
      return [
        {
          id: record.id,
          maxInput: typeof record.maxInput === "number" ? record.maxInput : null,
          maxOutput: typeof record.maxOutput === "number" ? record.maxOutput : null,
        },
      ];
    }
    return [];
  });
}
