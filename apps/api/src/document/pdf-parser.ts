import type { RawBlock } from "@contract-audit/audit/document-ir";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** A glyph run with the position pdfjs reports for it. */
interface Piece {
  text: string;
  x: number;
  y: number;
  height: number;
}

interface Line {
  text: string;
  y: number;
  height: number;
}

const SECTION_HEADING = /^第[一二三四五六七八九十百千零0-9]+[条章节]/u;
const ASCII_EDGE = /[A-Za-z0-9]$/u;

/**
 * Joins one line's glyph runs. CJK extraction emits a run per character or per
 * cluster, so a space is inserted only where a real gap separates two latin
 * runs — otherwise every Chinese character would arrive space-separated.
 */
function joinPieces(pieces: Piece[]): string {
  let text = "";
  let previous: Piece | null = null;
  for (const piece of pieces) {
    if (previous !== null) {
      const gap = piece.x - (previous.x + previous.height * Math.max(previous.text.length, 1) * 0.5);
      const wide = gap > previous.height * 0.3;
      if (wide && ASCII_EDGE.test(previous.text) && /^[A-Za-z0-9]/u.test(piece.text)) {
        text += " ";
      }
    }
    text += piece.text;
    previous = piece;
  }
  return text.replace(/\s+/gu, " ").trim();
}

/** Groups positioned runs into reading-order lines, top to bottom. */
function toLines(pieces: Piece[]): Line[] {
  const groups = new Map<number, Piece[]>();
  for (const piece of pieces) {
    const bucket = Math.round(piece.y / 2) * 2;
    const existing = groups.get(bucket);
    if (existing === undefined) groups.set(bucket, [piece]);
    else existing.push(piece);
  }

  return [...groups.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, group]) => {
      const ordered = [...group].sort((left, right) => left.x - right.x);
      const height = Math.max(...ordered.map((piece) => piece.height), 1);
      return { text: joinPieces(ordered), y: ordered[0].y, height };
    })
    .filter((line) => line.text.length > 0);
}

/**
 * A line starts a new block when it is a section heading, or when the vertical
 * gap to the previous line is larger than the document's own line spacing.
 */
function toBlocks(lines: Line[], page: number): RawBlock[] {
  const gaps: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index - 1].y - lines[index].y;
    if (gap > 0) gaps.push(gap);
  }
  const sorted = [...gaps].sort((left, right) => left - right);
  const typical = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
  const breakThreshold = typical === 0 ? Number.POSITIVE_INFINITY : typical * 1.6;

  const blocks: RawBlock[] = [];
  let buffer: string[] = [];
  let previous: Line | null = null;

  const flush = (): void => {
    if (buffer.length === 0) return;
    blocks.push({ text: buffer.join("\n"), kind: "paragraph", page });
    buffer = [];
  };

  // A gap far beyond any leading (2.5× the font height) is a paragraph break
  // by construction, even when the median-gap estimate is skewed by a
  // line-sparse page (the median of [20, 80] is 80, which would otherwise
  // swallow the one real paragraph gap on the page).
  const paragraphGapFloor = (previous: Line): number => previous.height * 2.5;

  for (const line of lines) {
    const gap = previous === null ? 0 : previous.y - line.y;
    if (previous !== null && (gap > breakThreshold || gap > paragraphGapFloor(previous))) flush();

    if (SECTION_HEADING.test(line.text) || line.text.length <= 20 && /合同书?$/u.test(line.text)) {
      flush();
      blocks.push({ text: line.text, kind: "heading", page });
      previous = line;
      continue;
    }

    buffer.push(line.text);
    previous = line;
  }
  flush();

  return blocks;
}

/** Reads a .pdf into raw blocks, page by page. */
export async function parsePdf(data: Uint8Array): Promise<RawBlock[]> {
  const task = getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  const blocks: RawBlock[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pieces: Piece[] = [];

      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        pieces.push({
          text: item.str,
          x: item.transform[4] as number,
          y: item.transform[5] as number,
          height: Math.abs(item.transform[3] as number) || item.height || 10,
        });
      }

      blocks.push(...toBlocks(toLines(pieces), pageNumber));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return blocks;
}
