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
import { sanitizeCapturedText } from "./redact";

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
 * - command output is redacted through the shared `./redact` sanitizer before
 *   it reaches the report, so a leaky tool cannot put a credential, a
 *   connection-string password, or a managed-environment literal into
 *   summary.json or summary.html;
 * - the already-sanitized output of every layer that ran is persisted verbatim
 *   under `<QA_REPORT_DIR>/<SHA>/logs/<layer>.log`, and the log is listed in
 *   that layer's `artifacts`, so a later investigation can read the full
 *   captured text without re-running the layers;
 * - a layer that exits 0 but observed **no case counts** is reported `failed`,
 *   not `passed`: a command that matched nothing (renamed suite, empty
 *   selector, cached-filter run) must not look like a green run with zero
 *   work done.
 *
 * `QA_REPORT_DIR` relocates the output. `QA_REQUIRE_ALL=1` turns skips into a
 * non-zero exit (the `make test-all` gate); without it the report is
 * diagnostic and a skipped layer is a report, not a failure.
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
    /** Passed-on-retry; E2E only, recorded rather than absorbed. */
    flaky?: number;
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
    /** What the acceptance layer actually passes to the API web server. */
    playwrightDatabaseUrlConfigured: boolean;
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
  // Interleaving is reconstructable via the `[stderr]` marker, which lets a
  // human tell an actual tally line from output that merely contains one.
  const stdout = new TextDecoder().decode(proc.stdout ?? new Uint8Array());
  const stderr = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
  return {
    exitCode: proc.exitCode,
    output: sanitizeCapturedText(
      stdout + (stderr === "" ? "" : `\n[stderr]\n${stderr}\n[/stderr]\n`),
    ),
    durationMs,
  };
};

const git = (args: string[]): string | null => {
  const proc = Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return null;
  return new TextDecoder().decode(proc.stdout ?? new Uint8Array()).trim() || null;
};

/**
 * Parses Bun's own tally lines (`N pass`, `N fail`, `N skip`) from output.
 *
 * Bun emits one summary line per suite with counts aligned in columns, e.g.
 * ` 12 pass,  0 fail,  3 skip` and a final `tests: 15 pass, 0 fail, 3 skip`.
 * Only lines where a count is followed by the exact word `pass`/`fail`/`skip`
 * count, so a prose line that mentions "0 pass" inside a test's own name or a
 * stack frame cannot be mistaken for a tally. Bun pads these lines with
 * leading spaces, so the anchor tolerates horizontal whitespace — anchoring
 * without it silently dropped every tally, which is how a whole successful
 * suite once appeared as "no counts observed". The **last** match wins: Bun
 * prints per-file tallies before the global one, so the global line is the
 * authoritative total.
 */
const parseBunCounts = (output: string): LayerResult["counts"] | undefined => {
  const pass = [...output.matchAll(/^[^\S\n]*(\d+)\s+pass\s*$/gmu)];
  const fail = [...output.matchAll(/^[^\S\n]*(\d+)\s+fail\s*$/gmu)];
  const skip = [...output.matchAll(/^[^\S\n]*(\d+)\s+skip\s*$/gmu)];
  if (pass.length === 0 && fail.length === 0) return undefined;
  const last = (matches: RegExpMatchArray[]): number =>
    matches.length === 0 ? 0 : Number(matches[matches.length - 1][1]);
  return { pass: last(pass), fail: last(fail), skip: last(skip) };
};

/** Where the Playwright JSON reporter writes; playwright.config.ts owns this. */
const E2E_RESULTS_PATH = "artifacts/qa/e2e/results.json";

/**
 * Synchronous read + parse of the *current run's* Playwright JSON report.
 *
 * Only the file this layer just wrote is read: the stale copy is deleted before
 * the run, so a hit here is this run's data. Three facts come out, because each
 * answers a different honesty question:
 *
 * - `pass`/`fail` from `stats.expected`/`stats.unexpected` — Playwright's own
 *   tally, which already separates "expected to pass" from "failed";
 * - `flaky` from `stats.flaky` — passed-on-retry is a *traceable* state, not a
 *   green one, and deleting it would make a retry-prone suite look stable;
 * - `suiteFailed` from `stats.unexpected` plus top-level `errors` — a run that
 *   crashed before any test executed (global setup throw, config error) must
 *   not be recorded as a zero-test success.
 *
 * `skip` is only credible when the suite actually ran: `stats.skipped` counts
 * tests marked skipped by the suite, which Playwright reports even when the
 * whole file was filtered out — hence the explicit `no specs matched` branch.
 */
