import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  SubjectVerificationOutcome,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import {
  cacheKeyFor,
  connectRedis,
  createCachedSubjectVerificationPort,
  type VerificationCache,
} from "../../apps/api/src/qcc/cache";

/**
 * Redis coverage: the cache is an optimisation, so the contract is about what
 * happens when it is *not* there. A miss, a dead connection and a rejected
 * promise must all fall through to the inner port and must never fail the
 * verification — a slow audit beats a failed one.
 */

let redis: VerificationCache | null = null;
let unavailable: string | null = null;

const url = process.env.REDIS_URL?.trim() ?? "";

beforeAll(async () => {
  if (url === "") {
    unavailable = "REDIS_URL not configured";
    return;
  }
  redis = await connectRedis(url);
  if (redis === null) unavailable = "Redis did not accept a connection";
});

afterAll(async () => {
  // connectRedis keeps its client open; the process exits on its own, so there
  // is nothing to close here without reaching into the client.
});

const outcome: SubjectVerificationOutcome = {
  status: "RESOLVED",
  candidates: [],
  matched: null,
  dimensions: [{ factor: "经营风险", count: 0, detailTool: "risk" }],
  summary: "合成主体，无风险记录",
  capturedAt: "2026-10-15T00:00:00.000Z",
  expiresAt: null,
  failureReason: null,
};

const countingPort = (): SubjectVerificationPort & { calls: number } => {
  const port = {
    calls: 0,
    provider: "fixture",
    tool: "subject",
    async verify() {
      port.calls += 1;
      return outcome;
    },
  };
  return port;
};

describe("integration: Redis verification cache", () => {
  test("an unset REDIS_URL disables the cache without touching the port", async () => {
    const inner = countingPort();
    const cached = createCachedSubjectVerificationPort(inner, null);
    const first = await cached.verify("重庆华盛贸易有限公司", undefined);
    const second = await cached.verify("重庆华盛贸易有限公司", undefined);
    expect(first).toEqual(outcome);
    expect(second).toEqual(outcome);
    // With no cache every call goes through: a disabled cache must not be
    // mistaken for a cache that happens to miss.
    expect(inner.calls).toBe(2);
  });

  test("a rejecting cache still returns the inner answer", async () => {
    const inner = countingPort();
    const broken: VerificationCache = {
      async get(): Promise<string | null> {
        throw new Error("redis down");
      },
      async set(): Promise<void> {
        throw new Error("redis down");
      },
    };
    const cached = createCachedSubjectVerificationPort(inner, broken);
    const result = await cached.verify("重庆华盛贸易有限公司", undefined);
    expect(result).toEqual(outcome);
    expect(inner.calls).toBe(1);
  });

  test.skipIf(unavailable !== null)("a real Redis serves a hit on the second call", async () => {
    if (unavailable || !redis) return;
    const inner = countingPort();
    const cached = createCachedSubjectVerificationPort(inner, redis);
    const subject = `缓存主体-${crypto.randomUUID().slice(0, 8)}有限公司`;
    await cached.verify(subject, undefined);
    await cached.verify(subject, undefined);
    // The second call is answered from the cache, so the inner port ran once.
    expect(inner.calls).toBe(1);
    // The stored entry is the serialized outcome under the normalised key.
    const stored = await redis.get(cacheKeyFor(subject));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(outcome);
    await redis.set(cacheKeyFor(subject), "", 1);
  });
});
