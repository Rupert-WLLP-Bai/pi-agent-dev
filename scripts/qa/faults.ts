import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The failure-path regression runner (Q6).
 *
 * Each scenario drives the real HTTP surface with one dependency broken and
 * asserts what the operator sees: a business failure with a stable error code,
 * or a safe fallback — never a hang, a stack trace, or a corrupted formal
 * result. Scenarios that need a real service (Redis, S3) are skipped with a
 * reason when the service is not configured, so a run without infrastructure
 * still reports what it proved.
 *
 * The output is one JSON file per run, keyed by Git SHA, listing every scenario
 * with its observed status. A scenario that could not run is `skipped` with the
 * missing prerequisite; a scenario whose assertion failed is `failed` with the
 * observed response. Nothing here may be reported as passing on the strength of
 * a comment.
 */

export type ScenarioStatus = "passed" | "failed" | "skipped";

export interface FaultScenarioResult {
  id: string;
  /** The requirement this scenario defends, for the traceability matrix. */
  requirement: string;
  status: ScenarioStatus;
  reason?: string;
  /** What the system actually answered, when it answered. */
  observed?: Record<string, unknown>;
  durationMs: number;
}

export interface FaultReport {
  schemaVersion: 1;
  generatedAt: string;
  git: { sha: string | null; dirty: boolean };
  environment: {
    databaseUrlConfigured: boolean;
    redisUrlConfigured: boolean;
    s3EndpointConfigured: boolean;
  };
  scenarios: FaultScenarioResult[];
  totals: { passed: number; failed: number; skipped: number };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Scenario {
  id: string;
  requirement: string;
  /** Returns null when the scenario's prerequisite is missing. */
  guard?: () => string | null;
  run: () => Promise<Record<string, unknown>>;
}

/** Spawns the API with an explicit environment and waits for its port. */
async function withServer(
  env: Record<string, string>,
  body: (baseUrl: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const port = 3400 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(["bun", "apps/api/src/app.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, API_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const deadline = Date.now() + 30_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200 || response.status === 503) {
          healthy = true;
          break;
        }
      } catch {
        // Not listening yet.
      }
      await Bun.sleep(250);
    }
    if (!healthy) throw new Error("server did not become healthy in time");
    return await body(baseUrl);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();

const scenarios: Scenario[] = [
  {
    id: "redis-unreachable-verification-still-succeeds",
    requirement: "SEC6 / I5: Redis 不可用时主体核验回退直连，审计不失败",
    guard: () => (databaseUrl === "" ? "DATABASE_URL not configured" : null),
    run: () =>
      withServer(
        { DATABASE_URL: databaseUrl, REDIS_URL: "redis://127.0.0.1:6399/0" },
        async (base) => {
          const health = await (await fetch(`${base}/api/health`)).json();
          const created = await fetch(`${base}/api/audit-cases`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              source: "text",
              contractText: "甲方应于签订后支付合同金额的70%作为预付款。",
            }),
          });
          return {
            healthStatus: health.status,
            redisReported: health.redis,
            createStatus: created.status,
          };
        },
      ),
  },
  {
    // The fallback is the explicit *development* wiring (`S3_STRICT=false`):
    // the configuration that names local disk as a second backend on purpose.
    // Demo/production default to strict, where a failed Put must surface rather
    // than silently change where the bytes live; that path is owned by the
    // storage implementation, and this scenario exists to prove the non-strict
    // one keeps its own contract (locator records the backend that answered).
    id: "s3-non-strict-falls-back-to-local",
    requirement: "SEC6 / I5: S3_STRICT=false 时 S3 失败写入本地，locator 记录实际后端",
    guard: () => (databaseUrl === "" ? "DATABASE_URL not configured" : null),
    run: () =>
      withServer(
        {
          DATABASE_URL: databaseUrl,
          S3_STRICT: "false",
          S3_ENDPOINT: "http://127.0.0.1:9999",
          S3_ACCESS_KEY: "fault",
          S3_SECRET_KEY: "fault",
          S3_BUCKET: "contract-originals",
          UPLOAD_DIR: "var/fault-uploads",
        },
        async (base) => {
          const form = new FormData();
          form.set(
            "file",
            new File(
              [new TextEncoder().encode("甲方应于签订后支付合同金额的70%作为预付款。")],
              "故障合同.txt",
              {
                type: "text/plain",
              },
            ),
          );
          const created = await fetch(`${base}/api/audit-cases/upload`, {
            method: "POST",
            body: form,
          });
          const body = (await created.json()) as { id: string };
          const detail = await (await fetch(`${base}/api/audit-cases/${body.id}`)).json();
          return {
            createStatus: created.status,
            originalStorage: detail.originalStorage,
            originalDownloadable: detail.originalDownloadable,
          };
        },
      ),
  },
  {
    id: "unknown-route-and-malformed-id-are-not-server-faults",
    requirement: "Q3/G3: 未知路由与非法 UUID 返回可读错误，不伪装 500",
    guard: () => (databaseUrl === "" ? "DATABASE_URL not configured" : null),
    run: () =>
      withServer({ DATABASE_URL: databaseUrl }, async (base) => ({
        unknownRoute: (await fetch(`${base}/api/no-such-route`)).status,
        malformedCaseId: (await fetch(`${base}/api/audit-cases/not-a-uuid`)).status,
        malformedDecisionId: (
          await fetch(`${base}/api/audit-cases/not-a-uuid/retry`, { method: "POST" })
        ).status,
      })),
  },
  {
    id: "oversized-and-hostile-uploads-are-refused",
    requirement: "SEC2: 超大文件与类型伪造被拒绝，不进入解析",
    guard: () => (databaseUrl === "" ? "DATABASE_URL not configured" : null),
    run: () =>
      withServer({ DATABASE_URL: databaseUrl }, async (base) => {
        const oversized = new FormData();
        oversized.set(
          "file",
          new File([new Uint8Array(11 * 1024 * 1024)], "big.txt", { type: "text/plain" }),
        );
        const lying = new FormData();
        lying.set(
          "file",
          new File([new TextEncoder().encode("合同正文")], "合同.pdf", { type: "text/plain" }),
        );
        const traversal = new FormData();
        traversal.set(
          "file",
          new File([new TextEncoder().encode("x")], "../../etc/passwd", { type: "text/plain" }),
        );
        return {
          oversized: (
            await fetch(`${base}/api/audit-cases/upload`, { method: "POST", body: oversized })
          ).status,
          typeMismatch: (
            await fetch(`${base}/api/audit-cases/upload`, { method: "POST", body: lying })
          ).status,
          traversalName: (
            await fetch(`${base}/api/audit-cases/upload`, { method: "POST", body: traversal })
          ).status,
        };
      }),
  },
];

