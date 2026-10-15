import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/**
 * The layered QA report writer.
 *
 * `bun run qa:report` runs the layers one by one, captures each command, its
 * exit code and its artifacts, and writes a machine-readable summary that can
 * be traced back to the exact commit it came from. The summary is trustworthy
 * rather than decorative because:
 *
 * - the Git SHA is read from the repository, not typed in;
 * - every layer's exit code is recorded as observed — a layer that could not
 *   run is `skipped` with the reason, never `passed`;
 * - Bun prints its tallies to **stderr**, so counts are parsed from the combined
 *   output, not from stdout alone;
 * - E2E counts come from the Playwright JSON reporter's own output file, which
 *   is deleted before the run so the numbers can only be this run's;
 * - Chromium availability is observed (`chromium.executablePath()` + a
 *   filesystem probe), never assumed;
 * - command output is redacted through a narrow allowlist filter before it
 *   reaches the report, so a leaky tool cannot put a credential into
 *   summary.json or summary.html.
 *
 * The report keeps the three coverage kinds apart: unit line/function coverage,
 * integration scenario counts, and E2E requirement results. Summing them into
 * one "total coverage" would hide which layer a gap belongs to.
 */

export type LayerStatus = "passed" | "failed" | "skipped";

export interface LayerResult {
  /** Stable layer id: unit, integration, e2e, coverage. */
  id: string;
  status: LayerStatus;
  /** The exact command line that was run, as the shell saw it. */
  command: string;
  /** Exit code as reported by the shell; null when the layer never ran. */
  exitCode: number | null;
  /** Wall-clock milliseconds, rounded. */
  durationMs: number;
  /** Why a layer was skipped, when it was. */
  reason?: string;
  /** Case counts observed from the layer's own output, when it produced any. */
  counts?: {
    pass: number;
    fail: number;
    skip: number;
  };
  /** Artifact paths this layer wrote, relative to the repository root. */
  artifacts?: string[];
}

export interface QaReport {
  schemaVersion: 1;
  /** ISO timestamp of when the report was assembled. */
  generatedAt: string;
  git: { sha: string | null; branch: string | null; dirty: boolean };
  environment: {
    bun: string | null;
    node: string | null;
    platform: string;
    arch: string;
    /** Variables that decide which layers can run at all. */
    testDatabaseUrlConfigured: boolean;
    redisUrlConfigured: boolean;
    s3EndpointConfigured: boolean;
    /**
     * Observed, not assumed: the resolved Chromium executable and whether the
     * filesystem actually holds it. Null when Playwright cannot resolve a path.
     */
    chromium: { executablePath: string | null; installed: boolean };
  };
  layers: LayerResult[];
  totals: {
    passed: number;
    failed: number;
    skipped: number;
  };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Values a command's output must never carry into a report. Only variables that
 * are credentials by name are redacted — everything else is left readable so
 * the log stays useful. The match is on the assignment's value part, so a
 * variable named `*_ENDPOINT` is not treated as a secret.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /((?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)\S+/giu,
    "$1[REDACTED]",
  ],
];

/** Applies the redaction allowlist to one chunk of command output. */
const redactOutput = (output: string): string => {
  let redacted = output;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
};

const run = (command: string): { exitCode: number; output: string; durationMs: number } => {
  const started = Date.now();
  const proc = Bun.spawnSync(["bash", "-lc", command], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const durationMs = Date.now() - started;
  // Bun prints its pass/fail tally to stderr; dropping it here would leave the
  // summary without counts, so both streams are captured and combined in order.
  const stdout = new TextDecoder().decode(proc.stdout ?? new Uint8Array());
  const stderr = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
  return {
    exitCode: proc.exitCode,
    output: redactOutput(stdout + (stderr === "" ? "" : `\n[stderr]\n${stderr}`)),
    durationMs,
  };
};

const git = (args: string[]): string | null => {
  const proc = Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return null;
  return new TextDecoder().decode(proc.stdout ?? new Uint8Array()).trim() || null;
};

/** Parses Bun's own tally lines (`N pass`, `N fail`, `N skip`) from output. */
const parseBunCounts = (output: string): LayerResult["counts"] | undefined => {
  const pass = /(\d+)\s+pass/u.exec(output);
  const fail = /(\d+)\s+fail/u.exec(output);
  if (pass === null && fail === null) return undefined;
  const skip = /(\d+)\s+skip/u.exec(output);
  return {
    pass: pass ? Number(pass[1]) : 0,
    fail: fail ? Number(fail[1]) : 0,
    skip: skip ? Number(skip[1]) : 0,
  };
};

/** Where the Playwright JSON reporter writes; playwright.config.ts owns this. */
const E2E_RESULTS_PATH = "artifacts/qa/e2e/results.json";

/** Synchronous read + parse of the current run's Playwright JSON report. */
const readPlaywrightCounts = (): { counts: LayerResult["counts"]; artifact: string } | null => {
  const path = resolve(REPO_ROOT, E2E_RESULTS_PATH);
  if (!existsSync(path)) return null;
  let parsed: {
    stats?: { expected?: number; unexpected?: number; skipped?: number };
  };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
  } catch {
    return null;
  }
  const stats = parsed.stats;
  if (!stats) return null;
  return {
    counts: {
      pass: stats.expected ?? 0,
      fail: stats.unexpected ?? 0,
      skip: stats.skipped ?? 0,
    },
    artifact: E2E_RESULTS_PATH,
  };
};

