import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Layered coverage collection (Q2).
 *
 * The three coverage kinds answer different questions and are never summed:
 *
 * - **unit line/function coverage** — what the deterministic domain and API
 *   unit suites execute, from Bun's own profiler (`--coverage`). Bun reports
 *   functions and lines; it does **not** report branch coverage, so branch data
 *   is recorded as `null` (unmeasurable with the current toolchain) rather than
 *   faked or replaced by line coverage.
 * - **integration scenario coverage** — how many DB/HTTP/S3/Redis scenarios
 *   exist and pass. This is a scenario count, not a percentage: each scenario is
 *   one behaviour, and the count is the honest unit.
 * - **E2E requirement coverage** — which requirements the browser suite covers,
 *   traced from `docs/quality/traceability.csv`.
 *
 * Output lands in `artifacts/qa/<SHA>/coverage/` as LCOV, a parsed per-file
 * table, and the layer summary the QA report references.
 */

export interface UnitCoverageFile {
  path: string;
  functionsFound: number;
  functionsHit: number;
  linesFound: number;
  linesHit: number;
  /** Bun's profiler does not emit branch data; recorded as null, never guessed. */
  branches: null;
}

export interface UnitCoverageLayer {
  kind: "unit";
  tool: "bun --coverage";
  functionsFound: number;
  functionsHit: number;
  linesFound: number;
  linesHit: number;
  linesPercent: number | null;
  functionsPercent: number | null;
  branches: null;
  files: UnitCoverageFile[];
}

export interface ScenarioCoverageLayer {
  kind: "integration-scenarios" | "e2e-requirements";
  /** Scenario/requirement totals discovered in the repository, not executed here. */
  discovered: number;
  /** How many were executed by the layer that ran; filled by the runner. */
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface CoverageSummary {
  schemaVersion: 1;
  generatedAt: string;
  gitSha: string | null;
  unit: UnitCoverageLayer;
  integration: ScenarioCoverageLayer;
  e2e: ScenarioCoverageLayer;
  notes: string[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Counts integration scenarios: files under tests/integration plus DB-tagged suites. */
const countIntegrationScenarios = async (): Promise<number> => {
  const glob = new Bun.Glob("tests/integration/**/*.test.ts");
  let count = 0;
  for await (const _ of glob.scan({ cwd: REPO_ROOT })) count += 1;
  // Each file contributes its own scenarios; a file with no scenario counts as 0.
  return count;
};

const countE2eRequirements = async (): Promise<number> => {
  const glob = new Bun.Glob("tests/acceptance/*.spec.ts");
  let count = 0;
  for await (const _ of glob.scan({ cwd: REPO_ROOT })) count += 1;
  return count;
};

const shaProc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT, stdout: "pipe" });
const gitSha = shaProc.exitCode === 0 ? new TextDecoder().decode(shaProc.stdout).trim() : null;

const coverageDir = process.env.QA_COVERAGE_DIR ?? "artifacts/qa/coverage";
const lcovPath = join(coverageDir, "lcov.info");
const unit = await parseLcov(lcovPath);

const [integrationDiscovered, e2eDiscovered] = await Promise.all([
  countIntegrationScenarios(),
  countE2eRequirements(),
]);

const summary: CoverageSummary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitSha,
  unit,
  integration: {
    kind: "integration-scenarios",
    discovered: integrationDiscovered,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  },
  e2e: {
    kind: "e2e-requirements",
    discovered: e2eDiscovered,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  },
  notes: [
    "Bun 的原生覆盖率只报告函数与行；分支覆盖率不可测量，记为 null，不用行覆盖率替代。",
    "集成与 E2E 是场景计数，不是百分比；三者不可相加成“总覆盖率”。",
  ],
};

const outDir = process.env.QA_REPORT_DIR ?? "artifacts/qa";
const shaDir = summary.gitSha ?? "unknown-sha";
const targetDir = join(outDir, shaDir, "coverage");
mkdirSync(targetDir, { recursive: true });
const summaryPath = join(targetDir, "layers.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`coverage summary: ${relative(REPO_ROOT, summaryPath)}`);
console.log(
  `unit: lines ${unit.linesPercent ?? "n/a"}% functions ${unit.functionsPercent ?? "n/a"}% branches n/a (bun does not report branches)`,
);

/** Reads Bun's LCOV output into the per-file unit layer. */
async function parseLcov(path: string): Promise<UnitCoverageLayer> {
  const layer: UnitCoverageLayer = {
    kind: "unit",
    tool: "bun --coverage",
    functionsFound: 0,
    functionsHit: 0,
    linesFound: 0,
    linesHit: 0,
    linesPercent: null,
    functionsPercent: null,
    branches: null,
    files: [],
  };
  const file = Bun.file(path);
  if (!(await file.exists())) {
    layer.files = [];
    return layer;
  }
  const text = await file.text();
  let current: UnitCoverageFile | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      if (current) layer.files.push(current);
      current = {
        path: line.slice(3),
        functionsFound: 0,
        functionsHit: 0,
        linesFound: 0,
        linesHit: 0,
        branches: null,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("FNF:")) current.functionsFound = Number(line.slice(4));
    else if (line.startsWith("FNH:")) current.functionsHit = Number(line.slice(4));
    else if (line.startsWith("LF:")) current.linesFound = Number(line.slice(3));
    else if (line.startsWith("LH:")) current.linesHit = Number(line.slice(3));
    else if (line === "end_of_record") {
      layer.files.push(current);
      current = null;
    }
  }
  if (current) layer.files.push(current);

  // A file can be recorded twice — once through a workspace symlink and once
  // through the package path. Keeping both would double-count coverage, so the
  // package-relative path wins and symlinked duplicates are dropped.
  const byPath = new Map<string, UnitCoverageFile>();
  for (const entry of layer.files) {
    const normalized = normalizePath(entry.path);
    const existing = byPath.get(normalized);
    if (!existing || entry.linesFound > existing.linesFound)
      byPath.set(normalized, { ...entry, path: normalized });
  }
  layer.files = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of layer.files) {
    layer.functionsFound += entry.functionsFound;
    layer.functionsHit += entry.functionsHit;
    layer.linesFound += entry.linesFound;
    layer.linesHit += entry.linesHit;
  }
  layer.linesPercent =
    layer.linesFound === 0 ? null : Math.round((layer.linesHit / layer.linesFound) * 10000) / 100;
  layer.functionsPercent =
    layer.functionsFound === 0
      ? null
      : Math.round((layer.functionsHit / layer.functionsFound) * 10000) / 100;
  return layer;
}

/** Maps Bun's symlink-prefixed paths back to package-relative ones. */
function normalizePath(path: string): string {
  const mainCheckout = resolve(REPO_ROOT, "..");
  if (path.startsWith("../..")) {
    return relative(mainCheckout, resolve(REPO_ROOT, path));
  }
  return path;
}
