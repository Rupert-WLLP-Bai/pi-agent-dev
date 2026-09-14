import { expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { isDerived, parseXlsx, type SheetCell } from "./xlsx-parser";

/**
 * Builds a workbook in process, shaped like the real price breakdown a dossier
 * carries: a customer side, a supplier side, SUM totals, and a margin derived
 * from both. Kept hermetic — no fixture file, no binary blob in git.
 */
async function buildPriceSheet(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  sheet.addRow(["产品列表", "预估数量", "客户侧含税总价", "供应商含税总价"]);
  sheet.addRow(["用户要素数据核对服务", 7000000, { formula: "0.21*B2", result: 1470000 }, 1320760]);
  sheet.addRow(["用户活跃度数据分析服务", 4000000, { formula: "0.09*B3", result: 360000 }, 322240]);
  sheet.addRow([
    "合计",
    null,
    { formula: "SUM(C2:C3)", result: 1830000 },
    { formula: "SUM(D2:D3)", result: 1643000 },
  ]);
  sheet.getCell("E4").value = { formula: "C4/D4-1", result: 0.1138 };
  sheet.getCell("E4").numFmt = "0.00%";

  const terms = workbook.addWorksheet("期限");
  terms.getCell("A1").value = "服务起始日";
  terms.getCell("B1").value = new Date(Date.UTC(2024, 0, 15));
  terms.getCell("A2").value = "备注";
  terms.getCell("B2").value = { richText: [{ text: "含税" }, { text: "总价" }] };
  terms.getCell("A3").value = "失效引用";
  terms.getCell("B3").value = { error: "#REF!" };

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

const at = (cells: SheetCell[], sheet: string, ref: string): SheetCell => {
  const found = cells.find((cell) => cell.sheet === sheet && cell.ref === ref);
  if (!found) throw new Error(`no cell at ${sheet}!${ref}`);
  return found;
};

test("every cell keeps the address a reviewer would cite it by", async () => {
  const { spreadsheet } = await parseXlsx(await buildPriceSheet());

  expect(spreadsheet.sheets).toEqual(["Sheet1", "期限"]);
  const total = at(spreadsheet.cells, "Sheet1", "C4");
  expect(total.numeric).toBe(1830000);
  expect(total.row).toBe(4);
  expect(total.column).toBe(3);
  expect(at(spreadsheet.cells, "Sheet1", "A2").text).toBe("用户要素数据核对服务");
});

test("a computed total is distinguishable from one typed in by hand", async () => {
  const { spreadsheet } = await parseXlsx(await buildPriceSheet());

  const summed = at(spreadsheet.cells, "Sheet1", "C4");
  expect(summed.formula).toBe("SUM(C2:C3)");
  expect(isDerived(summed)).toBe(true);

  // D2 carries the supplier price as a bare number — the case worth flagging
  // when it should have been derived.
  const typed = at(spreadsheet.cells, "Sheet1", "D2");
  expect(typed.formula).toBeNull();
  expect(typed.sharedWith).toBeNull();
  expect(isDerived(typed)).toBe(false);
  expect(typed.numeric).toBe(1320760);
});

test("the margin cell keeps both its formula and the format that makes it a ratio", async () => {
  const { spreadsheet } = await parseXlsx(await buildPriceSheet());

  const margin = at(spreadsheet.cells, "Sheet1", "E4");
  expect(margin.formula).toBe("C4/D4-1");
  expect(margin.numeric).toBeCloseTo(0.1138, 6);
  // Without the format, 0.1138 is indistinguishable from a count.
  expect(margin.numberFormat).toBe("0.00%");
});

test("dates are cited as dates, never as Excel serial numbers", async () => {
  const { spreadsheet } = await parseXlsx(await buildPriceSheet());

  const start = at(spreadsheet.cells, "期限", "B1");
  expect(start.text).toBe("2024-01-15");
  expect(start.numeric).toBeNull();
});

test("rich text is flattened and a broken reference is reported as its error", async () => {
  const { spreadsheet } = await parseXlsx(await buildPriceSheet());

  expect(at(spreadsheet.cells, "期限", "B2").text).toBe("含税总价");
  expect(at(spreadsheet.cells, "期限", "B3").text).toBe("#REF!");
});

test("each sheet becomes a heading and each row a table block on its own page", async () => {
  const { blocks } = await parseXlsx(await buildPriceSheet());

  expect(blocks[0]).toEqual({ text: "Sheet1", kind: "heading", page: 1 });
  expect(blocks[1]).toEqual({
    text: "产品列表 | 预估数量 | 客户侧含税总价 | 供应商含税总价",
    kind: "table",
    page: 1,
  });
  // The row block shows the computed value, so a prose rule reads the number a
  // reviewer sees rather than the formula behind it.
  expect(blocks[2].text).toContain("1470000");
  const termsHeading = blocks.find((block) => block.text === "期限");
  expect(termsHeading?.kind).toBe("heading");
  expect(termsHeading?.page).toBe(2);
});

test("the caller's bytes survive parsing, so a second reader still sees them", async () => {
  const data = await buildPriceSheet();
  const byteLength = data.byteLength;

  await parseXlsx(data);

  expect(data.byteLength).toBe(byteLength);
  const again = await parseXlsx(data);
  expect(again.spreadsheet.sheets).toEqual(["Sheet1", "期限"]);
});