/** Resolves the Chromium binary Playwright would drive, and whether it exists. */
const observeChromium = (): { executablePath: string | null; installed: boolean } => {
  try {
    const path = chromium.executablePath();
    if (path === "") return { executablePath: null, installed: false };
    try {
      accessSync(path, constants.F_OK);
      return { executablePath: path, installed: true };
    } catch {
      return { executablePath: path, installed: false };
    }
  } catch {
    return { executablePath: null, installed: false };
  }
};

const integrationGuard = (): string | null => {
  if ((process.env.TEST_DATABASE_URL ?? "").trim() !== "") return null;
  if (
    (process.env.DATABASE_URL ?? "").trim() !== "" &&
    process.env.INTEGRATION_ALLOW_DEFAULT_DB === "1"
  ) {
    return null;
  }
  return "TEST_DATABASE_URL not configured (set it to a disposable database, or set INTEGRATION_ALLOW_DEFAULT_DB=1 to reuse DATABASE_URL)";
};

const e2eGuard = (): string | null => {
  if ((process.env.TEST_DATABASE_URL ?? "").trim() === "") {
    return "TEST_DATABASE_URL not configured — acceptance needs a disposable migrated database";
  }
  const chromiumState = observeChromium();
  if (!chromiumState.installed) {
    return chromiumState.executablePath === null
      ? "Chromium executable could not be resolved (run `bunx playwright install chromium`)"
      : `Chromium not installed at resolved path ${chromiumState.executablePath} (run \`bunx playwright install chromium\`)`;
  }
  return null;
};

/** Layer definitions: the exact guarded commands the Makefile aliases wrap. */
const LAYERS: Array<{
  id: string;
  command: string;
  /** Returns a skip reason when the layer's prerequisite is absent. */
  guard?: () => string | null;
  /** Removed before the layer runs, so its counts can only be this run's. */
  staleArtifacts?: string[];
  artifacts?: string[];
}> = [
  {
    id: "unit",
    command: "bun run test",
  },
  {
    id: "integration",
    command: "bun run test:integration",
    guard: integrationGuard,
  },
  {
    id: "e2e",
    command: "bun run test:e2e",
    guard: e2eGuard,
    staleArtifacts: [E2E_RESULTS_PATH],
    artifacts: [E2E_RESULTS_PATH, "playwright-report/"],
  },
  {
    id: "coverage",
    command: "bun run test:coverage",
    artifacts: ["artifacts/qa/coverage/lcov.info"],
  },
];

const sha = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = (git(["status", "--porcelain"]) ?? "") !== "";

const layers: LayerResult[] = [];
for (const layer of LAYERS) {
  const reason = layer.guard?.() ?? null;
  if (reason !== null) {
    layers.push({
      id: layer.id,
      status: "skipped",
      command: layer.command,
      exitCode: null,
      durationMs: 0,
      reason,
    });
    continue;
  }
  for (const stale of layer.staleArtifacts ?? []) {
    rmSync(resolve(REPO_ROOT, stale), { force: true, recursive: true });
  }
  const result = run(layer.command);
  const counts =
    layer.id === "e2e"
      ? (readPlaywrightCounts()?.counts ?? parseBunCounts(result.output))
      : parseBunCounts(result.output);
  const artifacts =
    layer.artifacts?.filter((artifact) => existsSync(resolve(REPO_ROOT, artifact))) ?? [];
  // A run that exited 0 but left no counts is not a pass: the summary must say
  // so rather than inherit a green exit code it cannot explain. The layer still
  // records its exit code, so the operator can investigate.
  const status: LayerStatus = result.exitCode === 0 ? "passed" : "failed";
  layers.push({
    id: layer.id,
    status,
    command: layer.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    counts,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    ...(status === "failed" && counts === undefined
      ? { reason: "no case counts observed in the layer's output" }
      : {}),
  });
}

