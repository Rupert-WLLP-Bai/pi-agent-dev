import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Bytes of an uploaded contract, addressed by a locator stored on the Source
 * Record. The locator is either a filesystem path (local fallback / legacy
 * rows) or `s3://bucket/key`.
 */
export interface OriginalStore {
  save(sourceRecordId: string, buffer: Buffer, filename: string): Promise<string>;
  read(locator: string): Promise<Buffer>;
}

/** The subset of S3 the original store needs; tests inject an in-memory client. */
export interface ObjectStoreClient {
  putObject(input: { bucket: string; key: string; body: Buffer }): Promise<void>;
  getObject(input: { bucket: string; key: string }): Promise<Buffer>;
  headBucket?(bucket: string): Promise<boolean>;
}

const objectKey = (sourceRecordId: string, filename: string): string =>
  `${sourceRecordId}${extname(filename)}`;

export const parseS3Locator = (locator: string): { bucket: string; key: string } | null => {
  if (!locator.startsWith("s3://")) return null;
  const rest = locator.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
};

export type OriginalStorage = "s3" | "local";

export const originalStorageOf = (locator: string | null | undefined): OriginalStorage | null => {
  if (!locator) return null;
  return parseS3Locator(locator) ? "s3" : "local";
};

export function createLocalOriginalStore(dir?: string): OriginalStore {
  const resolveDir = () => dir ?? process.env.UPLOAD_DIR ?? "var/uploads";
  return {
    async save(sourceRecordId, buffer, filename) {
      const target = resolveDir();
      await mkdir(target, { recursive: true });
      const path = join(target, objectKey(sourceRecordId, filename));
      await writeFile(path, buffer);
      return path;
    },
    async read(locator) {
      const root = resolve(resolveDir());
      const path = resolve(locator);
      if (!path.startsWith(root)) {
        throw new Error("ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR");
      }
      return readFile(path);
    },
  };
}

export function createS3OriginalStore(opts: {
  client: ObjectStoreClient;
  bucket: string;
}): OriginalStore {
  return {
    async save(sourceRecordId, buffer, filename) {
      const key = objectKey(sourceRecordId, filename);
      await opts.client.putObject({ bucket: opts.bucket, key, body: buffer });
      return `s3://${opts.bucket}/${key}`;
    },
    async read(locator) {
      const parsed = parseS3Locator(locator);
      if (!parsed) throw new Error(`not an s3 locator: ${locator}`);
      return opts.client.getObject(parsed);
    },
  };
}

/**
 * Prefer the primary (S3) store on write. A failed Put falls back to local
 * disk so an audit is not blocked by object-store outage. Reads follow the
 * locator scheme, so a row written to S3 is not silently re-read from disk.
 */
export function createFallbackOriginalStore(
  primary: OriginalStore,
  fallback: OriginalStore,
): OriginalStore {
  return {
    async save(sourceRecordId, buffer, filename) {
      try {
        return await primary.save(sourceRecordId, buffer, filename);
      } catch (error) {
        console.warn("object store put failed; falling back to local disk", error);
        return fallback.save(sourceRecordId, buffer, filename);
      }
    },
    async read(locator) {
      if (parseS3Locator(locator)) return primary.read(locator);
      return fallback.read(locator);
    },
  };
}

export function createAwsS3Client(config: {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
}): ObjectStoreClient {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
  return {
    async putObject({ bucket, key, body }) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    async getObject({ bucket, key }) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error("empty s3 object");
      return Buffer.from(bytes);
    },
    async headBucket(bucket) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface ObjectStoreConfig {
  endpoint?: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

export function loadObjectStoreConfig(): ObjectStoreConfig {
  return {
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
    bucket: process.env.S3_BUCKET ?? "contract-originals",
    region: process.env.S3_REGION ?? "us-east-1",
  };
}

export function createOriginalStoreFromEnv(
  config: ObjectStoreConfig = loadObjectStoreConfig(),
): OriginalStore {
  const local = createLocalOriginalStore();
  if (!config.endpoint) return local;
  const s3 = createS3OriginalStore({
    client: createAwsS3Client({
      endpoint: config.endpoint,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
    }),
    bucket: config.bucket,
  });
  return createFallbackOriginalStore(s3, local);
}

/**
 * Writes an uploaded contract under its Source Record id. `UPLOAD_DIR` and
 * `S3_*` are read per call so a test can point them elsewhere for one run.
 */
export async function saveOriginal(
  sourceRecordId: string,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  return createOriginalStoreFromEnv().save(sourceRecordId, buffer, filename);
}

/** Reads back a stored original for the download endpoint. */
export async function readOriginal(locator: string): Promise<Buffer> {
  return createOriginalStoreFromEnv().read(locator);
}
