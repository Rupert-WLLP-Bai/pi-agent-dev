import type { RawBlock } from "@contract-audit/audit/document-ir";
import ExcelJS from "exceljs";

/**
 * One spreadsheet cell, addressable the way a reviewer would cite it.
 *
 * A dossier's money lives in spreadsheets — price breakdowns, benefit
 * assessments, revenue models — and a finding about an amount has to say which
 * cell it came from. `sheet` plus `ref` is that citation.
 */
export interface SheetCell {
  sheet: string;
  /** A1-style address within the sheet, e.g. "F5". */
  ref: string;
  row: number;
  column: number;
  /** The cell rendered as text, as a reader would see it. */
  text: string;
  /** The value when the cell holds, or computes to, a number. */
  numeric: number | null;
  /** The cell's own formula, without the leading `=`. Null when it has none. */
  formula: string | null;
  /**
   * For a shared-formula follower, the address of the cell the formula is
   * anchored at. Excel stores the text only once, so a follower has no formula
   * of its own — but it is still derived, and treating it as hand-entered
   * would misread nearly two fifths of a real price table.
   */
  sharedWith: string | null;
  /** Excel's number format, e.g. `0.00%`, which tells a ratio from a count. */
  numberFormat: string | null;
}

export interface ParsedSpreadsheet {
  /** Sheet names in workbook order; a cell's `sheet` refers to one of these. */
  sheets: string[];
  cells: SheetCell[];
}

/**
 * True when the cell computed its value rather than having it typed in.
 *
 * This is the distinction worth auditing: a total that is a `SUM` is arithmetic
 * a reviewer can trust, while the same total typed by hand is a number someone
 * could have edited after the fact without the parts changing.
 */
export const isDerived = (cell: SheetCell): boolean =>
  cell.formula !== null || cell.sharedWith !== null;

interface RenderedCell {
  text: string;
  numeric: number | null;
  formula: string | null;
  sharedWith: string | null;
}

/**
 * Flattens one ExcelJS value into text plus the numeric and formula facts.
 *
 * ExcelJS returns a different shape per cell kind, and every one of them turns
 * up in a real dossier: plain numbers and strings, rich text from pasted
 * fragments, dates in term columns, hyperlinks in reference columns, `#REF!`
 * errors in sheets whose source was deleted, and formulas both own and shared.
 */
function renderValue(value: ExcelJS.CellValue): RenderedCell {
  const blank: RenderedCell = { text: "", numeric: null, formula: null, sharedWith: null };
  if (value === null || value === undefined) return blank;

  if (typeof value === "number") {
    return { text: String(value), numeric: value, formula: null, sharedWith: null };
  }
  if (typeof value === "string") {
    return { text: value.trim(), numeric: null, formula: null, sharedWith: null };
  }
  if (typeof value === "boolean") {
    return { text: value ? "TRUE" : "FALSE", numeric: null, formula: null, sharedWith: null };
  }
  if (value instanceof Date) {
    // Dates are cited as dates, never as Excel serial numbers: a term that
    // reads "45291" is a fact no reviewer can check.
    return {
      text: value.toISOString().slice(0, 10),
      numeric: null,
      formula: null,
      sharedWith: null,
    };
  }

  if (typeof value === "object") {
    if ("richText" in value) {
      const text = value.richText.map((run) => run.text).join("");
      return { text: text.trim(), numeric: null, formula: null, sharedWith: null };
    }
    if ("error" in value) {
      return { text: String(value.error), numeric: null, formula: null, sharedWith: null };
    }
    if ("formula" in value || "sharedFormula" in value) {
      const result = "result" in value ? value.result : null;
      const rendered = renderValue((result ?? null) as ExcelJS.CellValue);
      return {
        text: rendered.text,
        numeric: rendered.numeric,
        formula: "formula" in value && typeof value.formula === "string" ? value.formula : null,
        sharedWith:
          "sharedFormula" in value && typeof value.sharedFormula === "string"
            ? value.sharedFormula
            : null,
      };
    }
    if ("hyperlink" in value) {
      const text = typeof value.text === "string" ? value.text : String(value.hyperlink);
      return { text: text.trim(), numeric: null, formula: null, sharedWith: null };
    }
  }

  return blank;
}

/**
 * Reads a .xlsx into raw blocks plus the addressable cell grid.
 *
 * The blocks give the sheet a prose rendering so it travels the same IR as a
 * contract, one block per row with the values a reader would see. The cells are
 * what a cross-document check actually reads: they keep the address, the
 * number, and whether it was computed.
 */
export async function parseXlsx(
  data: Uint8Array,
): Promise<{ blocks: RawBlock[]; spreadsheet: ParsedSpreadsheet }> {
  const workbook = new ExcelJS.Workbook();
  // Copied because the reader takes ownership of the buffer it is given.
  await workbook.xlsx.load(new Uint8Array(data).buffer as ArrayBuffer);

  const blocks: RawBlock[] = [];
  const cells: SheetCell[] = [];
  const sheets: string[] = [];

  for (const [index, sheet] of workbook.worksheets.entries()) {
    sheets.push(sheet.name);
    const page = index + 1;
    // The sheet name is the only label a row block has for its context, so it
    // is emitted as a heading rather than left to the reader to infer.
    blocks.push({ text: sheet.name, kind: "heading", page });

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rendered: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const value = renderValue(cell.value);
        if (value.text === "" && value.numeric === null) return;
        cells.push({
          sheet: sheet.name,
          ref: cell.address,
          row: rowNumber,
          column: columnNumber,
          text: value.text,
          numeric: value.numeric,
          formula: value.formula,
          sharedWith: value.sharedWith,
          numberFormat: typeof cell.numFmt === "string" ? cell.numFmt : null,
        });
        rendered.push(value.text);
      });
      if (rendered.length > 0) {
        blocks.push({ text: rendered.join(" | "), kind: "table", page });
      }
    });
  }

  return { blocks, spreadsheet: { sheets, cells } };
}
