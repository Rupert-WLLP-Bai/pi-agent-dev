import { Elysia, t } from "elysia";
import { createOcrPort, loadOcrConfig } from "../document/ocr";
import {
  type OcrSettings,
  OcrSettingsRepositoryError,
  type OcrSettingsStore,
  type OcrSettingsUpdate,
} from "../document/ocr/ocr-settings-repository";
import { errorSchema, openapiTags } from "../openapi";

export interface OcrSettingsRouteDeps {
  settings: OcrSettingsStore;
  /**
   * Runs after every successful save so the live recognizer re-reads the
   * stored row. The port itself is not rebuilt — see `createLiveOcrPort` — but
   * the hook is where a registry would refresh, mirroring
   * `llmProvidersRoutes({ onChanged })`.
   */
  onChanged?: () => Promise<void>;
}

const TAG = [openapiTags.llmProviders];

const providerSchema = t.Union([t.Literal("off"), t.Literal("vlm"), t.Literal("mineru")]);

const settingsSchema = t.Object({
  provider: providerSchema,
  vlmEndpoint: t.String(),
  vlmApiKeyConfigured: t.Boolean(),
  vlmApiKeyHint: t.Union([t.String(), t.Null()]),
  vlmModel: t.String(),
  vlmFallbackModel: t.Union([t.String(), t.Null()]),
  mineruEndpoint: t.String(),
  maxPages: t.Number(),
  scale: t.Number(),
  jpegQuality: t.Number(),
  concurrency: t.Number(),
  requestTimeoutMs: t.Number(),
  lastCheckedAt: t.Union([t.String(), t.Null()]),
  lastCheckOk: t.Union([t.Boolean(), t.Null()]),
  lastCheckError: t.Union([t.String(), t.Null()]),
  updatedAt: t.String(),
  source: t.Union([t.Literal("stored"), t.Literal("env")]),
});

const updateBody = t.Object({
  provider: t.Optional(providerSchema),
  vlmEndpoint: t.Optional(t.String()),
  /** Absent or empty keeps the stored key — an edit never blanks a credential. */
  vlmApiKey: t.Optional(t.String()),
  vlmModel: t.Optional(t.String()),
  vlmFallbackModel: t.Optional(t.Union([t.String(), t.Null()])),
  mineruEndpoint: t.Optional(t.String()),
  maxPages: t.Optional(t.Number()),
  scale: t.Optional(t.Number()),
  jpegQuality: t.Optional(t.Number()),
  concurrency: t.Optional(t.Number()),
  requestTimeoutMs: t.Optional(t.Number()),
});

const testResultSchema = t.Object({
  ok: t.Boolean(),
  error: t.Union([t.String(), t.Null()]),
  latencyMs: t.Number(),
});

/**
 * The configuration the environment still describes, projected through the
 * settings DTO so a fresh deployment renders the same shape as a saved one.
 * `source: "env"` is the honest label: nothing is persisted yet, so the next
 * save is what makes these values survive a restart.
 */
async function envSettings(): Promise<OcrSettings> {
  const config = loadOcrConfig();
  return {
    provider: config.provider,
    vlmEndpoint: config.endpoint,
    vlmApiKeyConfigured: config.apiKey.length > 0,
    // The mask is computed from the value; the value itself is never returned.
    vlmApiKeyHint: config.apiKey.length > 0 ? `…${config.apiKey.slice(-4)}` : null,
    vlmModel: config.model,
    vlmFallbackModel: config.fallbackModel,
    mineruEndpoint: config.mineruEndpoint,
    maxPages: config.maxPages,
    scale: config.scale,
    jpegQuality: config.jpegQuality,
    concurrency: config.concurrency,
    requestTimeoutMs: config.requestTimeoutMs,
    lastCheckedAt: null,
    lastCheckOk: null,
    lastCheckError: null,
    updatedAt: new Date(0).toISOString(),
    source: "env",
  };
}

/**
 * Runtime OCR configuration: read, save, and probe. Saving writes the single
 * settings row and refreshes the live recognizer, so the next parse — not the
 * next restart — uses what the operator chose.
 *
 * `GET` never fabricates a row: with nothing saved it reports the environment
 * configuration with `source: "env"`, which is what a fresh deployment actually
 * runs under. Keys are reported as presence plus a masked hint only.
 */
export function ocrSettingsRoutes({ settings, onChanged }: OcrSettingsRouteDeps) {
  return new Elysia()
    .get("/api/ocr-settings", async () => (await settings.get()) ?? (await envSettings()), {
      response: { 200: settingsSchema },
      detail: {
        summary: "读取 OCR 设置",
        description:
          "返回当前生效的 OCR 配置。未保存过设置时返回 OCR_* 环境变量描述且 source=env；保存后 source=stored。" +
          "响应不含原始密钥，只报告是否已配置与末四位掩码。",
        tags: TAG,
      },
    })
    .patch(
      "/api/ocr-settings",
      async ({ body, set }) => {
        try {
          const saved = await settings.save(body satisfies OcrSettingsUpdate);
          await onChanged?.();
          return saved;
        } catch (error) {
          if (error instanceof OcrSettingsRepositoryError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        body: updateBody,
        response: { 200: settingsSchema, 400: errorSchema },
        detail: {
          summary: "保存 OCR 设置",
          description:
            "保存 OCR 配置（提供方、接口地址、密钥、模型、页数与并发等）。vlmApiKey 省略或为空时保留已存储密钥；" +
            "保存后下一次 PDF 解析即使用新配置，无需重启。MinerU 适配器按已验证的官方 HTTP 契约实现，" +
            "未连接可用实例时探测如实报告未就绪。",
          tags: TAG,
        },
      },
    )
    .post(
      "/api/ocr-settings/test",
      async () => {
        // The probe runs against the configuration that will actually be used:
        // the stored row when one exists, otherwise the environment bootstrap.
        const config = (await settings.rawConfig()) ?? loadOcrConfig();
        const port = createOcrPort(config);
        const startedAt = Date.now();
        const probe = await port.probe();
        const latencyMs = Date.now() - startedAt;
        // Only a stored row has somewhere to record the outcome; the
        // environment path stays untouched.
        await settings.recordCheck(probe.ok, probe.detail);
        return { ok: probe.ok, error: probe.detail, latencyMs };
      },
      {
        response: { 200: testResultSchema },
        detail: {
          summary: "测试 OCR 连通性",
          description:
            "按当前生效配置请求识别端点（视觉模型读 {endpoint}/models，MinerU 读 {endpoint}/v1/health），" +
            "并记录最近一次检查结果。上游失败返回 ok:false 而非 5xx。",
          tags: TAG,
        },
      },
    )
    .get(
      "/api/ocr-settings/probe",
      async () => {
        const config = (await settings.rawConfig()) ?? loadOcrConfig();
        const port = createOcrPort(config);
        return port.probe();
      },
      {
        response: { 200: t.Object({ ok: t.Boolean(), detail: t.Union([t.String(), t.Null()]) }) },
        detail: {
          summary: "轻量 OCR 就绪探测",
          description:
            "与 /api/ocr-settings/test 相同的探测，但不写入最近检查结果——供设置页在切换提供方时即时刷新就绪状态。",
          tags: TAG,
        },
      },
    );
}
