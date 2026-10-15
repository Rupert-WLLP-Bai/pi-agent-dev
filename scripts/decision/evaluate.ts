/**
 * Fair same-task evaluation over the synthetic clause fixture set.
 *
 * What this script does and does not do:
 * - it asks the *same* questions of every path over the *same* frozen inputs,
 *   so a comparison between paths is about the path and not about the input;
 * - it computes precision / recall / F1, the confusion matrix, the abstention
 *   rate and latency percentiles from the answers actually returned;
 * - it records the input revision (fixture set version), the model revision
 *   and the provider identity on every run;
 * - it never sends gold labels, comparison answers or original coordinates to
 *   a provider — the comparison happens here, after the fact;
 * - it reports no number for a path that was not run. An unreachable provider
 *   is a reported failure, not a zero and not a success.
 *
 * Usage (CPU-only, offline, no credentials):
 *   bun scripts/decision/evaluate.ts --provider fake
 *   bun scripts/decision/evaluate.ts --provider laya-cpu --endpoint http://127.0.0.1:3847 \
 *     --allowed-origin http://127.0.0.1:3847
 *
 * The output is written as JSON so a later report can cite the exact numbers
 * rather than a retyped summary.
 */

import type { DecisionProviderLike } from "../../apps/api/src/decision/providers/base";
import { FakeDecisionProvider } from "../../apps/api/src/decision/providers/fake";
import { LayaCpuDecisionProvider } from "../../apps/api/src/decision/providers/laya-cpu";
import {
  DECISION_QUESTION_CATALOGUE_VERSION,
  decisionQuestionCatalogue,
} from "../../apps/api/src/decision/questions";
import type {
  DecisionAnswer,
  DecisionRequest,
  DecisionTaskType,
} from "../../packages/audit/src/decision";
import {
  FIXTURE_CATEGORIES,
  type FixtureCategory,
  syntheticClauseFixtures,
} from "../../tests/fixtures/decision/clauses";

/** Bumped whenever the fixture set or the question wording changes. */
export const EVALUATION_INPUT_REVISION = "clause-fixture-v1";

interface Args {
  provider: "fake" | "laya-cpu";
  endpoint: string;
  allowedOrigins: string[];
  model: string;
  modelRevision: string;
  codeRevision: string;
  timeoutMs: number;
  out: string;
}

const parseArgs = (argv: readonly string[]): Args => {
  const args: Args = {
    provider: "fake",
    endpoint: "",
    allowedOrigins: [],
    model: "multilingual",
    modelRevision: "1720e3e3357cfe1e281542e223f8273b0890ca34",
    codeRevision: "432312b36714d8889eba405507b37eda25257d9c",
    timeoutMs: 30_000,
    out: "artifacts/decision-evaluation.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--provider" && value !== undefined) {
      args.provider = value === "laya-cpu" ? "laya-cpu" : "fake";
    } else if (flag === "--endpoint" && value !== undefined) {
      args.endpoint = value;
    } else if (flag === "--allowed-origin" && value !== undefined) {
      args.allowedOrigins = value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
    } else if (flag === "--model" && value !== undefined) {
      args.model = value;
    } else if (flag === "--model-revision" && value !== undefined) {
      args.modelRevision = value;
    } else if (flag === "--code-revision" && value !== undefined) {
      args.codeRevision = value;
    } else if (flag === "--timeout-ms" && value !== undefined) {
      args.timeoutMs = Number.parseInt(value, 10);
    } else if (flag === "--out" && value !== undefined) {
      args.out = value;
    }
  }
  return args;
};

/** The clause-category question, taken from the controlled catalogue. */
const categoryQuestion = (): {
  key: string;
  version: string;
  taskType: DecisionTaskType;
  options: string[];
  criteria: string;
} => {
  const entry = decisionQuestionCatalogue.find((candidate) => candidate.key === "clause-category");
  if (entry === undefined || entry.question.type !== "choice") {
    throw new Error("clause-category question missing from the controlled catalogue");
  }
  return {
    key: entry.key,
    version: entry.version,
    taskType: entry.taskType,
    options: entry.question.options,
    criteria: entry.question.criteria,
  };
};

/**
 * Builds one frozen request per fixture. The masked excerpt is the clause
 * itself — it is synthetic by construction — and the identity, comparison and
 * coordinate fields are absent because the evaluation compares here, not in
 * the model.
 */
const requestFor = (
  fixture: (typeof syntheticClauseFixtures)[number],
  question: ReturnType<typeof categoryQuestion>,
): DecisionRequest => ({
  schemaVersion: 1,
  auditCaseId: "00000000-0000-4000-8000-0000000000e1",
  snapshotId: "00000000-0000-4000-8000-0000000000e2",
  agentRunId: "00000000-0000-4000-8000-0000000000e3",
  contractDocumentHash: fixture.id,
  taskType: question.taskType,
  questionKey: question.key,
  question: { type: "choice", criteria: question.criteria, options: question.options },
  questionVersion: question.version,
  policyVersion: "evaluation-policy-v1",
  redactionVersion: "evaluation-redaction-v1",
  contractStance: null,
  structuredSignals: {},
  maskedClauseExcerpt: fixture.clause,
  evidenceRefs: [],
  ruleAssessments: [],
  comparison: null,
  dataClassification: "SYNTHETIC",
  traceId: `evaluation-${fixture.id}`,
});

