import type {
  SubjectVerificationOutcome,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import { createClient } from "redis";

/** Matches the QCC adapter's 7-day source-record expiry. */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const cacheKeyFor = (subject: string): string => `qcc:v1:${subject.trim().normalize("NFC")}`;

/**
 * The cache operations the QCC wrapper needs. Tests inject an in-memory map;
 * production uses Redis. Failures must never fail an audit.
 */
export interface VerificationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  ping?(): Promise<boolean>;
}

/**
 * Wraps a real QCC port so a repeated party name reuses the last outcome
 * instead of calling MCP again. A cache miss, a down Redis, or a null cache
 * all fall through to the inner port. A hit still produces a new Source
 * Record per case — this layer only skips the network call.
 */
export function createCachedSubjectVerificationPort(
  inner: SubjectVerificationPort,
  cache: VerificationCache | null,
  ttlSeconds = CACHE_TTL_SECONDS,
): SubjectVerificationPort {
  return {
    provider: inner.provider,
    tool: inner.tool,
    async verify(subject, signal) {
      if (cache === null) return inner.verify(subject, signal);
      const key = cacheKeyFor(subject);
      try {
        const hit = await cache.get(key);
        if (hit !== null) return JSON.parse(hit) as SubjectVerificationOutcome;
      } catch (error) {
        console.warn("qcc cache get failed; calling provider", error);
      }
      const result = await inner.verify(subject, signal);
      try {
        await cache.set(key, JSON.stringify(result), ttlSeconds);
      } catch (error) {
        console.warn("qcc cache set failed; continuing without cache", error);
      }
      return result;
    },
  };
}

export async function connectRedis(url: string | undefined): Promise<VerificationCache | null> {
  if (url === undefined || url.trim() === "") return null;
  const client = createClient({ url: url.trim() });
  client.on("error", (error) => {
    console.warn("redis client error", error);
  });
  try {
    await client.connect();
  } catch (error) {
    console.warn("redis connect failed; QCC cache disabled", error);
    return null;
  }
  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ttlSeconds) {
      await client.set(key, value, { EX: ttlSeconds });
    },
    async ping() {
      try {
        return (await client.ping()) === "PONG";
      } catch {
        return false;
      }
    },
  };
}
