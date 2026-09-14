import type { ValidationCaseResult, ValidationSummary } from "@contract-audit/audit/golden-eval";
import { runGoldenValidation } from "@contract-audit/audit/golden-eval";
import { Elysia, t } from "elysia";
import type { RuleDetail, RuleRepository } from "../db/rule-repository";
import type { RuleVersionStatus, ValidationCaseType, ValidationRunStatus } from "../db/schema";
import { validationCaseTypes } from "../db/schema";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";
import { compareValidationRuns, type ValidationDiffEntry } from "../validation-diff";

export interface ValidationRouteDeps {
  rules: RuleRepository;
}

/** What `GET /api/validation/runs/:id` returns: the run, its cases, its baseline delta. */
export interface ValidationRunView {
  run: {
    id: string;
    ruleId: string;
    ruleCode: string;
    ruleName: string;
    ruleVersion: number;
    versionStatus: RuleVersionStatus;
    status: ValidationRunStatus;
    triggeredBy: string;
    startedAt: string;
    finishedAt: string;
  };
  summary: ValidationSummary;
  details: ValidationCaseResult[];
  previous: { id: string; ruleVersion: number; finishedAt: string } | null;
  diff: ValidationDiffEntry[];
}

const casesQuery = t.Object({
  ruleCode: t.Optional(t.String()),
  caseType: t.Optional(t.String()),
});

const runsQuery = t.Object({
  ruleId: t.Optional(t.String()),
  limit: t.Optional(t.Numeric()),
});

const runBody = t.Object({
  ruleId: t.Optional(t.String({ description: "只运行该规则；缺省运行全部规则" })),
  triggeredBy: t.String({ description: "触发人；可由 X-Operator 覆盖" }),
});

const VALIDATION_TAGS = [openapiTags.validation];

const ruleVersionStatusSchema = t.Union([
  t.Literal("draft"),
  t.Literal("published"),
  t.Literal("retired"),
]);

const validationRunStatusSchema = t.Union([t.Literal("passed"), t.Literal("failed")]);

const goldenCaseTypeSchema = t.Union([
  t.Literal("POSITIVE"),
  t.Literal("NEGATIVE"),
  t.Literal("BOUNDARY"),
]);

const validationOutcomeSchema = t.Union([
  t.Literal("pass"),
  t.Literal("fail"),
  t.Literal("needs_review"),
]);

const validationChangeSchema = t.Union([
  t.Literal("regression"),
  t.Literal("fixed"),
  t.Literal("unchanged"),
  t.Literal("new"),
]);

/** The validation summary every run carries. */
const validationSummarySchema = t.Object(
  {
    total: t.Number(),
    passed: t.Number(),
    failed: t.Number(),
    byCaseType: t.Record(
      goldenCaseTypeSchema,
      t.Object({ total: t.Number(), passed: t.Number(), failed: t.Number() }),
      { description: "按案例形状（POSITIVE/NEGATIVE/BOUNDARY）拆分的通过/失败计数" },
    ),
  },
  { additionalProperties: true },
);

const validationCaseResultSchema = t.Object(
  {
    caseName: t.String(),
    caseType: goldenCaseTypeSchema,
    expected: t.String(),
    actual: t.String(),
    passed: t.Boolean(),
    note: t.String({ description: "失败原因；通过时为空串" }),
  },
  { additionalProperties: true },
);

/** One materialised golden case as the 案例验证 catalog lists it. */
const validationCaseListItemSchema = t.Object(
  {
    id: t.String(),
    ruleCode: t.String(),
    caseType: t.Union([
      t.Literal("positive"),
      t.Literal("negative"),
      t.Literal("boundary"),
      t.Literal("false_positive"),
      t.Literal("missing_evidence"),
    ]),
    name: t.String(),
    input: t.String(),
    expectedDisposition: t.String(),
    expectedNote: t.String(),
    createdAt: t.String(),
    latest: t.Union(
      [
        t.Object({
          runId: t.String(),
          finishedAt: t.String(),
          outcome: validationOutcomeSchema,
          expected: t.String(),
          actual: t.String(),
        }),
        t.Null(),
      ],
      { description: "该案例在所属规则最新一次运行中的结果；无运行时为 null" },
    ),
  },
  { additionalProperties: true, description: "金标准案例目录行。" },
);

const validationRunListItemSchema = t.Object(
  {
    id: t.String(),
    ruleId: t.String(),
    ruleCode: t.String(),
    ruleName: t.String(),
    ruleVersion: t.Number(),
    versionStatus: ruleVersionStatusSchema,
    status: validationRunStatusSchema,
    summary: validationSummarySchema,
    triggeredBy: t.String(),
    startedAt: t.String(),
    finishedAt: t.String(),
  },
  { additionalProperties: true, description: "一次验证运行的历史列表行。" },
);

