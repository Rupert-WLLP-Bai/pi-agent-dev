import { loadOcrConfig, type OcrConfig } from "./config";
import { createMineruOcrPort } from "./mineru";
import type { LiveOcrPort, OcrPort, OcrProbe, OcrResult } from "./types";
import { createVlmOcrPort } from "./vlm";

export type { OcrConfig } from "./config";
export { loadOcrConfig } from "./config";
export { createMineruOcrPort, type MineruOcrOptions } from "./mineru";
export {
  createMemoryOcrSettingsStore,
  createOcrSettingsRepository,
  OCR_SETTINGS_KEY,
  type OcrSettings,
  OcrSettingsRepository,
  OcrSettingsRepositoryError,
  type OcrSettingsStore,
  type OcrSettingsUpdate,
} from "./ocr-settings-repository";
export type { LiveOcrPort, OcrBlock, OcrPort, OcrProbe, OcrResult } from "./types";
export { isLiveOcrPort } from "./types";
export { createVlmOcrPort } from "./vlm";

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
  if (config.provider === "mineru") {
    return createMineruOcrPort(config.mineruEndpoint, {
      // The configured caps are the operator's, so the server applies them:
      // `page_range=1-N` bounds the parse and the timeout bounds the request.
      maxPages: config.maxPages,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  }
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

/**
 * A recognizer that resolves its configuration on every call.
 *
 * The dispatcher and the health route each hold one of these for the process's
 * lifetime, so a save cannot rebuild them. What a save *does* do is change what
 * the resolver returns: the next `probe()` or `recognizePdf()` entry builds the
 * recognizer the saved configuration describes. That is what makes "the next
 * PDF uses new settings without restarting the app" true, while `capture()`
 * freezes one configuration for the whole of a single operation, so a page
 * half-recognized under the old endpoint never flips models mid-document.
 *
 * The resolver may be async — the stored row is one database read — and the
 * port awaits it per entry. A synchronous resolver (the environment, a test)
 * works unchanged.
 */
export function createLiveOcrPort(resolve: () => OcrConfig | Promise<OcrConfig>): LiveOcrPort {
  const build = async (): Promise<OcrPort> => createOcrPort(await resolve());
  return {
    // A live port cannot answer these synchronously: the configuration is one
    // database read away. `describe()` is the async form the health route uses;
    // the synchronous getters exist only to satisfy the port contract and say
    // so rather than freezing a value that is already stale.
    get provider(): string {
      throw new Error("OCR_LIVE_PORT_IS_ASYNC");
    },
    get target(): string {
      throw new Error("OCR_LIVE_PORT_IS_ASYNC");
    },
    get enabled(): boolean {
      throw new Error("OCR_LIVE_PORT_IS_ASYNC");
    },
    probe(): Promise<OcrProbe> {
      return build().then((port) => port.probe());
    },
    recognizePdf(data: Uint8Array): Promise<OcrResult> {
      return build().then((port) => port.recognizePdf(data));
    },
    /** The recognizer one operation runs under, bound to the config right now. */
    async capture(): Promise<OcrPort> {
      return build();
    },
    async describe() {
      const port = await build();
      return { provider: port.provider, target: port.target, enabled: port.enabled };
    },
  };
}
