/**
 * One recognized text block, in the reading order the provider reported it.
 *
 * `page` and `index` together form the stable location an Evidence Locator
 * anchors to. There is deliberately no bounding box: a vision model's
 * coordinates are not trustworthy, and an unreliable box is worse than no box
 * because it invites citation of a place the text never was.
 */
export interface OcrBlock {
  /** 1-based page number in the source PDF. */
  page: number;
  /** 0-based position within that page. */
  index: number;
  text: string;
}

export interface OcrResult {
  blocks: OcrBlock[];
  /** Pages actually recognized; smaller than the PDF when a page cap applied. */
  pagesRead: number;
  pageCount: number;
  /** Which provider and model produced this, recorded on the Source Record. */
  engine: string;
  /**
   * Pages the provider could not finish (output budget exhausted, or a
   * transport error). Recognition is best-effort: a partially recognized
   * contract still audits, but the gap must be visible rather than silent.
   */
  degradedPages: number[];
}

/** The disposition an integration card renders. */
export interface OcrProbe {
  ok: boolean;
  detail: string | null;
}

/**
 * A pluggable scanned-document recognizer. The macOS demo host and a future
 * Linux deployment differ only in which implementation is wired here.
 */
export interface OcrPort {
  /** Stable provider id, e.g. `vlm` or `mineru`. */
  readonly provider: string;
  /** Where it points, safe to render and log — never a credential. */
  readonly target: string;
  /** True when the provider is wired at all; false short-circuits recognition. */
  readonly enabled: boolean;
  probe(): Promise<OcrProbe>;
  recognizePdf(data: Uint8Array): Promise<OcrResult>;
}
