import { eq } from "drizzle-orm";
import { createDb, type DrizzleDB } from "../../db/repositories";
import { type OcrProviderName, ocrSettings } from "../../db/schema";
import { apiKeyHint, openApiKey, sealApiKey } from "../../llm/api-key-crypto";
import { loadOcrConfig, type OcrConfig } from "./config";

/**
 * Persisted OCR configuration. Mirrors the `llm_providers` lifecycle on
 * purpose: the API key is sealed at rest with the same secret, the DTO carries
 * presence plus a masked hint instead of the key, and a blank key on an update
 * keeps the stored one so a settings edit never blanks a credential.
 */

/** The single row's id-free identity; the unique index enforces one row. */
export const OCR_SETTINGS_KEY = "singleton";

/** The OCR configuration as every endpoint returns it — never a raw key. */
export interface OcrSettings {
  provider: OcrProviderName;
  vlmEndpoint: string;
  vlmApiKeyConfigured: boolean;
  vlmApiKeyHint: string | null;
  vlmModel: string;
  vlmFallbackModel: string | null;
  mineruEndpoint: string;
  maxPages: number;
  scale: number;
  jpegQuality: number;
  concurrency: number;
  requestTimeoutMs: number;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  updatedAt: string;
  /**
   * Where this configuration came from: `env` while no row has been saved (the
   * `OCR_*` variables are in force), `stored` once an operator has saved from
   * the settings page. It is what the UI shows as 配置来源, and it is derived
   * from row presence rather than stored, so it cannot drift.
   */
  source: "stored" | "env";
}

/**
 * The update body. Every field optional so the page can PATCH a subset; an
 * absent or empty `vlmApiKey` keeps the stored key, matching how the
 * model-service page treats a blank key edit.
 */
export type OcrSettingsUpdate = {
  provider?: OcrProviderName;
  vlmEndpoint?: string;
  vlmApiKey?: string;
  vlmModel?: string;
  /** Explicit null clears the fallback model; an absent value keeps it. */
  vlmFallbackModel?: string | null;
  mineruEndpoint?: string;
  maxPages?: number;
  scale?: number;
  jpegQuality?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
};

/** A settings failure the route maps straight to a status. */
export class OcrSettingsRepositoryError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "OcrSettingsRepositoryError";
  }
}

/** Clamps a numeric field into a sane range; junk falls back rather than storing. */
const boundedInt = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

const boundedNumber = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

type Row = typeof ocrSettings.$inferSelect;

/** A stored row as the recognizer's configuration; the key stays sealed. */
const existingToConfig = (row: Row): OcrConfig => ({
  provider: row.provider,
  endpoint: row.vlmEndpoint,
  apiKey: openApiKey(row.vlmApiKey),
  model: row.vlmModel,
  fallbackModel: row.vlmFallbackModel,
  maxPages: row.maxPages,
  scale: row.scale,
  jpegQuality: row.jpegQuality,
  concurrency: row.concurrency,
  requestTimeoutMs: row.requestTimeoutMs,
  mineruEndpoint: row.mineruEndpoint,
});

const toSettings = (row: Row): OcrSettings => ({
  provider: row.provider,
  vlmEndpoint: row.vlmEndpoint,
  vlmApiKeyConfigured: row.vlmApiKey.length > 0,
  vlmApiKeyHint: apiKeyHint(row.vlmApiKey),
  vlmModel: row.vlmModel,
  vlmFallbackModel: row.vlmFallbackModel,
  mineruEndpoint: row.mineruEndpoint,
  maxPages: row.maxPages,
  scale: row.scale,
  jpegQuality: row.jpegQuality,
  concurrency: row.concurrency,
  requestTimeoutMs: row.requestTimeoutMs,
  lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  lastCheckOk: row.lastCheckOk,
  lastCheckError: row.lastCheckError,
  updatedAt: row.updatedAt.toISOString(),
  source: "stored",
});

/** Validates a provider name without trusting the request body. */
const asProvider = (value: string): OcrProviderName => {
  if (value === "off" || value === "vlm" || value === "mineru") return value;
  throw new OcrSettingsRepositoryError(400, "OCR 提供方必须是 off / vlm / mineru");
};