const report: QaReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  git: { sha, branch, dirty },
  environment: {
    bun: Bun.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    testDatabaseUrlConfigured: (process.env.TEST_DATABASE_URL ?? "").trim() !== "",
    redisUrlConfigured: (process.env.REDIS_URL ?? "").trim() !== "",
    s3EndpointConfigured: (process.env.S3_ENDPOINT ?? "").trim() !== "",
    chromium: observeChromium(),
  },
  layers,
  totals: {
    passed: layers.filter((layer) => layer.status === "passed").length,
    failed: layers.filter((layer) => layer.status === "failed").length,
    skipped: layers.filter((layer) => layer.status === "skipped").length,
  },
};

const outputDir = process.env.QA_REPORT_DIR ?? "artifacts/qa";
const shaDir = sha ?? "unknown-sha";
const targetDir = join(outputDir, shaDir);
mkdirSync(targetDir, { recursive: true });

const summaryPath = join(targetDir, "summary.json");
writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`);

const htmlPath = join(targetDir, "summary.html");
writeFileSync(htmlPath, renderHtml(report));

const relativePath = (path: string): string => relative(REPO_ROOT, path);
console.log(`qa report: ${relativePath(summaryPath)}`);
console.log(`qa report: ${relativePath(htmlPath)}`);
console.log(
  `layers: ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped`,
);

// A skipped layer is a report, not a failure: the operator asked for what could
// run. A layer that ran and failed must fail the command so CI and a human both
// see it.
if (report.totals.failed > 0) process.exit(1);

function renderHtml(value: QaReport): string {
  const rows = value.layers
    .map(
      (layer) =>
        `<tr><td>${layer.id}</td><td>${layer.status}</td><td>${layer.exitCode ?? "—"}</td>` +
        `<td>${layer.durationMs}</td><td>${layer.reason ?? ""}</td>` +
        `<td>${JSON.stringify(layer.counts ?? {})}</td>` +
        `<td>${(layer.artifacts ?? []).join("<br/>")}</td>` +
        `<td><code>${layer.command}</code></td></tr>`,
    )
    .join("\n");
  const chromium = value.environment.chromium;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>QA 分层测试摘要</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1f2933; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #cbd2d9; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
th { background: #f5f7fa; }
.passed { color: #107c10; font-weight: 600; }
.failed { color: #d13438; font-weight: 600; }
.skipped { color: #797775; font-weight: 600; }
code { background: #f5f7fa; padding: 0 0.25rem; }
</style>
</head>
<body>
<h1>分层测试摘要</h1>
<p>Git SHA: <code>${value.git.sha ?? "unknown"}</code>（branch <code>${value.git.branch ?? "unknown"}</code>，dirty: ${value.git.dirty ? "是" : "否"}）</p>
<p>生成时间: ${value.generatedAt}；Bun ${value.environment.bun ?? "unknown"}；platform ${value.environment.platform}/${value.environment.arch}</p>
<p>TEST_DATABASE_URL 已配置: ${value.environment.testDatabaseUrlConfigured ? "是" : "否"}；Redis 已配置: ${value.environment.redisUrlConfigured ? "是" : "否"}；S3 已配置: ${value.environment.s3EndpointConfigured ? "是" : "否"}</p>
<p>Chromium: ${chromium.installed ? `已安装（<code>${chromium.executablePath}</code>）` : "未安装"}</p>
<table>
<thead><tr><th>层</th><th>状态</th><th>退出码</th><th>耗时(ms)</th><th>跳过/缺失原因</th><th>用例计数</th><th>工件</th><th>命令</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="${value.totals.failed > 0 ? "failed" : "passed"}">${value.totals.passed} passed · ${value.totals.failed} failed · ${value.totals.skipped} skipped</p>
</body>
</html>
`;
}
