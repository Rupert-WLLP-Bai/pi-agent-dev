import type { OcrPort, OcrProbe, OcrResult } from "./types";

/**
 * Reserved slot for MinerU, the recognizer intended for non-macOS deployments.
 *
 * TODO: implement the MinerU HTTP client. It is deliberately a stub rather
 * than a guess: MinerU returns layout-aware Markdown with its own block model,
 * and mapping that onto `OcrBlock` without a reachable instance to test
 * against would be an untested contract. The demo host recognizes through the
 * `vlm` provider instead; this slot exists so switching hosts is a
 * configuration change rather than a redesign.
 */
export function createMineruOcrPort(endpoint: string): OcrPort {
  return {
    provider: "mineru",
    target: endpoint === "" ? "未配置" : endpoint,
    enabled: false,

    async probe(): Promise<OcrProbe> {
      return { ok: false, detail: "MinerU 适配尚未实现，当前请使用视觉模型（OCR_PROVIDER=vlm）" };
    },

    async recognizePdf(): Promise<OcrResult> {
      throw new Error("MinerU 适配尚未实现");
    },
  };
}
