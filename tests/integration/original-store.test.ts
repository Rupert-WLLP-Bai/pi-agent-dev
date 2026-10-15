import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAwsS3Client,
  createFallbackOriginalStore,
  createLocalOriginalStore,
  createS3OriginalStore,
  loadObjectStoreConfig,
  type ObjectStoreClient,
} from "../../apps/api/src/document/original-store";

/**
 * Object-store coverage. The S3 locator contract is the part the database
 * depends on: a row written to S3 must be readable as S3, and a row written
 * through the explicit development fallback must be readable as local — never
 * the other way round.
 *
 * `createFallbackOriginalStore` is the *explicit* non-strict wiring: the
 * development configuration (`S3_STRICT=false`) that chooses local disk as a
 * second backend. It is not the deployment default — in demo/production a write
 * failure must surface instead of silently landing on a different backend, and
 * that strict composition is owned by the storage implementation and asserted
 * by its own tests plus `scripts/qa/faults.ts`. Asserting the factory's own
 * contract here keeps this file about the composition it can see.
 *
 * With a reachable RustFS (S3_ENDPOINT set) the round trip is real; without one
 * the suite proves the local-only and fallback paths.
 */

const endpoint = process.env.S3_ENDPOINT?.trim() ?? "";
const accessKey = process.env.S3_ACCESS_KEY?.trim() ?? "";
const secretKey = process.env.S3_SECRET_KEY?.trim() ?? "";
const bucket = process.env.S3_BUCKET?.trim() ?? "contract-originals";
const region = process.env.S3_REGION?.trim() ?? "us-east-1";

let realS3Available = false;
const uploadDirs: string[] = [];

beforeAll(async () => {
  if (endpoint === "" || accessKey === "" || secretKey === "") return;
  try {
    // A plain probe: a RustFS that answers anything at all means the endpoint
    // is real, and the round-trip test below decides whether it is usable.
    const response = await fetch(`${endpoint}/${bucket}?location`);
    realS3Available = response.status < 500;
  } catch {
    realS3Available = false;
  }
});

afterAll(async () => {
  await Promise.all(uploadDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const tempUploadDir = async (): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "original-store-integration-"));
  uploadDirs.push(dir);
  return dir;
};

describe("integration: S3-compatible object storage", () => {
  test("the local store refuses a locator outside its upload directory", async () => {
    const dir = await tempUploadDir();
    const store = createLocalOriginalStore(dir);
    // A path traversal is the attack this guard exists for: a locator is stored
    // on the Source Record, so a crafted one must not read outside the store.
    await expect(store.read("../outside.txt")).rejects.toThrow("ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR");
  });

  test("a failed S3 put falls back to local and the locator records the backend", async () => {
    const dir = await tempUploadDir();
    const brokenClient: ObjectStoreClient = {
      async putObject(): Promise<void> {
        throw new Error("s3 unavailable");
      },
      async getObject(): Promise<Buffer> {
        throw new Error("s3 unavailable");
      },
    };
    const store = createFallbackOriginalStore(
      createS3OriginalStore({ client: brokenClient, bucket }),
      createLocalOriginalStore(dir),
    );
    const locator = await store.save("rec-fallback", Buffer.from("降级正文"), "合同.txt");
    // The locator is a filesystem path, not an s3:// one: the row records where
    // the bytes actually are, so a later read follows the same backend.
    expect(locator.startsWith("s3://")).toBe(false);
    expect((await store.read(locator)).toString("utf8")).toBe("降级正文");
  });

  test.skipIf(!realS3Available)("a real S3 round trip returns the exact bytes", async () => {
    if (!realS3Available) return;
    const client = createAwsS3Client({ endpoint, accessKey, secretKey, region });
    const store = createS3OriginalStore({ client, bucket });
    const recordId = `integration-${crypto.randomUUID()}`;
    const bytes = Buffer.from("对象存储往返正文：合同金额的70%作为预付款。", "utf8");
    const locator = await store.save(recordId, bytes, "合同.txt");
    expect(locator).toBe(`s3://${bucket}/${recordId}.txt`);
    const readBack = await store.read(locator);
    expect(readBack.equals(bytes)).toBe(true);
  });

  test.skipIf(!realS3Available)("a local row is never re-read through S3", async () => {
    if (!realS3Available) return;
    const dir = await tempUploadDir();
    const client = createAwsS3Client({ endpoint, accessKey, secretKey, region });
    const store = createFallbackOriginalStore(
      createS3OriginalStore({ client, bucket }),
      createLocalOriginalStore(dir),
    );
    const local = await createLocalOriginalStore(dir).save(
      "rec-local",
      Buffer.from("本地"),
      "a.txt",
    );
    expect((await store.read(local)).toString("utf8")).toBe("本地");
  });

  test("an unconfigured endpoint resolves to the local store only", () => {
    const previous = process.env.S3_ENDPOINT;
    process.env.S3_ENDPOINT = "";
    try {
      const config = loadObjectStoreConfig();
      expect(config.endpoint).toBeUndefined();
    } finally {
      process.env.S3_ENDPOINT = previous;
    }
  });
});
