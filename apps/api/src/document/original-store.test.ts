import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFallbackOriginalStore,
  createLocalOriginalStore,
  createOriginalStore,
  createS3OriginalStore,
  type ObjectStoreClient,
  readOriginal,
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

test("a strict store fails the upload instead of silently switching backend", async () => {
  const dir = tempDir();
  const client = new MemoryObjectStore();
  client.failPuts = true;
  // The demo/production default: a Put failure must surface, because a
  // locator that says s3:// while the bytes sit on local disk is a state no
  // operator can explain afterwards.
  const store = createOriginalStore({
    endpoint: "http://rustfs:9000",
    accessKey: "k",
    secretKey: "s",
    bucket: "contract-originals",
    region: "us-east-1",
    strict: true,
    client,
  });

  // The local side of a configured store still resolves its directory from the
  // environment; point it at the throwaway dir so the assertion below is about
  // "no local file was written", not about where the process default points.
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    await expect(store.save("rec-5", Buffer.from("必须失败"), "c.txt")).rejects.toThrow();
    // Nothing was written locally as a consolation: the upload simply failed.
    expect(await readFile(join(dir, "rec-5.txt")).catch(() => null)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
  }
});

test("the local store rejects a sibling directory that shares the root prefix", async () => {
  const root = tempDir();
  // A sibling whose name merely starts with the upload root's path string:
  // prefix matching without the separator would accept it as contained. The
  // directory exists, so realpath resolves it and the comparison is genuine.
  const sibling = `${root}-evil`;
  mkdirSync(sibling, { recursive: true });
  const store = createLocalOriginalStore(root);
  tmpDirs.push(sibling);

  await expect(store.read(join(sibling, "rec-7.txt"))).rejects.toThrow(
    "ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR",
  );
});

test("the local store reads through a symlinked upload root", async () => {
  const real = tempDir();
  const link = join(tempDir(), "uploads-link");
  symlinkSync(real, link, "dir");
  const store = createLocalOriginalStore(link);
  const locator = await store.save("rec-8", Buffer.from("符号链接根目录"), "e.txt");

  // The locator was written through the symlink; containment is decided on
  // real paths, so the read succeeds instead of being refused.
  expect((await store.read(locator)).toString("utf8")).toBe("符号链接根目录");
});

test("strict S3 writes keep historical local originals readable during an outage", async () => {
  const dir = tempDir();
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const legacy = await createLocalOriginalStore(dir).save(
      "legacy",
      Buffer.from("历史原件"),
      "a.txt",
    );
    const client = new MemoryObjectStore();
    client.failPuts = true;
    const store = createOriginalStore({
      endpoint: "http://rustfs:9000",
      accessKey: "k",
      secretKey: "s",
      bucket: "owned",
      region: "us-east-1",
      strict: true,
      client,
    });
    expect(await store.read(legacy)).toEqual(Buffer.from("历史原件"));
    await expect(store.save("new", Buffer.from("新原件"), "b.txt")).rejects.toThrow();
    expect(await readFile(join(dir, "new.txt")).catch(() => null)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
  }
});

test("a configured S3 store refuses an existing object owned by another bucket", async () => {
  const client = new MemoryObjectStore();
  client.objects.set("foreign/private.txt", Buffer.from("不属于当前工作区的原件"));
  const store = createS3OriginalStore({ client, bucket: "owned" });
  await expect(store.read("s3://foreign/private.txt")).rejects.toThrow(
    "ORIGINAL_BUCKET_NOT_ALLOWED",
  );
});

test("original integrity rejects changed bytes even when their length is unchanged", async () => {
  const dir = tempDir();
  const previous = { UPLOAD_DIR: process.env.UPLOAD_DIR, S3_ENDPOINT: process.env.S3_ENDPOINT };
  process.env.UPLOAD_DIR = dir;
  delete process.env.S3_ENDPOINT;
  try {
    const locator = await createLocalOriginalStore(dir).save(
      "immutable",
      Buffer.from("abc"),
      "a.txt",
    );
    const metadata = {
      originalSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      originalSizeBytes: 3,
    };
    expect(await readOriginal(locator, metadata)).toEqual(Buffer.from("abc"));
    await writeFile(locator, "abd");
    await expect(readOriginal(locator, metadata)).rejects.toThrow("ORIGINAL_INTEGRITY_MISMATCH");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
