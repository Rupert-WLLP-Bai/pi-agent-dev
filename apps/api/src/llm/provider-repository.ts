import { eq } from "drizzle-orm";
import { createDb, type DrizzleDB } from "../db/repositories";
import { llmProviders } from "../db/schema";
import { apiKeyHint, openApiKey, sealApiKey } from "./api-key-crypto";
import { assertAllowedLlmEndpoint } from "./endpoint-allowlist";

/**
 * Model-service persistence for the OpenAI-compatible providers an audit run
 * can use. Kept in its own module because the lifecycle (create, activate,
 * delete-with-succession) is one coherent unit, and because the DTO here is
 * the one the console renders: it never carries `api_key`, only whether a key
 * is configured and its last four characters as a mask.
 */

/** The raw config one audit run needs. Never serialized to a response body. */
export interface ActiveProviderConfig {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  maxInput: number;
  maxOutput: number;
}

/**
 * The provider as every endpoint returns it. `apiKeyConfigured`/`apiKeyHint`
 * stand in for the credential so a raw key can never leak through a response.
 */
export interface LlmProvider {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  maxInput: number;
  maxOutput: number;
  enabled: boolean;
  isActive: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The body that opens a provider. `name`/`endpoint`/`model`/key are required. */
export interface LlmProviderInput {
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  maxInput?: number;
  maxOutput?: number;
  enabled?: boolean;
}

/**
 * A revision body: every field optional, and an absent or empty `apiKey`
 * leaves the stored key in place so a settings edit never blanks a credential.
 */
export type LlmProviderUpdate = Partial<LlmProviderInput>;

/** The credential an outbound probe needs; resolved only inside the API. */
export interface ProviderCredentials {
  endpoint: string;
  apiKey: string;
  model: string;
}

/**
 * A model-service failure the route turns straight into an HTTP status: 404
 * for an unknown id, 409 for a duplicate name, 400 for a caller mistake such
 * as opening a provider without a key.
 */
export class LlmProviderRepositoryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "LlmProviderRepositoryError";
  }
}

export const DEFAULT_MAX_INPUT = 128000;
export const DEFAULT_MAX_OUTPUT = 4096;

