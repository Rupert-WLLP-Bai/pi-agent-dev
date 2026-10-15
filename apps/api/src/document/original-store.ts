import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import {
  DeleteObjectCommand,
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
  /** Removes an object this store wrote; used only to reclaim a failed upload. */
  deleteObject?(input: { bucket: string; key: string }): Promise<void>;
  headBucket?(bucket: string): Promise<boolean>;
}

const objectKey = (sourceRecordId: string, filename: string): string =>
  `${sourceRecordId}${extname(filename)}`;

/**
 * The real path of the deepest existing prefix. A removed original still needs
 * a containment decision before its missing-file error reaches the caller.
 */
const existingAncestor = async (path: string): Promise<string> => {
  let current = path;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
};

export const parseS3Locator = (locator: string): { bucket: string; key: string } | null => {
  if (!locator.startsWith("s3://")) return null;
  const rest = locator.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
};

export type OriginalStorage = "s3" | "local";

/**
 * Reduces storage failures to fixed codes. SDK names/messages can contain
 * endpoint or response details and must not reach logs or public errors.
 */
export function describeStorageError(error: unknown): string {
  if (!(error instanceof Error)) return "storage_error";
  if (error.message === "ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR")
    return "original_path_outside_upload_dir";
  if (error.message === "ORIGINAL_BUCKET_NOT_ALLOWED") return "original_bucket_not_allowed";
  if (
    error.message === "ORIGINAL_INTEGRITY_MISMATCH" ||
    error.message === "ORIGINAL_INTEGRITY_METADATA_INVALID"
  )
    return "original_integrity_mismatch";
  if (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error.message.includes("timed out")
  )
    return "timeout";
  if (
    error.name === "NoSuchKey" ||
    error.name === "NotFound" ||
    ("code" in error && error.code === "ENOENT")
  )
    return "original_missing";
  if (
    error.name === "AccessDenied" ||
    error.name === "InvalidAccessKeyId" ||
    error.name === "SignatureDoesNotMatch"
  )
    return "access_denied";
  return "storage_error";
}

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
      // Containment is decided on *real* paths, both sides: a symlinked upload
      // directory (a developer's `var` pointing elsewhere) must not turn every
      // stored original into a path-traversal rejection, and a sibling
      // directory sharing the prefix (`var/uploads-evil`) must not pass as
      // inside the upload root.
      const root = await realpath(resolve(resolveDir()));
      const resolved = resolve(locator);
      // The stored original may have been removed since the row was written;
      // realpathSync then throws ENOENT. Resolving the deepest existing
      // ancestor keeps the containment decision intact — a traversal attempt
      // through a non-existent path is still refused, not reported as missing.
      const path = await existingAncestor(resolved);
      if (path !== root && !path.startsWith(`${root}/`)) {
        throw new Error("ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR");
      }
      return readFile(resolved);
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
      if (parsed.bucket !== opts.bucket) throw new Error("ORIGINAL_BUCKET_NOT_ALLOWED");
      return opts.client.getObject(parsed);
    },
  };
}

/**
 * Keeps the write policy independent of historical read locators. Strict writes
 * fail when S3 is missing or unavailable; legacy local originals remain readable.
 * Development may explicitly choose local fallback for new writes.
 */