const validationRunViewSchema = t.Object(
  {
    run: t.Object(
      {
        id: t.String(),
        ruleId: t.String(),
        ruleCode: t.String(),
        ruleName: t.String(),
        ruleVersion: t.Number(),
        versionStatus: ruleVersionStatusSchema,
        status: validationRunStatusSchema,
        triggeredBy: t.String(),
        startedAt: t.String(),
        finishedAt: t.String(),
      },
      { additionalProperties: true },
    ),
    summary: validationSummarySchema,
    details: t.Array(validationCaseResultSchema),
    previous: t.Union(
      [t.Object({ id: t.String(), ruleVersion: t.Number(), finishedAt: t.String() }), t.Null()],
      { description: "同一规则上一次运行；无基线时为 null" },
    ),
    diff: t.Array(
      t.Object({
        caseName: t.String(),
        caseType: goldenCaseTypeSchema,
        previous: t.Union([validationOutcomeSchema, t.Null()]),
        previousActual: t.Union([t.String(), t.Null()]),
        current: validationOutcomeSchema,
        currentActual: t.String(),
        change: validationChangeSchema,
        note: t.String(),
      }),
      { description: "本次运行相对上一次的变化明细（regression/fixed/unchanged/new）" },
    ),
  },
  { additionalProperties: true, description: "验证运行详情。" },
);

/** Narrows a raw query string to the enum before it reaches the repository. */
const isCaseType = (value: string): value is ValidationCaseType =>
  (validationCaseTypes as readonly string[]).includes(value);

/**
 * Ids are UUIDs; a malformed one would reach Postgres as an invalid uuid
 * literal and surface as a 500, so it is rejected as "not found" up front.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 案例验证. Cases are the materialised golden set; a run executes the current
 * parameter set of a rule version in-process and records what each case did.
 * The run's detail compares against the prior run so a regression is named, not
 * hidden behind a score.
 */