const asEndpoint = (value: string | undefined, field: string): string => {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new OcrSettingsRepositoryError(400, `${field} 不是合法的 URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OcrSettingsRepositoryError(400, `${field} 只支持 http/https`);
  }
  return trimmed;
};

/**
 * The OCR-settings operations the routes and the runtime registry share: the
 * Drizzle repository is the production implementation, and an in-memory stub
 * backs `createApp` when no database is wired in (unit tests), keeping the
 * route set identical without a live pool.
 */
export interface OcrSettingsStore {
  /** The stored row, or null while the environment is still in force. */
  get(): Promise<OcrSettings | null>;
  /** The raw configuration the recognizer is built from, or null when unset. */
  rawConfig(): Promise<OcrConfig | null>;
  /** Inserts or updates the single row; a blank key keeps the stored one. */
  save(update: OcrSettingsUpdate): Promise<OcrSettings>;
  /** Records the outcome of the latest probe against the stored config. */
  recordCheck(ok: boolean, error: string | null): Promise<void>;
}

export class OcrSettingsRepository implements OcrSettingsStore {
  constructor(private readonly db: DrizzleDB) {}

  async get(): Promise<OcrSettings | null> {
    const [row] = await this.db.select().from(ocrSettings).limit(1);
    return row ? toSettings(row) : null;
  }

  async rawConfig(): Promise<OcrConfig | null> {
    const [row] = await this.db.select().from(ocrSettings).limit(1);
    if (!row) return null;
    return existingToConfig(row);
  }

  async save(update: OcrSettingsUpdate): Promise<OcrSettings> {
    const [existing] = await this.db.select().from(ocrSettings).limit(1);
    // The configuration the page was showing when it rendered: the stored row,
    // or the environment while none has been saved. A first save therefore
    // keeps the environment's key and wiring instead of resetting to column
    // defaults — bootstrap is bootstrap only until a row exists.
    const baseline = existing ? existingToConfig(existing) : loadOcrConfig();
    const provider =
      update.provider === undefined ? baseline.provider : asProvider(update.provider);
    const vlmEndpoint =
      update.vlmEndpoint === undefined
        ? baseline.endpoint
        : asEndpoint(update.vlmEndpoint, "视觉模型接口地址");
    const mineruEndpoint =
      update.mineruEndpoint === undefined
        ? baseline.mineruEndpoint
        : asEndpoint(update.mineruEndpoint, "MinerU 接口地址");
    const model = update.vlmModel === undefined ? baseline.model : update.vlmModel.trim();
    const fallbackModel =
      update.vlmFallbackModel === undefined
        ? baseline.fallbackModel
        : update.vlmFallbackModel?.trim() || null;
    const values = {
      provider,
      vlmEndpoint,
      vlmModel: model,
      vlmFallbackModel: fallbackModel,
      mineruEndpoint,
      maxPages: boundedInt(update.maxPages, baseline.maxPages, 1, 1000),
      scale: boundedNumber(update.scale, baseline.scale, 0.5, 4),
      jpegQuality: boundedInt(update.jpegQuality, baseline.jpegQuality, 30, 100),
      concurrency: boundedInt(update.concurrency, baseline.concurrency, 1, 16),
      requestTimeoutMs: boundedInt(
        update.requestTimeoutMs,
        baseline.requestTimeoutMs,
        1000,
        600000,
      ),
      updatedAt: new Date(),
    };
    // A blank key keeps the credential already in force — stored, or the
    // environment's on the first save. Only a non-empty value reseals.
    const apiKey = update.vlmApiKey?.trim();
    const sealed =
      apiKey !== undefined && apiKey.length > 0
        ? { vlmApiKey: sealApiKey(apiKey) }
        : { vlmApiKey: sealApiKey(baseline.apiKey) };
    if (!existing) {
      const [row] = await this.db
        .insert(ocrSettings)
        .values({ ...values, ...sealed, singletonKey: OCR_SETTINGS_KEY })
        .returning();
      return toSettings(row);
    }
    const [row] = await this.db
      .update(ocrSettings)
      .set({ ...values, ...sealed })
      .where(eq(ocrSettings.id, existing.id))
      .returning();
    return toSettings(row);
  }

  async recordCheck(ok: boolean, error: string | null): Promise<void> {
    const [existing] = await this.db.select({ id: ocrSettings.id }).from(ocrSettings).limit(1);
    if (!existing) return;
    await this.db
      .update(ocrSettings)
      .set({
        lastCheckedAt: new Date(),
        lastCheckOk: ok,
        lastCheckError: error,
        updatedAt: new Date(),
      })
      .where(eq(ocrSettings.id, existing.id));
  }
}

/**
 * The in-memory stand-in for tests and for a `createApp` without a database.
 * The blank-key preservation rule is shared, so a test that pins credential
 * behaviour exercises the same contract the SQL repository implements.
 */
export function createMemoryOcrSettingsStore(): OcrSettingsStore {
  let row: Row | null = null;

  const stamp = (): Date => new Date();

  const insert = (values: Partial<Row>, createdAt: Date): Row => ({
    id: crypto.randomUUID(),
    singletonKey: OCR_SETTINGS_KEY,
    provider: "off",
    vlmEndpoint: "",
    vlmApiKey: "",
    vlmModel: "",
    vlmFallbackModel: null,
    mineruEndpoint: "",
    maxPages: 40,
    scale: 2,
    jpegQuality: 85,
    concurrency: 3,
    requestTimeoutMs: 120000,
    lastCheckedAt: null,
    lastCheckOk: null,
    lastCheckError: null,
    ...values,
    createdAt,
    updatedAt: createdAt,
  });

  return {
    async get() {
      return row ? toSettings(row) : null;
    },
    async rawConfig() {
      if (!row) return null;
      return existingToConfig(row);
    },
    async save(update) {
      const createdAt = row?.createdAt ?? stamp();
      // The configuration the page was showing: the stored row, or the
      // environment while none has been saved. A first save therefore keeps
      // the environment's key and wiring rather than resetting to defaults.
      const baseline = row ? existingToConfig(row) : loadOcrConfig();
      const values: Partial<Row> = {
        ...(update.provider === undefined ? {} : { provider: asProvider(update.provider) }),
        ...(update.vlmEndpoint === undefined
          ? {}
          : { vlmEndpoint: asEndpoint(update.vlmEndpoint, "视觉模型接口地址") }),
        ...(update.mineruEndpoint === undefined
          ? {}
          : { mineruEndpoint: asEndpoint(update.mineruEndpoint, "MinerU 接口地址") }),
        ...(update.vlmModel === undefined ? {} : { vlmModel: update.vlmModel.trim() }),
        ...(update.vlmFallbackModel === undefined
          ? {}
          : { vlmFallbackModel: update.vlmFallbackModel?.trim() || null }),
        ...(update.provider === undefined ? {} : { provider: asProvider(update.provider) }),
        ...(update.vlmEndpoint === undefined
          ? {}
          : { vlmEndpoint: asEndpoint(update.vlmEndpoint, "视觉模型接口地址") }),
        maxPages: boundedInt(update.maxPages, baseline.maxPages, 1, 1000),
        scale: boundedNumber(update.scale, baseline.scale, 0.5, 4),
        jpegQuality: boundedInt(update.jpegQuality, baseline.jpegQuality, 30, 100),
        concurrency: boundedInt(update.concurrency, baseline.concurrency, 1, 16),
        requestTimeoutMs: boundedInt(
          update.requestTimeoutMs,
          baseline.requestTimeoutMs,
          1000,
          600000,
        ),
      };
      // A blank key keeps the credential already in force — stored, or the
      // environment's on the first save. Only a non-empty value reseals.
      const apiKey = update.vlmApiKey?.trim();
      values.vlmApiKey =
        apiKey !== undefined && apiKey.length > 0
          ? sealApiKey(apiKey)
          : sealApiKey(baseline.apiKey);
      if (row) {
        row = { ...row, ...values, updatedAt: stamp() };
      } else {
        // The environment is the baseline the operator was shown, so the first
        // row carries it rather than the column defaults: a save that never
        // touched a field must not silently reset what the page displayed.
        row = insert(
          {
            provider: baseline.provider,
            vlmEndpoint: baseline.endpoint,
            vlmModel: baseline.model,
            vlmFallbackModel: baseline.fallbackModel,
            mineruEndpoint: baseline.mineruEndpoint,
            maxPages: baseline.maxPages,
            scale: baseline.scale,
            jpegQuality: baseline.jpegQuality,
            concurrency: baseline.concurrency,
            requestTimeoutMs: baseline.requestTimeoutMs,
            ...values,
          },
          createdAt,
        );
      }
      return toSettings(row);
    },
    async recordCheck(ok, error) {
      if (!row) return;
      row = {
        ...row,
        lastCheckedAt: stamp(),
        lastCheckOk: ok,
        lastCheckError: error,
        updatedAt: stamp(),
      };
    },
  };
}

/**
 * Accepts a ready `db` (the shared pool from `createDb`) or a connection string
 * for callers that only need this repository; a string opens a private pool.
 */
export function createOcrSettingsRepository(input: string | DrizzleDB): OcrSettingsRepository {
  const db = typeof input === "string" ? createDb(input).db : input;
  return new OcrSettingsRepository(db);
}