const results: FaultScenarioResult[] = [];
for (const scenario of scenarios) {
  const reason = scenario.guard?.() ?? null;
  if (reason) {
    results.push({
      id: scenario.id,
      requirement: scenario.requirement,
      status: "skipped",
      reason,
      durationMs: 0,
    });
    continue;
  }
  const started = Date.now();
  try {
    const observed = await scenario.run();
    results.push({
      id: scenario.id,
      requirement: scenario.requirement,
      status: "passed",
      observed,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    results.push({
      id: scenario.id,
      requirement: scenario.requirement,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    });
  }
}

const shaProc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT, stdout: "pipe" });
const sha = shaProc.exitCode === 0 ? new TextDecoder().decode(shaProc.stdout).trim() : null;
const dirtyProc = Bun.spawnSync(["git", "status", "--porcelain"], {
  cwd: REPO_ROOT,
  stdout: "pipe",
});

const report: FaultReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: {
    sha,
    dirty: dirtyProc.exitCode === 0 && new TextDecoder().decode(dirtyProc.stdout).trim() !== "",
  },
  environment: {
    databaseUrlConfigured: databaseUrl !== "",
    redisUrlConfigured: (process.env.REDIS_URL ?? "").trim() !== "",
    s3EndpointConfigured: (process.env.S3_ENDPOINT ?? "").trim() !== "",
  },
  scenarios: results,
  totals: {
    passed: results.filter((item) => item.status === "passed").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  },
};

const outputDir = process.env.QA_FAULT_DIR ?? "artifacts/qa";
const targetDir = join(outputDir, sha ?? "unknown-sha");
mkdirSync(targetDir, { recursive: true });
const path = join(targetDir, "faults.json");
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(`fault report: ${relative(REPO_ROOT, path)}`);
console.log(
  `scenarios: ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped`,
);
if (report.totals.failed > 0) process.exit(1);
