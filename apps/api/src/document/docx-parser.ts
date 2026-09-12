import mammoth from "mammoth";
import type { BlockKind, RawBlock } from "@contract-audit/audit/document-ir";

/**
 * Reads a .docx into raw blocks, preserving the structure Word actually
 * encodes: Heading styles become headings, tables stay tables, everything else
 * becomes a paragraph. Mammoth's HTML is a deliberately small subset (h1-h6, p,
 * table, ul/ol/li plus a few inline tags), so walking it directly stays
 * deterministic — no model decides where a block begins.
 */
const BLOCK_PATTERN = /<(h[1-6]|p|table|li)[^>]*>([\s\S]*?)<\/\1>/giu;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strips inline markup and decodes the entities mammoth emits. */
function toPlainText(html: string): string {
  const withoutTags = html
    .replace(/<\/?(?:strong|em|b|i|u|s|span|a|sup|sub|br)\b[^>]*>/giu, "")
    .replace(/<\/?(?:tr|td|th)\b[^>]*>/giu, " ");
  const decoded = withoutTags.replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp);/gu,
    (entity) => ENTITIES[entity] ?? entity,
  );
  return decoded.replace(/[ \t\u00a0]+/gu, " ").trim();
}

function kindForTag(tag: string): BlockKind {
  if (tag.startsWith("h")) return "heading";
  if (tag === "table") return "table";
  return "paragraph";
}

export async function parseDocx(data: Uint8Array): Promise<RawBlock[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
  const blocks: RawBlock[] = [];

  for (const match of html.matchAll(BLOCK_PATTERN)) {
    const tag = match[1].toLowerCase();
    const text = toPlainText(match[2]);
    if (text.length === 0) continue;
    blocks.push({ text, kind: kindForTag(tag), page: null });
  }

  return blocks;
}
