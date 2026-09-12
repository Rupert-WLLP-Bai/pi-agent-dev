import type { ContractDocument, RawBlock } from "@contract-audit/audit/document-ir";
import { buildContractDocument } from "@contract-audit/audit/document-ir";
import { parseDocx } from "./docx-parser";
import { parsePdf } from "./pdf-parser";

export class UnsupportedContractFormatError extends Error {
  constructor(filename: string) {
    super(`不支持的合同格式：${filename}（仅支持 .docx、.pdf、.txt）`);
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

export interface ParsedContract {
  document: ContractDocument;
  /** Canonical text — what the parser read, joined into one auditable body. */
  text: string;
}

const extensionOf = (filename: string): string => {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
};

/**
 * Turns an uploaded contract into the Contract Document IR. Format dispatch is
 * by extension; every branch converges on the same IR builder, so downstream
 * rules cannot tell a docx from a pasted text.
 */
export async function parseContractFile(input: {
  filename: string;
  data: Uint8Array;
}): Promise<ParsedContract> {
  const extension = extensionOf(input.filename);
  let rawBlocks: RawBlock[];

  if (extension === ".docx") {
    rawBlocks = await parseDocx(input.data);
  } else if (extension === ".pdf") {
    rawBlocks = await parsePdf(input.data);
  } else if (extension === ".txt" || extension === ".md") {
    const text = new TextDecoder().decode(input.data);
    rawBlocks = text.split(/\n{2,}/u).map((paragraph) => ({ text: paragraph, kind: "paragraph" }));
  } else {
    throw new UnsupportedContractFormatError(input.filename);
  }

  if (rawBlocks.length === 0) {
    throw new EmptyContractError(input.filename);
  }

  return buildContractDocument(rawBlocks);
}