interface PerClauseResult {
  id: string;
  category: FixtureCategory;
  kind: string;
  expected: FixtureCategory;
  predicted: FixtureCategory | null;
  abstained: boolean;
  latencyMs: number;
  fallbackReason: string | null;
  confidence: number | null;
}

const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

const runEvaluation = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const question = categoryQuestion();
  const provider: DecisionProviderLike =
    args.provider === "laya-cpu"
      ? new LayaCpuDecisionProvider({
          endpoint: args.endpoint,
          allowedOrigins: args.allowedOrigins,
          model: args.model,
          timeoutMs: args.timeoutMs,
          modelRevision: args.modelRevision,
          codeRevision: args.codeRevision,
        })
      : new FakeDecisionProvider();

  const perClause: PerClauseResult[] = [];
  const latencies: number[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const fixture of syntheticClauseFixtures) {
    const request = requestFor(fixture, question);
    const startedAt = Date.now();
    const outcome = await provider.decide(request, new AbortController().signal);
    const latencyMs = Date.now() - startedAt;
    latencies.push(latencyMs);
    if (!outcome.ok) {
      failed += 1;
      perClause.push({
        id: fixture.id,
        category: fixture.category,
        kind: fixture.kind,
        expected: fixture.label,
        predicted: null,
        abstained: true,
        latencyMs,
        fallbackReason: outcome.failure.error,
        confidence: null,
      });
      continue;
    }
    succeeded += 1;
    const answer: DecisionAnswer = outcome.result.answer;
    perClause.push({
      id: fixture.id,
      category: fixture.category,
      kind: fixture.kind,
      expected: fixture.label,
      predicted: answer.type === "choice" ? (answer.choice as FixtureCategory) : null,
      abstained: false,
      latencyMs,
      fallbackReason: null,
      confidence: outcome.result.confidence,
    });
  }

  // Metrics over the clauses that produced an answer; abstentions are counted
  // separately so a path that refuses everything cannot look accurate.
  const answered = perClause.filter((row) => row.predicted !== null);
  const perCategory = FIXTURE_CATEGORIES.map((category) => {
    const truth = answered.filter((row) => row.expected === category);
    const predicted = answered.filter((row) => row.predicted === category);
    const truePositive = answered.filter(
      (row) => row.expected === category && row.predicted === category,
    ).length;
    const precision = predicted.length === 0 ? null : truePositive / predicted.length;
    const recall = truth.length === 0 ? null : truePositive / truth.length;
    const f1 =
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall);
    return { category, support: truth.length, truePositive, precision, recall, f1 };
  });
  const macroF1Values = perCategory
    .map((row) => row.f1)
    .filter((value): value is number => value !== null);
  const macroF1 =
    macroF1Values.length === 0
      ? null
      : macroF1Values.reduce((sum, value) => sum + value, 0) / macroF1Values.length;
  const accuracy =
    answered.length === 0
      ? null
      : answered.filter((row) => row.expected === row.predicted).length / answered.length;

  const confusion: Record<string, Record<string, number>> = {};
  for (const expected of FIXTURE_CATEGORIES) {
    confusion[expected] = Object.fromEntries(FIXTURE_CATEGORIES.map((actual) => [actual, 0]));
  }
  for (const row of answered) {
    if (row.predicted === null) continue;
    const bucket = confusion[row.expected];
    if (bucket === undefined) continue;
    bucket[row.predicted] = (bucket[row.predicted] ?? 0) + 1;
  }

  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    evaluation: {
      task: "clause_category",
      inputRevision: EVALUATION_INPUT_REVISION,
      questionCatalogueVersion: DECISION_QUESTION_CATALOGUE_VERSION,
      fixtureCount: syntheticClauseFixtures.length,
      labelProvenance: "developer reference labels; not independent human gold",
    },
    provider: {
      provider: provider.identity.provider,
      modelVersion: provider.identity.modelVersion,
      modelRevision: args.provider === "laya-cpu" ? args.modelRevision : null,
      codeRevision: args.provider === "laya-cpu" ? args.codeRevision : null,
      endpoint: args.provider === "laya-cpu" ? args.endpoint : null,
    },
    outcome: {
      answered: answered.length,
      abstained: perClause.length - answered.length,
      succeeded,
      failed,
    },
    metrics: {
      accuracy,
      macroF1,
      perCategory,
      confusionMatrix: confusion,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length === 0 ? null : Math.max(...latencies),
      },
    },
    perClause,
  };

  await Bun.write(args.out, `${JSON.stringify(report, null, 2)}\n`);
  // A concise stdout line, never a claim: the numbers live in the file.
  console.log(
    `[decision-eval] provider=${report.provider.provider} answered=${report.outcome.answered}/${syntheticClauseFixtures.length} abstained=${report.outcome.abstained} failed=${report.outcome.failed} macroF1=${macroF1 === null ? "n/a" : macroF1.toFixed(4)} p95=${report.metrics.latencyMs.p95 ?? "n/a"}ms out=${args.out}`,
  );
  if (answered.length === 0) {
    // Every clause failed: that is a reported failure, not a zero score.
    console.error("[decision-eval] no clause produced an answer; see perClause fallbackReason");
    process.exitCode = 1;
  }
};

await runEvaluation();
