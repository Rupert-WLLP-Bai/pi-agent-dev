import { expect, test } from "bun:test";
import type {
  SubjectVerificationOutcome,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import {
  CACHE_TTL_SECONDS,
  cacheKeyFor,
  createCachedSubjectVerificationPort,
  type VerificationCache,
} from "./cache";

const outcome = (summary: string): SubjectVerificationOutcome => ({
  status: "RESOLVED",
  candidates: [],
  matched: {
    name: "深圳精工科技有限公司",
    unifiedSocialCreditCode: "91440300MA5EXAMPLE",
    registrationStatus: "存续",
  },
  dimensions: [],
  summary,
  capturedAt: "2026-09-14T00:00:00.000Z",
  expiresAt: "2026-09-21T00:00:00.000Z",
  failureReason: null,
});

class MemoryCache implements VerificationCache {
  store = new Map<string, { value: string; ttlSeconds: number }>();
  fail = false;

  async get(key: string): Promise<string | null> {
    if (this.fail) throw new Error("redis get failed");
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.fail) throw new Error("redis set failed");
    this.store.set(key, { value, ttlSeconds });
  }
}

const recordingPort = (
  answer: SubjectVerificationOutcome,
): SubjectVerificationPort & {
  calls: string[];
} => {
  const calls: string[] = [];
  return {
    provider: "qcc",
    tool: "get_company_risk_scan",
    calls,
    async verify(subject: string) {
      calls.push(subject);
      return answer;
    },
  };
};

test("normalises the subject before forming the cache key", () => {
  expect(cacheKeyFor("  深圳精工科技有限公司  ")).toBe("qcc:v1:深圳精工科技有限公司");
  expect(cacheKeyFor("\u0041\u0301")).toBe(cacheKeyFor("\u00C1"));
});

test("the second verify of the same name does not call the inner port", async () => {
  const inner = recordingPort(outcome("首次核验"));
  const cache = new MemoryCache();
  const port = createCachedSubjectVerificationPort(inner, cache);

  const first = await port.verify("深圳精工科技有限公司");
  const second = await port.verify(" 深圳精工科技有限公司 ");

  expect(inner.calls).toEqual(["深圳精工科技有限公司"]);
  expect(first.summary).toBe("首次核验");
  expect(second.summary).toBe("首次核验");
  expect([...cache.store.values()][0]?.ttlSeconds).toBe(CACHE_TTL_SECONDS);
});

test("a missing cache always calls through to the inner port", async () => {
  const inner = recordingPort(outcome("直打"));
  const port = createCachedSubjectVerificationPort(inner, null);

  await port.verify("深圳精工科技有限公司");
  await port.verify("深圳精工科技有限公司");

  expect(inner.calls).toHaveLength(2);
});

test("a redis failure still returns the inner answer", async () => {
  const inner = recordingPort(outcome("降级"));
  const cache = new MemoryCache();
  cache.fail = true;
  const port = createCachedSubjectVerificationPort(inner, cache);

  const result = await port.verify("深圳精工科技有限公司");

  expect(result.summary).toBe("降级");
  expect(inner.calls).toEqual(["深圳精工科技有限公司"]);
});
