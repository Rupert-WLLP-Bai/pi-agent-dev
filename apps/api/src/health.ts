import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ApiConfig } from "./config";
import type { OcrPort } from "./document/ocr";
import { createAwsS3Client, type ObjectStoreConfig } from "./document/original-store";
import type { VerificationCache } from "./qcc/cache";

/**
 * One integration's health line. `target` names the thing being probed in a
 * form safe to render and log — credentials are always stripped, never the
 * raw connection string. `detail` carries the failure note, or null when the
 * connection is healthy.
 */
export interface HealthConnection {
  ok: boolean;
  target: string;
  detail: string | null;
}

/**
 * The integration-health snapshot `GET /api/health` returns. Credentials are
 * reported as presence only — never as values — so the endpoint is safe to
 * poll from the browser and to log.
 *
 * `status` is fatal-only: it is `unavailable` when the database or the
 * dispatcher is down. Redis and object storage are degradable — their
 * `connections.*.ok` flips without changing `status`.
 */
export interface ApiHealth {
  status: "ok" | "unavailable";
  database: boolean;
  dispatcher: boolean;
  /** Which agent implementation is wired in; "fake" needs no LLM credentials. */
  agentMode: "pi" | "fake";
  /** Whether the QCC bearer token is present, not the token itself. */
  qccConfigured: boolean;
  /** Whether the real agent's LLM key is present, not the key itself. */
  llmConfigured: boolean;
  connections: {
    database: HealthConnection;
    redis: HealthConnection;
    objectStore: HealthConnection;
    llm: HealthConnection;
    qcc: HealthConnection;
    /** The scanned-document recognizer; degradable — only scans need it. */
    ocr: HealthConnection;
    dispatcher: HealthConnection;
  };
}

/**
 * Everything `buildHealthSnapshot` needs, injected so the builder is pure and
 * unit-testable without a database, Redis, S3, or a live agent.
 */
export interface HealthInputs {
  config: ApiConfig;
  /** `deps.repository.ping()` from the health route. */
  databaseOk: boolean;
  /** `deps.dispatcher.isStarted` from the health route. */
  dispatcherOk: boolean;
  redis: {
    /** `REDIS_URL` as read from the environment, or undefined when unset. */
    url: string | undefined;
    /** The connected cache client, or null when Redis is off or unreachable. */
    client: VerificationCache | null;
  };
  objectStore: ObjectStoreConfig;
  /**
   * The agent's LLM wiring. Always present so consumers never null-check it;
   * `providerName`, `endpoint`, and `model` are null on the env fallback.
   */
  agent: {
    mode: "pi" | "fake";
    providerName: string | null;
    endpoint: string | null;
    model: string | null;
    configured: boolean;
  };
  qcc: {
    companyEndpoint: string;
    riskEndpoint: string;
    tokenConfigured: boolean;
  };
  /** The configured recognizer. Its own `probe` reports reachability. */
  ocr: OcrPort;
}

/** A dead dependency must not stall `GET /api/health`; each network probe is capped. */
const PROBE_TIMEOUT_MS = 2_000;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const connection = (
  ok: boolean,
  target: string,
  detail: string | null = null,
): HealthConnection => ({ ok, target, detail });

/** Reject a hung probe after `ms` without leaking the timer. */
const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * `host:port/database` from a connection string with credentials stripped.
 * Falls back to the raw string minus a `user:pass@` prefix when it will not
 * parse as a URL.
 */
const databaseTarget = (databaseUrl: string): string => {
  try {
    const url = new URL(databaseUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return databaseUrl.replace(/\/\/[^@/]*@/, "//");
  }
};

/** `host:port` from `REDIS_URL`, with any `user:pass@` credentials removed. */
const redisTarget = (redisUrl: string): string => {
  try {
    return new URL(redisUrl).host;
  } catch {
    return redisUrl
      .replace(/\/\/[^@/]*@/, "//")
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "");
  }
};

/** The host shared by both QCC MCP endpoints; the paths are streaming MCP routes. */
const endpointHost = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
};

/** The local fallback directory, resolved the same way the original store resolves it. */
const uploadDir = (): string => resolve(process.env.UPLOAD_DIR ?? "var/uploads");

const databaseConnection = (inputs: HealthInputs): HealthConnection =>
  connection(inputs.databaseOk, databaseTarget(inputs.config.databaseUrl));

