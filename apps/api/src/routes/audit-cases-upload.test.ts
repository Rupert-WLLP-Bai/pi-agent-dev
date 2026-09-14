import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

/**
 * Uploads are gated by size and by declared type before any parsing happens:
 * an oversized body is refused with 413, and a file whose MIME type does not
 * match its extension is refused with 422.
 */

const MAX_UPLOAD_BYTES = 10_485_760;
const UPLOAD_URL = "http://localhost/api/audit-cases/upload";

// A throwaway directory keeps the test from writing into var/uploads.
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), "contract-upload-test-"));
process.env.UPLOAD_DIR = UPLOAD_DIR;

// Ensure cleanup after all tests in this file.
afterAll(() => rmSync(UPLOAD_DIR, { recursive: true, force: true }));

/**
 * Builds a minimal single-page PDF by hand (two text lines via the Tj
 * operator), which pdfjs-dist parses without any font embedding. Keeps the
 * test hermetic: no fixture file, no binary blob, no network.
 */
function buildPdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 700 Td ${lines
    .map((line, index) => `${index === 0 ? "" : "0 -20 Td "}(${line}) Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

const setup = () => {
  const repository = new InMemoryAuditCaseRepository();
  const dispatcher = new FakeDispatcher();
  const app = createApp({
    repository: repository.asRepository(),
    dispatcher: dispatcher.asDispatcher(),
    broker: new RecordingEventBroker().asBroker(),
    rules: new InMemoryRuleRepository().asRepository(),
  });
  return { repository, dispatcher, app };
};

const upload = (app: AuditApp, filename: string, mimeType: string, data: Uint8Array) => {
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view so the value is a valid BlobPart.
  form.set("file", new File([new Uint8Array(data)], filename, { type: mimeType }));
  return app.handle(new Request(UPLOAD_URL, { method: "POST", body: form }));
};

test("an oversized upload is refused with 413 without being parsed", async () => {
  const { app, dispatcher } = setup();

  const response = await upload(
    app,
    "contract.pdf",
    "application/pdf",
    new Uint8Array(MAX_UPLOAD_BYTES + 1),
  );

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "file_too_large" });
  // Refused before a case was scheduled.
  expect(dispatcher.enqueued).toHaveLength(0);
});

test("a declared type that contradicts the extension is refused with 422", async () => {
  const { app, dispatcher } = setup();

  const response = await upload(
    app,
    "contract.pdf",
    "image/jpeg",
    buildPdf(["ADVANCE PAYMENT 70%"]),
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "mime_mismatch" });
  expect(dispatcher.enqueued).toHaveLength(0);
});

test("a file outside the whitelist is refused with 422", async () => {
  const { app } = setup();

  const response = await upload(
    app,
    "contract.exe",
    "application/octet-stream",
    new Uint8Array(16),
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "unsupported_file_type" });
});

test("a spreadsheet is accepted, so a dossier's price and benefit tables can be audited", async () => {
  const { app, dispatcher } = setup();
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1").addRow(["客户侧含税总价", 1990000]);

  const response = await upload(
    app,
    "价格明细.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    new Uint8Array(await workbook.xlsx.writeBuffer()),
  );

  expect(response.status).toBe(202);
  expect(dispatcher.enqueued).toHaveLength(1);
});

test("a spreadsheet whose declared type contradicts its extension is refused with 422", async () => {
  const { app } = setup();

  const response = await upload(app, "价格明细.xlsx", "application/pdf", new Uint8Array(16));

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "mime_mismatch" });
});

test("a matching small PDF is accepted and queued", async () => {
  const { app, dispatcher, repository } = setup();

  const response = await upload(
    app,
    "contract.pdf",
    "application/pdf",
    buildPdf(["ADVANCE PAYMENT 70%", "SECOND LINE TEXT"]),
  );

  expect(response.status).toBe(202);
  const body = (await response.json()) as { id: string; status: string };
  expect(body.status).toBe("PENDING");
  expect(dispatcher.enqueued).toContain(body.id);
  expect(await repository.getCase(body.id)).not.toBeNull();
});
