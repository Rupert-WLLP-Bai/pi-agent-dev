import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditApp, createApp } from "../app";
import {
  FakeDispatcher,
  InMemoryAuditCaseRepository,
  InMemoryRuleRepository,
  RecordingEventBroker,
} from "../testing/fakes";

/**
 * Uploaded originals retain their filename and bytes when served by
 * `GET /api/source-records/:id/original`. Pasted text has no file and must
 * answer 404 rather than invent one.
 */

// Isolate local fallback writes without changing the caller's upload directory.
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), "contract-originals-"));
const previousUploadDir = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR = UPLOAD_DIR;

afterAll(async () => {
  await rm(UPLOAD_DIR, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
});

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

const upload = (app: AuditApp, filename: string, mimeType: string, text: string) => {
  const form = new FormData();
  form.set("file", new File([new TextEncoder().encode(text)], filename, { type: mimeType }));
  return app.handle(
    new Request("http://localhost/api/audit-cases/upload", { method: "POST", body: form }),
  );
};

const paste = (app: AuditApp, contractText: string) =>
  app.handle(
    new Request("http://localhost/api/audit-cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "text", contractText }),
    }),
  );

const CONTRACT_TEXT = "甲方应于签订后支付合同金额的70%作为预付款。";

test("the stored original is downloadable with its filename", async () => {
  const { app, repository } = setup();

  const response = await upload(app, "设备采购合同.txt", "text/plain", CONTRACT_TEXT);
  const { id: caseId } = (await response.json()) as { id: string };
  const sourceRecordId = repository.sourceRecordIdsByCase.get(caseId) as string;

  const download = await app.handle(
    new Request(`http://localhost/api/source-records/${sourceRecordId}/original`),
  );

  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  const disposition = download.headers.get("content-disposition") ?? "";
  expect(disposition).toContain("attachment");
  expect(decodeURIComponent(disposition)).toContain("设备采购合同.txt");
  expect(await download.text()).toBe(CONTRACT_TEXT);
});

test("a pasted submission has no original and answers 404", async () => {
  const { app, repository } = setup();

  const response = await paste(app, CONTRACT_TEXT);
  expect(response.status).toBe(202);
  const { id: caseId } = (await response.json()) as { id: string };

  const sourceRecordId = repository.sourceRecordIdsByCase.get(caseId) as string;
  const record = await repository.getSourceRecord(sourceRecordId);
  expect(record?.originalPath).toBeNull();

  const download = await app.handle(
    new Request(`http://localhost/api/source-records/${sourceRecordId}/original`),
  );
  expect(download.status).toBe(404);
  expect(await download.json()).toEqual({ error: "no_original" });
});

test("case detail marks an uploaded original as downloadable", async () => {
  const { app } = setup();

  const created = await upload(app, "设备采购合同.txt", "text/plain", CONTRACT_TEXT);
  const { id: caseId } = (await created.json()) as { id: string };

  const detail = await app.handle(new Request(`http://localhost/api/audit-cases/${caseId}`));
  expect(detail.status).toBe(200);
  const body = await detail.json();
  expect(body.originalDownloadable).toBe(true);
  expect(body.sourceProvenance).toEqual({
    type: "FILE_UPLOAD",
    displayName: "设备采购合同.txt",
  });
});

test("case detail does not offer a download for pasted text", async () => {
  const { app } = setup();

  const created = await paste(app, CONTRACT_TEXT);
  const { id: caseId } = (await created.json()) as { id: string };

  const detail = await app.handle(new Request(`http://localhost/api/audit-cases/${caseId}`));
  expect(detail.status).toBe(200);
  const body = await detail.json();
  expect(body.originalDownloadable).toBe(false);
  expect(body.sourceProvenance).toEqual({ type: "TEXT_PASTE", displayName: null });
  expect(body.originalStorage).toBeNull();
});
