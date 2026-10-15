import type { ContractDocument, RawBlock } from "@contract-audit/audit/document-ir";
import { buildContractDocument } from "@contract-audit/audit/document-ir";
import { parseDocx } from "./docx-parser";
import { createOcrPort, isLiveOcrPort, type OcrPort } from "./ocr";
import { parsePdf } from "./pdf-parser";
import { type ParsedSpreadsheet, parseXlsx } from "./xlsx-parser";

export class UnsupportedContractFormatError extends Error {
  constructor(filename: string) {
    super(`不支持的合同格式：${filename}（仅支持 .docx、.pdf、.xlsx、.txt）`);
    this.name = "UnsupportedContractFormatError";
  }
}

/** The format is readable but nothing was extracted — an empty document. */
export class EmptyContractError extends Error {
  constructor(filename: string) {
    super(`合同文件内容为空：${filename}`);
    this.name = "EmptyContractError";
  }
}

/**
 * A PDF with no text layer that OCR could not read either. Distinct from
 * `EmptyContractError` because the remedy is different: the file is not empty,
 * the recognizer is off or failed.
 */
export class ScannedPdfNotRecognizedError extends Error {
  /**
   * Which recognizer the parse actually reached, in the form the operator
   * needs to act on: provider id, target, and whether it was enabled. A
   * recognizer that was *disabled* is a configuration question, and naming the
   * provider and target answers it without a log dive. Never carries a key.
   */
  readonly recognizer: { provider: string; target: string; enabled: boolean };

  constructor(
    filename: string,
    detail: string,
    recognizer: { provider: string; target: string; enabled: boolean },
  ) {
    super(`扫描件合同无法识别：${filename}（${detail}）`);
    this.name = "ScannedPdfNotRecognizedError";
    this.recognizer = recognizer;
  }
}

/** How a scanned PDF was recognized, recorded so the audit trail can cite it. */
export interface OcrProvenance {
  engine: string;
  pagesRead: number;
  pageCount: number;
  /** Pages the recognizer could not finish; their content is missing. */
  degradedPages: number[];
}

export interface ParsedContract {
  document: ContractDocument;
  /** Canonical text — what the parser read, joined into one auditable body. */
  text: string;
  /** Present only when the blocks came from OCR rather than a text layer. */
  ocr?: OcrProvenance;
  /**
   * Present only for a spreadsheet. The blocks flatten it to prose so it
   * travels the same IR; this keeps the cell addresses a cross-document amount
   * check has to cite.
   */
  spreadsheet?: ParsedSpreadsheet;
}

const extensionOf = (filename: string): string => {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
};

/**
 * The MIME types each supported extension may legitimately carry. A file
 * whose declared type is not listed for its extension is a mismatch — the
 * bytes would not be what the parser was chosen for. `.md` shares the plain
 * text path, so it accepts either markdown or the generic text type.
 */
const ALLOWED_MIME: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
};

/**
 * Checks that a filename's extension picks one of the parsers this module has.
 * Returns `true`, or a stable error code the caller maps to a 422 response.
 */
export function validateExtension(filename: string): true | string {
  return ALLOWED_MIME[extensionOf(filename)] === undefined ? "unsupported_file_type" : true;
}

/**
 * Checks an upload's declared MIME type against the whitelist for its
 * extension. Returns `true` when the pair is acceptable, otherwise a stable
 * error code the caller maps to a 422 response.
 */
export function validateMimeType(filename: string, mimeType: string): true | string {
  const allowed = ALLOWED_MIME[extensionOf(filename)];
  if (allowed === undefined) return "unsupported_file_type";
  if (!allowed.includes(mimeType)) return "mime_mismatch";
  return true;
}

/**
 * The recognizer used when a caller does not inject one.
 *
 * There is deliberately no cached default: a module-level singleton would freeze
 * one configuration for the process's lifetime, and an OCR settings save must
 * change what the *next* parse uses. Callers that need a stable port for the
 * app's lifetime — the health route and the dispatcher — receive the live port
 * the composition builds (`createLiveOcrPort`), which resolves its
 * configuration per operation instead.
 */
const defaultOcrPort = (): OcrPort => createOcrPort();

/**
 * Turns an uploaded contract into the Contract Document IR. Format dispatch is
 * by extension; every branch converges on the same IR builder, so downstream
 * rules cannot tell a docx from a pasted text — or from a scanned page that
 * only OCR could read.
 */
export async function parseContractFile(
  input: {
    filename: string;
    data: Uint8Array;
  },
  ocr: OcrPort = defaultOcrPort(),
): Promise<ParsedContract> {
  const extension = extensionOf(input.filename);
  let rawBlocks: RawBlock[];
  let provenance: OcrProvenance | undefined;
  let spreadsheet: ParsedSpreadsheet | undefined;

  if (extension === ".docx") {
    rawBlocks = await parseDocx(input.data);
  } else if (extension === ".xlsx") {
    const parsed = await parseXlsx(input.data);
    rawBlocks = parsed.blocks;
    spreadsheet = parsed.spreadsheet;
  } else if (extension === ".pdf") {
    rawBlocks = await parsePdf(input.data);
    // Signed contracts arrive as scans with no text layer at all. Zero blocks
    // from a PDF is the signal to recognize it, not to reject it.
    if (rawBlocks.length === 0) {
      // A live port's sync getters throw by design (its configuration is one
      // database read away), so resolve the frozen port for this parse first.
      const port = isLiveOcrPort(ocr) ? await ocr.capture() : ocr;
      if (!port.enabled) {
        const probe = await port.probe();
        throw new ScannedPdfNotRecognizedError(
          input.filename,
          probe.detail ?? "未配置 OCR 提供方",
          {
            provider: port.provider,
            target: port.target,
            enabled: port.enabled,
          },
        );
      }
      const recognized = await port.recognizePdf(input.data);
      rawBlocks = recognized.blocks.map((block) => ({
        text: block.text,
        kind: "paragraph" as const,
        page: block.page,
      }));
      provenance = {
        engine: recognized.engine,
        pagesRead: recognized.pagesRead,
        pageCount: recognized.pageCount,
        degradedPages: recognized.degradedPages,
      };
      if (rawBlocks.length === 0) {
        throw new ScannedPdfNotRecognizedError(input.filename, `${port.provider} 未返回任何文字`, {
          provider: port.provider,
          target: port.target,
          enabled: port.enabled,
        });
      }
    }
  } else if (extension === ".txt" || extension === ".md") {
    const text = new TextDecoder().decode(input.data);
    rawBlocks = text.split(/\n{2,}/u).map((paragraph) => ({ text: paragraph, kind: "paragraph" }));
  } else {
    throw new UnsupportedContractFormatError(input.filename);
  }

  if (rawBlocks.length === 0) {
    throw new EmptyContractError(input.filename);
  }

  return {
    ...buildContractDocument(rawBlocks),
    ...(provenance === undefined ? {} : { ocr: provenance }),
    ...(spreadsheet === undefined ? {} : { spreadsheet }),
  };
}
