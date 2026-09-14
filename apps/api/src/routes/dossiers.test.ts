import { expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

/**
 * The cross-document review over one dossier, driven through HTTP.
 *
 * The workbook is built here rather than loaded, so the shape being asserted is
 * visible: a customer-side and a supplier-side price group under one header, and
 * SUM totals beneath. It mirrors 收入测算（天翼数智五）, whose column layout is what
 * the side inference has to survive.
 */

const URL = "http://localhost/api/dossiers/amount-chain";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OUR_NAME = "中国移动通信集团重庆有限公司";

const app = (): AuditApp =>
  createApp({
    repository: new InMemoryAuditCaseRepository().asRepository(),
    dispatcher: new FakeDispatcher().asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });

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

const review = (files: Array<[string, string, Uint8Array]>, ownNames = OUR_NAME) => {
  const form = new FormData();
  for (const [name, mime, data] of files) {
    form.append("files", new File([new Uint8Array(data)], name, { type: mime }));
  }
  form.set("ownOrganizationNames", ownNames);
  return app().handle(new Request(URL, { method: "POST", body: form }));
};

test("a revenue contract is reconciled against the customer side of the price sheet", async () => {
  const response = await review([
    ["收入测算.xlsx", XLSX_MIME, await priceWorkbook()],
    [
      "【收入合同】.docx",
      DOCX_MIME,
      await contractDocx([
        `甲方：天翼数智科技（北京）有限公司`,
        `乙方：${OUR_NAME}两江新区分公司`,
        "本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
      ]),
    ],
  ]);

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    checked: number;
    matched: Array<{ matched: { ref: string; side: string } }>;
    mismatched: unknown[];
    artifacts: Array<{ name: string; kind: string; stance: string | null }>;
  };

  expect(body.checked).toBe(1);
  expect(body.mismatched).toHaveLength(0);
  expect(body.matched[0].matched.ref).toBe("F3");
  expect(body.matched[0].matched.side).toBe("customer");
  expect(body.artifacts.find((a) => a.kind === "CONTRACT")?.stance).toBe("revenue");
});

test("a contract total that drifted from the sheet is reported with the gap", async () => {
  const response = await review([
    ["收入测算.xlsx", XLSX_MIME, await priceWorkbook()],
    [
      "【收入合同】.docx",
      DOCX_MIME,
      await contractDocx([
        `甲方：天翼数智科技（北京）有限公司`,
        `乙方：${OUR_NAME}两江新区分公司`,
        "本协议最大发生金额为（含税价）人民币大写【壹佰捌拾玖万】元整，小写【1890000】元。",
      ]),
    ],
  ]);

  const body = (await response.json()) as {
    mismatched: Array<{ nearest: { ref: string }; difference: number }>;
  };

  expect(body.mismatched).toHaveLength(1);
  expect(body.mismatched[0].nearest.ref).toBe("F3");
  expect(body.mismatched[0].difference).toBe(-90_000);
});

test("without our own name no stance is claimed, and nothing is compared", async () => {
  const response = await review(
    [
      ["收入测算.xlsx", XLSX_MIME, await priceWorkbook()],
      [
        "【收入合同】.docx",
        DOCX_MIME,
        await contractDocx([
          `甲方：天翼数智科技（北京）有限公司`,
          `乙方：${OUR_NAME}两江新区分公司`,
          "本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
        ]),
      ],
    ],
    "",
  );

  const body = (await response.json()) as {
    checked: number;
    artifacts: Array<{ kind: string; stance: string | null; stanceBasis: string }>;
  };

  // Comparing against a guessed side would report the project's margin as a
  // discrepancy, so an unconfigured deployment reports nothing instead.
  expect(body.checked).toBe(0);
  const contract = body.artifacts.find((artifact) => artifact.kind === "CONTRACT");
  expect(contract?.stance).toBeNull();
  expect(contract?.stanceBasis).toContain("未配置本方主体名称");
});

test("a single file is refused: there is no cross-document check to make", async () => {
  const response = await review([["收入测算.xlsx", XLSX_MIME, await priceWorkbook()]]);

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "dossier_needs_at_least_two_files" });
});

test("a file outside the whitelist is refused before anything is parsed", async () => {
  const response = await review([
    ["收入测算.xlsx", XLSX_MIME, await priceWorkbook()],
    ["合同.exe", "application/octet-stream", new Uint8Array(16)],
  ]);

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "unsupported_file_type" });
});

test("one unreadable file does not lose the review of the rest", async () => {
  const response = await review([
    ["收入测算.xlsx", XLSX_MIME, await priceWorkbook()],
    [
      "【收入合同】.docx",
      DOCX_MIME,
      await contractDocx([
        `甲方：天翼数智科技（北京）有限公司`,
        `乙方：${OUR_NAME}两江新区分公司`,
        "本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
      ]),
    ],
    ["损坏的方案.docx", DOCX_MIME, new Uint8Array([1, 2, 3, 4])],
  ]);

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    matched: unknown[];
    artifacts: Array<{ name: string; error: string | null }>;
  };

  // The chain is still checked; the unreadable file is reported against itself.
  expect(body.matched).toHaveLength(1);
  expect(body.artifacts.find((a) => a.name === "损坏的方案.docx")?.error).not.toBeNull();
});

test("the hand-typed totals are reported alongside the reconciliation", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("F1").value = "客户侧含税总价";
  sheet.getCell("A2").value = "合计";
  sheet.getCell("F2").value = 1_980_000;

  const response = await review([
    ["效益评估表.xlsx", XLSX_MIME, new Uint8Array(await workbook.xlsx.writeBuffer())],
    [
      "【收入合同】.docx",
      DOCX_MIME,
      await contractDocx([
        `甲方：天翼数智科技（北京）有限公司`,
        `乙方：${OUR_NAME}两江新区分公司`,
        "本协议最大发生金额为（含税价）人民币大写【壹佰玖拾捌万】元整，小写【1980000】元。",
      ]),
    ],
  ]);

  const body = (await response.json()) as {
    matched: unknown[];
    handEnteredTotals: Array<{ ref: string; amount: number }>;
  };

  expect(body.matched).toHaveLength(1);
  expect(body.handEnteredTotals).toEqual([
    expect.objectContaining({ ref: "F2", amount: 1_980_000 }),
  ]);
});