export function createOriginalStore(
  opts: ObjectStoreConfig & { client?: ObjectStoreClient },
): OriginalStore {
  const local = createLocalOriginalStore();
  if (!opts.endpoint) {
    if (!opts.strict) return local;
    return {
      async save() {
        throw new Error("OBJECT_STORE_NOT_CONFIGURED");
      },
      read: local.read,
    };
  }
  const s3 = createS3OriginalStore({
    client:
      opts.client ??
      createAwsS3Client({
        endpoint: opts.endpoint,
        accessKey: opts.accessKey,
        secretKey: opts.secretKey,
        region: opts.region,
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
      }),
    bucket: opts.bucket,
  });
  const writer = opts.strict ? s3 : createFallbackOriginalStore(s3, local);
  return {
    save: writer.save,
    read: (locator) => (parseS3Locator(locator) ? s3.read(locator) : local.read(locator)),
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
        // A stable code plus safe storage metadata, never the caught error:
        // an SDK error can carry the endpoint, request id and bucket/key, and
        // this line lands in the API log. `describeStorageError` reduces it to
        // what an operator needs to act on.
        console.warn(
          `object store put failed; falling back to local disk (${describeStorageError(error)})`,
        );
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
  /** Per-request ceiling in milliseconds; unset means no client-side timeout. */
  timeoutMs?: number;
}): ObjectStoreClient {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    maxAttempts: 1,
    // A hung socket would otherwise hold an upload open until the platform
    // default gives up; the operator-visible ceiling is configured instead.
    requestHandler: {
      requestTimeout: config.timeoutMs,
      connectionTimeout: config.timeoutMs,
    },
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
    async deleteObject({ bucket, key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export interface ObjectStoreConfig {
  endpoint?: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  /**
   * Demo/production writes require S3. Development can select strict S3 writes
   * or explicitly allow local fallback using `S3_STRICT=false`.
   */
  strict: boolean;
  /** Per-request ceiling for object-store calls; unset means no client timeout. */
  timeoutMs?: number;
}

const parseOptionalInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Demo/production always require S3 writes; only development/test may select
 * local fallback. Existing local locators remain readable in either mode.
 */
const strictObjectStore = (): boolean => {
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnv === "demo" || appEnv === "production") return true;
  const explicit = process.env.S3_STRICT?.trim().toLowerCase();
  return explicit === "true" || explicit === "1" || explicit === "on";
};

export function loadObjectStoreConfig(): ObjectStoreConfig {
  return {
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
    bucket: process.env.S3_BUCKET ?? "contract-originals",
    region: process.env.S3_REGION ?? "us-east-1",
    strict: strictObjectStore(),
    timeoutMs: parseOptionalInteger(process.env.S3_TIMEOUT_MS),
  };
}

export function createOriginalStoreFromEnv(
  config: ObjectStoreConfig = loadObjectStoreConfig(),
): OriginalStore {
  return createOriginalStore(config);
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
export async function readOriginal(
  locator: string,
  metadata?: Record<string, unknown> | null,
): Promise<Buffer> {
  const bytes = await createOriginalStoreFromEnv().read(locator);
  const sha256 = metadata?.originalSha256;
  const sizeBytes = metadata?.originalSizeBytes;
  if (sha256 === undefined && sizeBytes === undefined) return bytes;
  if (
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    !Number.isSafeInteger(sizeBytes)
  ) {
    throw new Error("ORIGINAL_INTEGRITY_METADATA_INVALID");
  }
  if (bytes.length !== sizeBytes || createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error("ORIGINAL_INTEGRITY_MISMATCH");
  }
  return bytes;
}

/**
 * Deletes one original this system wrote, addressed by the locator the save
 * returned. It exists for exactly one caller: an upload whose registration
 * failed after the bytes were persisted. The delete is refused unless the
 * locator names this deployment's configured object store and bucket — an
 * arbitrary `s3://other/key` from a database row is never a valid target.
 *
 * Returns true only when the store confirmed the object is gone; false means
 * the caller must report a recoverable orphan rather than claim cleanup.
 */
export async function removeOriginal(locator: string): Promise<boolean> {
  const config = loadObjectStoreConfig();
  const parsed = parseS3Locator(locator);
  if (!parsed) {
    // A local write: removing an unreferenced file inside UPLOAD_DIR is safe
    // and symmetric with the object-store path above. Containment is decided
    // on the deepest existing ancestor, because the file may already be gone.
    try {
      const root = await realpath(resolve(process.env.UPLOAD_DIR ?? "var/uploads"));
      const path = await existingAncestor(resolve(locator));
      if (path !== root && !path.startsWith(`${root}/`)) return false;
      await rm(resolve(locator), { force: true });
      return true;
    } catch {
      return false;
    }
  }
  if (!config.endpoint || parsed.bucket !== config.bucket) return false;
  const client = createAwsS3Client({
    endpoint: config.endpoint,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  try {
    // The real client always provides deleteObject; an injected test double
    // may not, and a missing capability must report an unreclaimed object
    // rather than claim it was removed.
    if (!client.deleteObject) return false;
    await client.deleteObject({ bucket: parsed.bucket, key: parsed.key });
    return true;
  } catch {
    return false;
  }
}