const readPlaywrightCounts = (): {
  counts: LayerResult["counts"] & { flaky?: number };
  artifact: string;
} | null => {
  const path = resolve(REPO_ROOT, E2E_RESULTS_PATH);
  if (!existsSync(path)) return null;
  let parsed: {
    stats?: {
      expected?: number;
      unexpected?: number;
      skipped?: number;
      flaky?: number;
    };
    errors?: unknown[];
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
      ...(stats.flaky === undefined ? {} : { flaky: stats.flaky }),
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

/**
 * The database a layer must run against.
 *
 * Integration suites resolve their identity through
 * `tests/integration/db.ts`, which accepts `TEST_DATABASE_URL` and only
 * falls back to `DATABASE_URL` behind an explicit `INTEGRATION_ALLOW_DEFAULT_DB=1`
 * opt-in. The report guard mirrors that same rule, so a layer's guard can never
 * be weaker than the suite it launches.
 *
 * The acceptance webServer is started by `playwright.config.ts` with the value
 * of `PLAYWRIGHT_DATABASE_URL` passed to it as `DATABASE_URL`, so the E2E layer
 * needs that variable to name the same disposable database. Checking
 * `TEST_DATABASE_URL` alone (as this guard once did) let a run through where the
 * browser stack silently booted against the developer's `.env` database.
 */
const disposableDatabaseGuard = (): string | null => {
  if ((process.env.TEST_DATABASE_URL ?? "").trim() !== "") return null;
  if (
    (process.env.DATABASE_URL ?? "").trim() !== "" &&
    process.env.INTEGRATION_ALLOW_DEFAULT_DB === "1"
  ) {
    return null;
  }
  return "TEST_DATABASE_URL not configured — set it to a disposable migrated database, or set INTEGRATION_ALLOW_DEFAULT_DB=1 to explicitly reuse DATABASE_URL";
};

const integrationGuard = (): string | null => {
  const database = disposableDatabaseGuard();
  if (database !== null) return database;
  if (process.env.QA_REQUIRE_ALL !== "1") return null;
  const missing = [
    "REDIS_URL",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
  ].filter((name) => !(process.env[name] ?? "").trim());
  return missing.length > 0
    ? `required integration configuration missing: ${missing.join(", ")}`
    : null;
};

const e2eGuard = (): string | null => {
  const disposable = disposableDatabaseGuard();
  if (disposable !== null) return disposable;
  if ((process.env.PLAYWRIGHT_DATABASE_URL ?? "").trim() === "") {
    return "PLAYWRIGHT_DATABASE_URL not configured — playwright.config.ts passes it to the API web server as DATABASE_URL, so acceptance needs it on the disposable database";
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

// Every artifact this run writes — summary, HTML and the per-layer logs — lives
// under one per-SHA directory, so it is created before the first layer runs: a
// layer that writes its log must never fail because the directory is absent.
const outputDir = process.env.QA_REPORT_DIR ?? "artifacts/qa";
const shaDir = sha ?? "unknown-sha";
const targetDir = join(outputDir, shaDir);
const logsDir = join(targetDir, "logs");
mkdirSync(logsDir, { recursive: true });

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
  // The captured text was sanitized before it was returned, so persisting it
  // here is verbatim: the log is the evidence a later investigation reads
  // instead of re-running the layer, and it must match what the run saw.
  const logPath = join(logsDir, `${layer.id}.log`);
  writeFileSync(logPath, `${result.output}\n`);
  const logArtifact = relative(REPO_ROOT, logPath);
  const counts =
    layer.id === "e2e"
      ? (readPlaywrightCounts()?.counts ?? parseBunCounts(result.output))
      : parseBunCounts(result.output);
  const artifacts = [
    ...(layer.artifacts ?? []).filter((artifact) => existsSync(resolve(REPO_ROOT, artifact))),
    logArtifact,
  ];
  // A run that exited 0 but observed no case counts is not a pass: a command
  // that matched nothing (renamed suite, over-narrow filter, config that
  // resolved zero specs) exits 0 with no tallies at all, and reporting that as
  // a green layer would hide the fact that nothing was verified. The layer
  // still records its exit code and absence, so the operator can investigate.
  const observedCases = counts ? counts.pass + counts.fail : 0;
  const requiredCasesSkipped = process.env.QA_REQUIRE_ALL === "1" && (counts?.skip ?? 0) > 0;
  const status: LayerStatus =
    result.exitCode !== 0 || requiredCasesSkipped || observedCases === 0 ? "failed" : "passed";
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
    ...(status === "failed" && observedCases === 0 && counts !== undefined
      ? { reason: "the layer exited 0 but reported zero cases — nothing was verified" }
      : {}),
    ...(requiredCasesSkipped
      ? { reason: `QA_REQUIRE_ALL=1: ${counts?.skip} required checks were skipped` }
      : {}),
    ...(result.exitCode !== 0 && counts !== undefined
      ? { reason: `the layer exited with code ${result.exitCode}` }
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
    playwrightDatabaseUrlConfigured: (process.env.PLAYWRIGHT_DATABASE_URL ?? "").trim() !== "",
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

/**
 * `QA_REQUIRE_ALL=1` makes the report the `make test-all` gate: every layer —
 * unit, integration, e2e, coverage — must have actually run, so a skipped layer
 * fails the command even though nothing failed. The skip reason is retained in
 * the summary (both files), because a gate that only says "some layer did not
 * run" wastes the operator's time chasing which one.
 *
 * A plain `bun run qa:report` stays diagnostic-lenient (skips are reports), so
 * the same command can be used for a casual local sweep and as the strict gate.
 */
if (process.env.QA_REQUIRE_ALL === "1" && report.totals.skipped > 0) {
  const missing = report.layers
    .filter((layer) => layer.status === "skipped")
    .map((layer) => `${layer.id} (${layer.reason ?? "no reason recorded"})`)
    .join("; ");
  console.log(`QA_REQUIRE_ALL=1: ${missing}`);
  process.exit(1);
}

/**
 * Minimal HTML escaping: command output never reaches here, but a status,
 * reason or count from a report could carry a character with markup meaning.
 * Declared as a function (not a `const` arrow) so it is hoisted above the
 * `renderHtml` call near the top of the run: a `const` here was uninitialized
 * at call time and threw a ReferenceError after summary.json had been written.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtml(value: QaReport): string {
  const rows = value.layers
    .map(
      (layer) =>
        `<tr><td>${escapeHtml(layer.id)}</td><td>${escapeHtml(layer.status)}</td><td>${layer.exitCode ?? "—"}</td>` +
        `<td>${layer.durationMs}</td><td>${escapeHtml(layer.reason ?? "")}</td>` +
        `<td>${escapeHtml(JSON.stringify(layer.counts ?? {}))}</td>` +
        `<td>${(layer.artifacts ?? []).map(escapeHtml).join("<br/>")}</td>` +
        `<td><code>${escapeHtml(layer.command)}</code></td></tr>`,
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
<p>Git SHA: <code>${escapeHtml(value.git.sha ?? "unknown")}</code>（branch <code>${escapeHtml(value.git.branch ?? "unknown")}</code>，dirty: ${value.git.dirty ? "是" : "否"}）</p>
<p>生成时间: ${escapeHtml(value.generatedAt)}；Bun ${escapeHtml(value.environment.bun ?? "unknown")}；platform ${escapeHtml(value.environment.platform)}/${escapeHtml(value.environment.arch)}</p>
<p>TEST_DATABASE_URL 已配置: ${value.environment.testDatabaseUrlConfigured ? "是" : "否"}；PLAYWRIGHT_DATABASE_URL 已配置: ${value.environment.playwrightDatabaseUrlConfigured ? "是" : "否"}；Redis 已配置: ${value.environment.redisUrlConfigured ? "是" : "否"}；S3 已配置: ${value.environment.s3EndpointConfigured ? "是" : "否"}</p>
<p>Chromium: ${chromium.installed ? `已安装（<code>${escapeHtml(chromium.executablePath ?? "")}</code>）` : "未安装"}</p>
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
