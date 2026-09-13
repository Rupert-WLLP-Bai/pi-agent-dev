import { isEngineRuleCode } from "@contract-audit/audit";
import { runGoldenValidation } from "@contract-audit/audit/golden-eval";
import { Elysia, t } from "elysia";
import { type RuleRepository, RuleRepositoryError } from "../db/rule-repository";
import type { RuleParams } from "../db/schema";

export interface RulesRouteDeps {
  rules: RuleRepository;
}

const stancesSchema = t.Object({
  preferred: t.String(),
  acceptableRetreat: t.String(),
  unacceptable: t.String(),
  exceptionApproval: t.String(),
});

const createRuleBody = t.Object({
  code: t.String(),
  name: t.String(),
  contractType: t.String(),
  description: t.Optional(t.String()),
  params: t.Any(),
  stances: stancesSchema,
});

const versionBody = t.Object({
  params: t.Any(),
  stances: stancesSchema,
});

const updateRuleBody = t.Object({
  name: t.Optional(t.String()),
  contractType: t.Optional(t.String()),
  description: t.Optional(t.String()),
});

/**
 * Accepts a flat object of primitive values as a rule parameter set. Nested
 * structures are rejected here rather than by the schema so a malformed body
 * is a 400 with a readable reason, not a generic validation failure.
 */
function toRuleParams(value: unknown): RuleParams | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const params: RuleParams = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" || typeof raw === "boolean") {
      params[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      params[key] = raw;
    } else {
      return null;
    }
  }
  return params;
}

export function rulesRoutes({ rules }: RulesRouteDeps) {
  return (
    new Elysia()
      .get("/api/rules", async () => rules.listRules())
      .get("/api/rules/:id", async ({ params, set }) => {
        const detail = await rules.getRuleDetail(params.id);
        if (!detail) {
          set.status = 404;
          return { error: "规则不存在" };
        }
        return detail;
      })
      // The governance trail: every disable, enable and publish on this rule,
      // newest first. Read-only — the record is append-only.
      .get("/api/rules/:id/actions", async ({ params }) => {
        const actions = await rules.listActions(params.id);
        return { actions };
      })
      .post(
        "/api/rules",
        async ({ body, set }) => {
          if (!isEngineRuleCode(body.code)) {
            set.status = 400;
            return { error: "规则代码不在引擎目录中" };
          }
          const ruleParams = toRuleParams(body.params);
          if (!ruleParams) {
            set.status = 400;
            return { error: "规则参数格式不正确" };
          }
          try {
            const detail = await rules.createRule({
              code: body.code,
              name: body.name,
              contractType: body.contractType,
              description: body.description ?? "",
              params: ruleParams,
              stances: body.stances,
            });
            set.status = 201;
            return detail;
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: createRuleBody },
      )
      .put(
        "/api/rules/:id",
        async ({ params, body, set }) => {
          try {
            const rule = await rules.updateRule(params.id, body);
            return { rule };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: updateRuleBody },
      )
      .post(
        "/api/rules/:id/versions",
        async ({ params, body, set }) => {
          const ruleParams = toRuleParams(body.params);
          if (!ruleParams) {
            set.status = 400;
            return { error: "规则参数格式不正确" };
          }
          try {
            const version = await rules.createVersion(params.id, {
              params: ruleParams,
              stances: body.stances,
            });
            set.status = 201;
            return { version };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: versionBody },
      )
      // Revises the open draft. Published versions are immutable, so this only
      // ever touches a draft — which is what lets an operator correct a
      // parameter set after a failed validation without opening a second draft.
      .put(
        "/api/rules/:id/versions/:versionId",
        async ({ params, body, set }) => {
          const ruleParams = toRuleParams(body.params);
          if (!ruleParams) {
            set.status = 400;
            return { error: "规则参数格式不正确" };
          }
          try {
            const version = await rules.updateDraft(params.id, params.versionId, {
              params: ruleParams,
              stances: body.stances,
            });
            return { version };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: versionBody },
      )
      .post(
        "/api/rules/:id/validate",
        async ({ params, body, set }) => {
          const detail = await rules.getRuleDetail(params.id);
          if (!detail) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          const draft = detail.activeDraft;
          if (!draft) {
            set.status = 409;
            return { error: "没有待验证的草稿版本" };
          }

          const startedAt = new Date();
          const result = runGoldenValidation(detail.rule.code, draft.params);
          const run = await rules.recordValidation({
            ruleVersionId: draft.id,
            ruleCode: detail.rule.code,
            triggeredBy: body.triggeredBy,
            startedAt,
            summary: result.summary,
            details: result.details,
          });
          return { run };
        },
        { body: t.Object({ triggeredBy: t.String() }) },
      )
      .post(
        "/api/rules/:id/publish",
        async ({ params, body, set }) => {
          try {
            const result = await rules.publish(params.id, body.publishedBy);
            return { rule: result.rule, version: result.version };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: t.Object({ publishedBy: t.String() }) },
      )
      .post(
        "/api/rules/:id/disable",
        async ({ params, body, set }) => {
          try {
            const rule = await rules.disableRule(params.id, {
              reason: body.reason,
              actor: body.actor ?? "规则管理员",
            });
            return { rule };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: t.Object({ reason: t.String(), actor: t.Optional(t.String()) }) },
      )
      .post(
        "/api/rules/:id/enable",
        async ({ params, body, set }) => {
          try {
            const rule = await rules.enableRule(params.id, {
              actor: body.actor ?? "规则管理员",
            });
            return { rule };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        { body: t.Object({ actor: t.Optional(t.String()) }) },
      )
  );
}
