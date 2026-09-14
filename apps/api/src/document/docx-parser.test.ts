import { expect, test } from "bun:test";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { parseDocx } from "./docx-parser";

/**
 * Round-trips a generated .docx through the parser. The document is built with
 * the same `docx` package users export from Word-compatible editors, so the
 * mammoth HTML the parser walks is exactly what production sees.
 */
async function sampleDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "原材料买卖合同", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("甲方：深圳精工科技有限公司（采购方）")] }),
          new Paragraph({ text: "第二条 支付方式", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun("甲方支付合同总价30%作为预付款。")] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

test("maps Word heading styles to IR heading blocks", async () => {
  const blocks = await parseDocx(await sampleDocx());

  const kinds = blocks.map((block) => block.kind);
  expect(kinds).toContain("heading");
  expect(kinds).toContain("paragraph");

  const title = blocks.find((block) => block.text.includes("原材料买卖合同"));
  expect(title?.kind).toBe("heading");
  expect(title?.page).toBeNull();
});

test("keeps body text intact, including the payment percentage", async () => {
  const blocks = await parseDocx(await sampleDocx());

  const payment = blocks.find((block) => block.text.includes("预付款"));
  expect(payment?.text).toContain("30%");
  expect(payment?.kind).toBe("paragraph");
});

test("a price table becomes readable text, not the markup its cells are wrapped in", async () => {
  // Real dossier contracts put the amounts in a table, and mammoth wraps every
  // cell's text in a paragraph. Leaving those tags in put literal markup into
  // the canonical text and into any evidence quoted out of the table.
  const cell = (text: string) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun(text)] })] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Table({
            rows: [
              new TableRow({ children: [cell("服务内容"), cell("含税总价（元）")] }),
              new TableRow({ children: [cell("软件升级改造服务"), cell("500320")] }),
            ],
          }),
        ],
      },
    ],
  });

  const blocks = await parseDocx(new Uint8Array(await Packer.toBuffer(doc)));

  const table = blocks.find((block) => block.kind === "table");
  expect(table).toBeDefined();
  expect(table?.text).not.toContain("<");
  expect(table?.text).toContain("含税总价（元）");
  expect(table?.text).toContain("500320");
});

test("emits no blocks for an empty document", async () => {
  const doc = new Document({ sections: [{ children: [] }] });
  const blocks = await parseDocx(new Uint8Array(await Packer.toBuffer(doc)));
  expect(blocks).toEqual([]);
});
