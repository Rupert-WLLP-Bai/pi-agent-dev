import type { ValidationCaseResult, ValidationSummary } from "@contract-audit/audit/golden-eval";
import { runGoldenValidation } from "@contract-audit/audit/golden-eval";
import { Elysia, t } from "elysia";
import type { RuleDetail, RuleRepository } from "../db/rule-repository";
import type { RuleVersionStatus, ValidationCaseType, ValidationRunStatus } from "../db/schema";
import { validationCaseTypes } from "../db/schema";
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
  ruleId: t.Optional(t.String()),
  triggeredBy: t.String(),
});

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
      { query: casesQuery },
    )
    .post(
      "/api/validation/runs",
      async ({ body, set }) => {
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
            triggeredBy: body.triggeredBy,
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
      { body: runBody },
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
      { query: runsQuery },
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
    );
}