/** The columns the DTO reads; both the Drizzle row and the memory stub fit. */
interface ProviderRow {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  maxInput: number;
  maxOutput: number;
  enabled: boolean;
  isActive: boolean;
  lastCheckedAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toProvider = (row: ProviderRow): LlmProvider => ({
  id: row.id,
  name: row.name,
  endpoint: row.endpoint,
  model: row.model,
  maxInput: row.maxInput,
  maxOutput: row.maxOutput,
  enabled: row.enabled,
  isActive: row.isActive,
  apiKeyConfigured: row.apiKey.length > 0,
  apiKeyHint: apiKeyHint(row.apiKey),
  lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  lastCheckOk: row.lastCheckOk,
  lastCheckError: row.lastCheckError,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The model-service operations the routes and the runtime registry share. The
 * Drizzle repository is the production implementation; an in-memory stub backs
 * `createApp` when no database is wired in (unit tests), keeping the route set
 * identical without a live pool.
 */
export interface LlmProviderStore {
  list(): Promise<LlmProvider[]>;
  get(id: string): Promise<LlmProvider | null>;
  create(input: LlmProviderInput): Promise<LlmProvider>;
  update(id: string, patch: LlmProviderUpdate): Promise<LlmProvider>;
  remove(id: string): Promise<void>;
  activate(id: string): Promise<LlmProvider>;
  /** Enabled rows, oldest first — the succession order a delete promotes from. */
  listEnabled(): Promise<LlmProvider[]>;
  /** The active row's raw config, or null when none is active. */
  activeConfig(): Promise<ActiveProviderConfig | null>;
  /** Probe credentials for one row, resolved inside the API only. */
  credentialsFor(id: string): Promise<ProviderCredentials | null>;
  recordCheck(id: string, ok: boolean, error: string | null): Promise<void>;
}

export class LlmProviderRepository implements LlmProviderStore {
  constructor(private readonly db: DrizzleDB) {}

  async list(): Promise<LlmProvider[]> {
    const rows = await this.db
      .select()
      .from(llmProviders)
      .orderBy(llmProviders.createdAt, llmProviders.name);
    return rows.map(toProvider);
  }

  async get(id: string): Promise<LlmProvider | null> {
    const [row] = await this.db.select().from(llmProviders).where(eq(llmProviders.id, id)).limit(1);
    return row ? toProvider(row) : null;
  }

  async create(input: LlmProviderInput): Promise<LlmProvider> {
    const apiKey = input.apiKey?.trim() ?? "";
    if (apiKey.length === 0) {
      throw new LlmProviderRepositoryError(400, "API Key 不能为空");
    }
    try {
      assertAllowedLlmEndpoint(input.endpoint);
    } catch {
      throw new LlmProviderRepositoryError(400, "模型服务地址不在允许范围内");
    }
    const [clash] = await this.db
      .select({ id: llmProviders.id })
      .from(llmProviders)
      .where(eq(llmProviders.name, input.name))
      .limit(1);
    if (clash) {
      throw new LlmProviderRepositoryError(409, "已存在同名模型服务");
    }
    const [row] = await this.db
      .insert(llmProviders)
      .values({
        name: input.name,
        endpoint: input.endpoint,
        model: input.model,
        apiKey: sealApiKey(apiKey),
        maxInput: input.maxInput ?? DEFAULT_MAX_INPUT,
        maxOutput: input.maxOutput ?? DEFAULT_MAX_OUTPUT,
        enabled: input.enabled ?? true,
      })
      .returning();
    return toProvider(row);
  }

  async update(id: string, patch: LlmProviderUpdate): Promise<LlmProvider> {
    const [existing] = await this.db
      .select()
      .from(llmProviders)
      .where(eq(llmProviders.id, id))
      .limit(1);
    if (!existing) {
      throw new LlmProviderRepositoryError(404, "模型服务不存在");
    }
    if (patch.endpoint !== undefined) {
      try {
        assertAllowedLlmEndpoint(patch.endpoint);
      } catch {
        throw new LlmProviderRepositoryError(400, "模型服务地址不在允许范围内");
      }
    }
    if (patch.name !== undefined && patch.name !== existing.name) {
      const [clash] = await this.db
        .select({ id: llmProviders.id })
        .from(llmProviders)
        .where(eq(llmProviders.name, patch.name))
        .limit(1);
      if (clash) {
        throw new LlmProviderRepositoryError(409, "已存在同名模型服务");
      }
    }
    // An absent or empty key keeps the stored one; the update never blanks it.
    const apiKey = patch.apiKey?.trim();
    const [row] = await this.db
      .update(llmProviders)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.endpoint !== undefined ? { endpoint: patch.endpoint } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey: sealApiKey(apiKey) } : {}),
        ...(patch.maxInput !== undefined ? { maxInput: patch.maxInput } : {}),
        ...(patch.maxOutput !== undefined ? { maxOutput: patch.maxOutput } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(llmProviders.id, id))
      .returning();
    return toProvider(row);
  }

  /**
   * Deletes one row. Deleting the active row promotes the oldest enabled
   * successor in the same transaction, so the runtime never points at a row
   * that is gone; when none remains the caller falls back to the environment.
   */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(llmProviders).where(eq(llmProviders.id, id)).limit(1);
      if (!row) {
        throw new LlmProviderRepositoryError(404, "模型服务不存在");
      }
      await tx.delete(llmProviders).where(eq(llmProviders.id, id));
      if (!row.isActive) return;
      const [successor] = await tx
        .select()
        .from(llmProviders)
        .where(eq(llmProviders.enabled, true))
        .orderBy(llmProviders.createdAt, llmProviders.name)
        .limit(1);
      if (successor) {
        await tx
          .update(llmProviders)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(llmProviders.id, successor.id));
      }
    });
  }

  /**
   * Makes one row the active provider: clears every `is_active` then sets the
   * target, both in one transaction so readers never see zero or two active
   * rows. The partial unique index is the backstop if this is ever bypassed.
   */
  async activate(id: string): Promise<LlmProvider> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(llmProviders).where(eq(llmProviders.id, id)).limit(1);
      if (!row) {
        throw new LlmProviderRepositoryError(404, "模型服务不存在");
      }
      await tx
        .update(llmProviders)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(llmProviders.isActive, true));
      const [updated] = await tx
        .update(llmProviders)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(llmProviders.id, id))
        .returning();
      return toProvider(updated);
    });
  }

  async listEnabled(): Promise<LlmProvider[]> {
    const rows = await this.db
      .select()
      .from(llmProviders)
      .where(eq(llmProviders.enabled, true))
      .orderBy(llmProviders.createdAt, llmProviders.name);
    return rows.map(toProvider);
  }

  async activeConfig(): Promise<ActiveProviderConfig | null> {
    const [row] = await this.db
      .select()
      .from(llmProviders)
      .where(eq(llmProviders.isActive, true))
      .limit(1);
    if (!row) return null;
    return {
      name: row.name,
      endpoint: row.endpoint,
      apiKey: openApiKey(row.apiKey),
      model: row.model,
      maxInput: row.maxInput,
      maxOutput: row.maxOutput,
    };
  }

  async credentialsFor(id: string): Promise<ProviderCredentials | null> {
    const [row] = await this.db
      .select({
        endpoint: llmProviders.endpoint,
        apiKey: llmProviders.apiKey,
        model: llmProviders.model,
      })
      .from(llmProviders)
      .where(eq(llmProviders.id, id))
      .limit(1);
    if (!row) return null;
    return {
      endpoint: row.endpoint,
      apiKey: openApiKey(row.apiKey),
      model: row.model,
    };
  }

  async recordCheck(id: string, ok: boolean, error: string | null): Promise<void> {
    await this.db
      .update(llmProviders)
      .set({
        lastCheckedAt: new Date(),
        lastCheckOk: ok,
        lastCheckError: error,
        updatedAt: new Date(),
      })
      .where(eq(llmProviders.id, id));
  }
}

