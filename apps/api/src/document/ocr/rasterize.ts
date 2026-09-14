import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface RasterPage {
  page: number;
  /** JPEG bytes; vision endpoints accept it directly and it is ~4× smaller than PNG. */
  jpeg: Buffer;
}

export interface RasterizeOptions {
  /** Render scale. Below 2× the strokes of 10.5pt CJK glyphs merge. */
  scale: number;
  /** Hard cap on pages, so a 500-page scan cannot stall an audit run. */
  maxPages: number;
  quality: number;
}

export interface RasterizeResult {
  pages: RasterPage[];
  pageCount: number;
}

/**
 * Renders each PDF page to a JPEG. Scanned contracts carry no text layer, so
 * the page must become an image before any recognizer can read it.
 *
 * The bytes are copied because pdfjs transfers the buffer it is handed; the
 * caller keeps a usable view of its own data.
 */
export async function rasterizePdf(
  data: Uint8Array,
  options: RasterizeOptions,
): Promise<RasterizeResult> {
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true });
  const pdf = await task.promise;
  const pages: RasterPage[] = [];

  try {
    const limit = Math.min(options.maxPages, pdf.numPages);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: options.scale });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (width < 1 || height < 1) continue;

        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        // Scanned pages are often transparent-backed; without a white ground
        // the recognizer sees dark text on an alpha void as low contrast.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        await page.render({
          // pdfjs types describe a browser canvas; the napi surface is
          // API-compatible for the 2D operations pdfjs actually calls.
          canvasContext: context as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;

        pages.push({ page: pageNumber, jpeg: await canvas.encode("jpeg", options.quality) });
      } finally {
        page.cleanup();
      }
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
