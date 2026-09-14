import { expect, type Page, test } from "@playwright/test";
import ExcelJS from "exceljs";

/**
 * The dossier amount chain, driven through the page the operator actually uses.
 *
 * The two upload fixtures are assembled in memory so the shape under test is
 * visible here: a price sheet whose customer-side 含税 total lives in a formula
 * cell, and a revenue contract whose stated maximum is that same number. The
 * backend's unit tests prove the reconciliation; this spec proves the browser
 * carries the files up, the own-name input decides the stance, and the result
 * is rendered rather than merely computed.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OUR_NAME = "中国移动通信集团重庆有限公司";

/** Fails fast with a clear reason when the API is not reachable through the web origin. */
async function assertApiReachable(page: Page) {
  const response = await page.request.get("/api/health");
  expect(
    response.ok(),
    `API not reachable via web origin (status ${response.status()}); is the dev stack up?`,
  ).toBe(true);
}

/** The customer-side 含税 total sits in F3 as a SUM, so it is a formula and not a typed number. */
async function priceWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "接口名称";
  sheet.getCell("C1").value = "客户侧不含税单价";
  sheet.getCell("E1").value = "不含税总价";
  sheet.getCell("F1").value = "含税总价";
  sheet.getCell("G1").value = "供应商不含税单价";
  sheet.getCell("I1").value = "不含税总价";
  sheet.getCell("J1").value = "含税总价";
  sheet.getCell("A2").value = "二要素核验服务";
  sheet.getCell("E2").value = 1_867_924.53;
  sheet.getCell("F2").value = 1_980_000;
  sheet.getCell("I2").value = 1_759_600;
  sheet.getCell("J2").value = 1_865_176;
  sheet.getCell("A3").value = "合计";
  sheet.getCell("E3").value = { formula: "SUM(E2:E2)", result: 1_867_924.53 };
  sheet.getCell("F3").value = { formula: "SUM(F2:F2)", result: 1_980_000 };
  sheet.getCell("I3").value = { formula: "SUM(I2:I2)", result: 1_759_600 };
  sheet.getCell("J3").value = { formula: "SUM(J2:J2)", result: 1_865_176 };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** A .docx is a zip of XML; mammoth reads a document.xml with these paragraphs. */
async function contractDocx(paragraphs: string[]): Promise<Uint8Array> {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
    "word/document.xml":
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  };

  // Store entries uncompressed so the archive can be assembled without a zip
  // library; readers accept method 0.
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(10, 0, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, data.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = [...parts, ...central, end];
  const archive = new Uint8Array(total.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of total) {
    archive.set(part, at);
    at += part.length;
  }
  return archive;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test.describe("卷宗核对 — the stated contract amount is reconciled against the price sheet", () => {
  test("a revenue contract matching the customer-side 含税 total reports 金额一致", async ({
    page,
  }) => {
    await assertApiReachable(page);

    const workbook = Buffer.from(await priceWorkbook());
    const contract = Buffer.from(
      await contractDocx([
        "甲方：天翼数智科技（北京）有限公司",
        `乙方：${OUR_NAME}两江新区分公司`,
        "本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
      ]),
    );

    await page.goto("/dossier-review");
    await expect(page.getByRole("heading", { name: "卷宗核对" })).toBeVisible();

    await page.getByPlaceholder("本方主体名称，逗号分隔；留空用服务端配置").fill(OUR_NAME);

    const start = page.getByRole("button", { name: "开始核对" });
    // The cross-document check needs both halves of the chain.
    await expect(start).toBeDisabled();

    await page.locator("input[type=file]").setInputFiles([
      { name: "收入测算.xlsx", mimeType: XLSX_MIME, buffer: workbook },
      { name: "【收入合同】.docx", mimeType: DOCX_MIME, buffer: contract },
    ]);
    await expect(page.getByText("收入测算.xlsx")).toBeVisible();
    await expect(page.getByText("【收入合同】.docx")).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();

    // The contract states 1,980,000 含税, and the sheet's customer-side 含税
    // total in F3 is the same number, so the two materials agree.
    const matched = page.locator(".ant-card").filter({ hasText: "金额一致" });
    await expect(matched).toBeVisible({ timeout: 30_000 });
    await expect(matched.getByText("一致", { exact: true })).toBeVisible();
    await expect(matched).toContainText("1,980,000.00");
    await expect(matched).toContainText("Sheet1!F3");

    // The conclusion counts one compared amount item and no discrepancy.
    const conclusion = page.locator(".ant-card").filter({ hasText: "核对结论" });
    await expect(
      conclusion.locator(
        '.ant-descriptions-item-label:text-is("比对金额项") + .ant-descriptions-item-content',
      ),
    ).toHaveText("1");
    await expect(
      conclusion.locator(
        '.ant-descriptions-item-label:text-is("不一致") + .ant-descriptions-item-content',
      ),
    ).toHaveText("0");
  });
});