/**
 * An in-memory store with the same contract, so a caller without a database
 * (unit tests) still gets the full route set. Succession and activation mirror
 * the SQL repository, including the "at most one active row" invariant.
 */
export function createMemoryLlmProviderStore(): LlmProviderStore {
  const rows = new Map<string, ProviderRow>();

  const ordered = (): ProviderRow[] =>
    [...rows.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name),
    );

  const find = (id: string): ProviderRow => {
    const row = rows.get(id);
    if (!row) throw new LlmProviderRepositoryError(404, "模型服务不存在");
    return row;
  };

  return {
    async list() {
      return ordered().map(toProvider);
    },
    async get(id) {
      const row = rows.get(id);
      return row ? toProvider(row) : null;
    },
    async create(input) {
      const apiKey = input.apiKey?.trim() ?? "";
      if (apiKey.length === 0) throw new LlmProviderRepositoryError(400, "API Key 不能为空");
      try {
        assertAllowedLlmEndpoint(input.endpoint);
      } catch {
        throw new LlmProviderRepositoryError(400, "模型服务地址不在允许范围内");
      }
      if ([...rows.values()].some((row) => row.name === input.name)) {
        throw new LlmProviderRepositoryError(409, "已存在同名模型服务");
      }
      const timestamp = new Date();
      const row: ProviderRow = {
        id: crypto.randomUUID(),
        name: input.name,
        endpoint: input.endpoint,
        model: input.model,
        apiKey: sealApiKey(apiKey),
        maxInput: input.maxInput ?? DEFAULT_MAX_INPUT,
        maxOutput: input.maxOutput ?? DEFAULT_MAX_OUTPUT,
        enabled: input.enabled ?? true,
        isActive: false,
        lastCheckedAt: null,
        lastCheckOk: null,
        lastCheckError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      rows.set(row.id, row);
      return toProvider(row);
    },
    async update(id, patch) {
      const row = find(id);
      if (patch.name !== undefined && patch.name !== row.name) {
        if ([...rows.values()].some((other) => other.name === patch.name)) {
          throw new LlmProviderRepositoryError(409, "已存在同名模型服务");
        }
      }
      const apiKey = patch.apiKey?.trim();
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.endpoint !== undefined) {
        try {
          assertAllowedLlmEndpoint(patch.endpoint);
        } catch {
          throw new LlmProviderRepositoryError(400, "模型服务地址不在允许范围内");
        }
        row.endpoint = patch.endpoint;
      }
      if (patch.model !== undefined) row.model = patch.model;
      if (apiKey !== undefined && apiKey.length > 0) row.apiKey = sealApiKey(apiKey);
      if (patch.maxInput !== undefined) row.maxInput = patch.maxInput;
      if (patch.maxOutput !== undefined) row.maxOutput = patch.maxOutput;
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      row.updatedAt = new Date();
      return toProvider(row);
    },
    async remove(id) {
      const row = find(id);
      rows.delete(row.id);
      if (!row.isActive) return;
      const successor = ordered().find((candidate) => candidate.enabled);
      if (successor) {
        successor.isActive = true;
        successor.updatedAt = new Date();
      }
    },
    async activate(id) {
      const row = find(id);
      for (const other of rows.values()) {
        if (other.isActive && other.id !== id) {
          other.isActive = false;
          other.updatedAt = new Date();
        }
      }
      row.isActive = true;
      row.updatedAt = new Date();
      return toProvider(row);
    },
    async listEnabled() {
      return ordered()
        .filter((row) => row.enabled)
        .map(toProvider);
    },
    async activeConfig() {
      const row = [...rows.values()].find((candidate) => candidate.isActive);
      if (!row) return null;
      return {
        name: row.name,
        endpoint: row.endpoint,
        apiKey: openApiKey(row.apiKey),
        model: row.model,
        maxInput: row.maxInput,
        maxOutput: row.maxOutput,
      };
    },
    async credentialsFor(id) {
      const row = rows.get(id);
      return row
        ? { endpoint: row.endpoint, apiKey: openApiKey(row.apiKey), model: row.model }
        : null;
    },
    async recordCheck(id, ok, error) {
      const row = rows.get(id);
      if (!row) return;
      row.lastCheckedAt = new Date();
      row.lastCheckOk = ok;
      row.lastCheckError = error;
      row.updatedAt = new Date();
    },
  };
}

/**
 * Accepts a ready `db` (the shared pool from `createDb`) or a connection string
 * for callers that only need this repository; a string opens a private pool.
 */
export function createLlmProviderRepository(input: string | DrizzleDB): LlmProviderRepository {
  const db = typeof input === "string" ? createDb(input).db : input;
  return new LlmProviderRepository(db);
}