export function validationRoutes({ rules }: ValidationRouteDeps) {
  return new Elysia()
    .get(
      "/api/validation/cases",
      async ({ query, set }) => {
        if (query.caseType !== undefined && !isCaseType(query.caseType)) {
          set.status = 400;
          return { error: "案例类型不正确" };
        }
        return rules.listValidationCases({
          ruleCode: query.ruleCode,
          caseType: query.caseType,
        });
      },
      {
        query: casesQuery,
        detail: {
          summary: "列出金标准案例",
          description:
            "返回金标准案例目录（案例验证页的数据源），可按规则代码与案例类型过滤。每个案例带上它在所属规则最近一次运行中的结果（若有）。\n\n" +
            "- `caseType` 只接受 POSITIVE / NEGATIVE / BOUNDARY；其它取值返回 `400` 而非静默忽略。\n" +
            "- 只读。",
          tags: VALIDATION_TAGS,
        },
        response: {
          200: t.Array(validationCaseListItemSchema),
          400: errorSchema,
          422: errorSchema,
        },
      },
    )
    .post(
      "/api/validation/runs",
      async ({ body, set, headers }) => {
        const details: RuleDetail[] = [];
        if (body.ruleId !== undefined) {
          if (!UUID_PATTERN.test(body.ruleId)) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          const detail = await rules.getRuleDetail(body.ruleId);
          if (!detail) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          details.push(detail);
        } else {
          for (const rule of await rules.listRules()) {
            const detail = await rules.getRuleDetail(rule.id);
            if (detail) details.push(detail);
          }
        }

        const runs = [];
        const skipped = [];
        for (const detail of details) {
          // The open draft is what an operator is iterating on; without one,
          // the run measures the currently published parameters.
          const version =
            detail.activeDraft ??
            detail.versions.find((item) => item.status === "published") ??
            null;
          if (!version) {
            skipped.push({
              ruleId: detail.rule.id,
              ruleCode: detail.rule.code,
              ruleName: detail.rule.name,
              reason: "规则没有可运行的版本",
            });
            continue;
          }

          const startedAt = new Date();
          const result = runGoldenValidation(detail.rule.code, version.params);
          const run = await rules.recordValidation({
            ruleVersionId: version.id,
            ruleCode: detail.rule.code,
            triggeredBy: operatorFrom(headers) ?? body.triggeredBy,
            startedAt,
            summary: result.summary,
            details: result.details,
          });
          runs.push({
            id: run.id,
            ruleId: detail.rule.id,
            ruleCode: detail.rule.code,
            ruleName: detail.rule.name,
            ruleVersion: version.version,
            versionStatus: version.status,
            status: run.status,
            summary: run.summary,
            triggeredBy: run.triggeredBy,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          });
        }
        return { runs, skipped };
      },
      {
        body: runBody,
        detail: {
          summary: "发起案例验证运行",
          description:
            "对一条规则（或全部规则）当前可运行的版本执行金标准案例集，并在进程内记录每个案例的结果。\n\n" +
            "- 版本选择：优先当前打开的**草稿**，没有草稿则取当前已发布版本；两者都没有的规则会被跳过，并在 `skipped` 中给出原因（如「规则没有可运行的版本」）。\n" +
            "- `ruleId` 为非法 UUID 或对应规则不存在时返回 `404`。\n" +
            "- 触发人取自 `X-Operator`，缺省回落到请求体的 `triggeredBy`。\n" +
            "- 副作用：为每个被运行的规则追加一条验证运行记录（只追加）。\n" +
            "- 幂等性：**非幂等**，每次调用都会新增运行记录。\n\n" +
            "状态码：`200` 返回 `{ runs, skipped }`；`404` 规则不存在；`422` 请求体不合法。",
          tags: VALIDATION_TAGS,
        },
        response: {
          200: t.Object(
            {
              runs: t.Array(validationRunListItemSchema),
              skipped: t.Array(
                t.Object({
                  ruleId: t.String(),
                  ruleCode: t.String(),
                  ruleName: t.String(),
                  reason: t.String(),
                }),
                { description: "被跳过的规则及原因" },
              ),
            },
            { additionalProperties: true },
          ),
          404: notFoundSchema,
          422: errorSchema,
        },
      },
    )
    .get(
      "/api/validation/runs",
      async ({ query, set }) => {
        let ruleCode: string | undefined;
        if (query.ruleId !== undefined) {
          if (!UUID_PATTERN.test(query.ruleId)) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          const detail = await rules.getRuleDetail(query.ruleId);
          if (!detail) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          ruleCode = detail.rule.code;
        }
        return rules.listValidationRuns({ ruleCode, limit: query.limit });
      },
      {
        query: runsQuery,
        detail: {
          summary: "列出验证运行",
          description:
            "返回验证运行历史，可按规则过滤与限制条数。每一行解析出规则名与版本，含验证汇总，但不含逐案例明细。\n\n" +
            "- `ruleId` 为非法 UUID 或对应规则不存在时返回 `404`，而不是空列表。\n" +
            "- 只读。",
          tags: VALIDATION_TAGS,
        },
        response: {
          200: t.Array(validationRunListItemSchema),
          404: notFoundSchema,
          422: errorSchema,
        },
      },
    )
    .get(
      "/api/validation/runs/:id",
      async ({ params, set }): Promise<ValidationRunView | { error: string }> => {
        if (!UUID_PATTERN.test(params.id)) {
          set.status = 404;
          return { error: "验证运行不存在" };
        }
        const current = await rules.getValidationRunDetail(params.id);
        if (!current) {
          set.status = 404;
          return { error: "验证运行不存在" };
        }
        const previous = await rules.getPreviousValidationRun(current.ruleCode, current.id);
        return {
          run: {
            id: current.id,
            ruleId: current.ruleId,
            ruleCode: current.ruleCode,
            ruleName: current.ruleName,
            ruleVersion: current.ruleVersion,
            versionStatus: current.versionStatus,
            status: current.status,
            triggeredBy: current.triggeredBy,
            startedAt: current.startedAt,
            finishedAt: current.finishedAt,
          },
          summary: current.summary,
          details: current.details,
          previous: previous
            ? {
                id: previous.id,
                ruleVersion: previous.ruleVersion,
                finishedAt: previous.finishedAt,
              }
            : null,
          diff: compareValidationRuns(current.details, previous?.details ?? null),
        };
      },
      {
        params: t.Object({ id: t.String({ description: "验证运行 id（UUID）" }) }),
        detail: {
          summary: "获取验证运行详情",
          description:
            "返回一次验证运行的完整视图：运行本身、逐案例结果，以及它与**同一规则上一次运行**的对比（`previous` 与 `diff`）。" +
            "对比的意义是点名两个规则版本之间真正变化了什么，而不是打印一个分数。\n\n" +
            "- 非法 UUID 直接按「不存在」处理（返回 `404`），避免其抵达 Postgres 变成 500。\n" +
            "- `diff` 中每次变化取值为 regression / fixed / unchanged / new；首个运行或新增案例记为 `new`。\n\n" +
            "状态码：`200` 正常；`404` 运行不存在；`422` 路径参数不合法。",
          tags: VALIDATION_TAGS,
        },
        response: {
          200: validationRunViewSchema,
          404: notFoundSchema,
          422: errorSchema,
        },
      },
    );
}
