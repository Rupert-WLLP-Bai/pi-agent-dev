import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFallbackOriginalStore,
  createLocalOriginalStore,
  createS3OriginalStore,
  type ObjectStoreClient,
} from "./original-store";

const tmpDirs: string[] = [];

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "original-store-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class MemoryObjectStore implements ObjectStoreClient {
  objects = new Map<string, Buffer>();
  failPuts = false;

  async putObject(input: { bucket: string; key: string; body: Buffer }): Promise<void> {
    if (this.failPuts) throw new Error("s3 put failed");
    this.objects.set(`${input.bucket}/${input.key}`, input.body);
  }

  async getObject(input: { bucket: string; key: string }): Promise<Buffer> {
    const value = this.objects.get(`${input.bucket}/${input.key}`);
    if (!value) throw new Error("s3 object missing");
    return value;
  }
}

test("the local store writes under UPLOAD_DIR and returns a filesystem locator", async () => {
  const dir = tempDir();
  const store = createLocalOriginalStore(dir);
  const locator = await store.save("rec-1", Buffer.from("合同正文"), "设备采购合同.docx");

  expect(locator).toBe(join(dir, "rec-1.docx"));
  expect(await readFile(locator, "utf8")).toBe("合同正文");
  expect((await store.read(locator)).toString("utf8")).toBe("合同正文");
});

test("the S3 store returns an s3 locator and round-trips the bytes", async () => {
  const client = new MemoryObjectStore();
  const store = createS3OriginalStore({ client, bucket: "contract-originals" });

  const locator = await store.save("rec-2", Buffer.from("对象存储正文"), "合同.pdf");

  expect(locator).toBe("s3://contract-originals/rec-2.pdf");
  expect(client.objects.get("contract-originals/rec-2.pdf")?.toString("utf8")).toBe("对象存储正文");
  expect((await store.read(locator)).toString("utf8")).toBe("对象存储正文");
});

test("the fallback store prefers S3 and does not write locally on success", async () => {
  const dir = tempDir();
  const client = new MemoryObjectStore();
  const store = createFallbackOriginalStore(
    createS3OriginalStore({ client, bucket: "contract-originals" }),
    createLocalOriginalStore(dir),
  );

  const locator = await store.save("rec-3", Buffer.from("优先对象存储"), "a.txt");

  expect(locator).toBe("s3://contract-originals/rec-3.txt");
  expect(await readFile(join(dir, "rec-3.txt")).catch(() => null)).toBeNull();
  expect((await store.read(locator)).toString("utf8")).toBe("优先对象存储");
});

test("the fallback store writes locally when S3 put fails", async () => {
  const dir = tempDir();
  const client = new MemoryObjectStore();
  client.failPuts = true;
  const store = createFallbackOriginalStore(
    createS3OriginalStore({ client, bucket: "contract-originals" }),
    createLocalOriginalStore(dir),
  );

  const locator = await store.save("rec-4", Buffer.from("退化到本地"), "b.txt");

  expect(locator).toBe(join(dir, "rec-4.txt"));
  expect((await store.read(locator)).toString("utf8")).toBe("退化到本地");
});