const redisConnection = async (inputs: HealthInputs): Promise<HealthConnection> => {
  const url = inputs.redis.url?.trim();
  if (url === undefined || url === "") {
    return connection(false, "未配置", "未设置 REDIS_URL，企查查结果不做缓存");
  }
  const target = redisTarget(url);
  const client = inputs.redis.client;
  if (!client?.ping) {
    return connection(false, target, "Redis 客户端未连接，企查查结果不做缓存");
  }
  try {
    const ok = await withTimeout(client.ping(), PROBE_TIMEOUT_MS);
    return connection(ok, target, ok ? null : "Redis PING 失败，企查查结果不做缓存");
  } catch (error) {
    return connection(false, target, describeError(error));
  }
};

const objectStoreConnection = async (config: ObjectStoreConfig): Promise<HealthConnection> => {
  if (config.endpoint) {
    const target = `s3://${config.bucket} @ ${config.endpoint}`;
    try {
      const client = createAwsS3Client({
        endpoint: config.endpoint,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        region: config.region,
      });
      if (!client.headBucket) return connection(true, target);
      const ok = await withTimeout(client.headBucket(config.bucket), PROBE_TIMEOUT_MS);
      return connection(ok, target, ok ? null : "HeadBucket 失败，无法访问对象存储桶");
    } catch (error) {
      return connection(false, target, describeError(error));
    }
  }
  const dir = uploadDir();
  const target = `${dir}（本地目录）`;
  try {
    await mkdir(dir, { recursive: true });
    const info = await stat(dir);
    const ok = info.isDirectory();
    return connection(ok, target, ok ? null : "路径不是目录");
  } catch (error) {
    return connection(false, target, describeError(error));
  }
};

const llmConnection = (agent: HealthInputs["agent"]): HealthConnection => {
  const target = agent.model && agent.endpoint ? `${agent.model} @ ${agent.endpoint}` : "未配置";
  if (agent.configured) return connection(true, target);
  return connection(
    false,
    target,
    target === "未配置" ? "未配置 LLM，使用模拟智能体" : "未配置 LLM 凭据",
  );
};

const qccConnection = (qcc: HealthInputs["qcc"]): HealthConnection =>
  connection(
    qcc.tokenConfigured,
    `${endpointHost(qcc.companyEndpoint)} · 公司核验 + 风险扫描`,
    qcc.tokenConfigured ? null : "未设置 QCC_TOKEN，主体核验使用固定样本",
  );

const dispatcherConnection = (inputs: HealthInputs): HealthConnection =>
  connection(
    inputs.dispatcherOk,
    `worker 池（MAX_CONCURRENT_AUDITS=${inputs.config.maxConcurrentAudits}）`,
  );

const ocrConnection = async (ocr: OcrPort): Promise<HealthConnection> => {
  if (!ocr.enabled) {
    const probe = await ocr.probe();
    return connection(false, ocr.target, probe.detail);
  }
  try {
    const probe = await withTimeout(ocr.probe(), PROBE_TIMEOUT_MS);
    return connection(probe.ok, ocr.target, probe.detail);
  } catch (error) {
    return connection(false, ocr.target, describeError(error));
  }
};

/**
 * Builds the `GET /api/health` body from injected probes. Pure: it never
 * touches a database, queue, or agent directly, and it never throws — any
 * probe failure becomes `{ ok: false, detail }` on that connection, leaving
 * the fatal-only `status` rule intact.
 */
export async function buildHealthSnapshot(inputs: HealthInputs): Promise<ApiHealth> {
  const [database, redis, objectStore, llm, qcc, ocr, dispatcher] = await Promise.all([
    databaseConnection(inputs),
    redisConnection(inputs),
    objectStoreConnection(inputs.objectStore),
    llmConnection(inputs.agent),
    qccConnection(inputs.qcc),
    ocrConnection(inputs.ocr),
    dispatcherConnection(inputs),
  ]);
  return {
    status: inputs.databaseOk && inputs.dispatcherOk ? "ok" : "unavailable",
    database: inputs.databaseOk,
    dispatcher: inputs.dispatcherOk,
    agentMode: inputs.config.agentMode,
    qccConfigured: inputs.qcc.tokenConfigured,
    llmConfigured: inputs.config.llmConfigured,
    connections: { database, redis, objectStore, llm, qcc, ocr, dispatcher },
  };
}
