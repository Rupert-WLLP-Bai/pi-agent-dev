import { isEngineRuleCode } from "@contract-audit/audit";
import { runGoldenValidation } from "@contract-audit/audit/golden-eval";
import { Elysia, t } from "elysia";
import { type RuleRepository, RuleRepositoryError } from "../db/rule-repository";
import type { RuleParams } from "../db/schema";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";

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

const RULE_TAGS = [openapiTags.rules];

const ruleVersionStatusSchema = t.Union([
  t.Literal("draft"),
  t.Literal("published"),
  t.Literal("retired"),
]);

const validationRunStatusSchema = t.Union([t.Literal("passed"), t.Literal("failed")]);

const validationSummarySchema = t.Object(
  {
    total: t.Number(),
    passed: t.Number(),
    failed: t.Number(),
    byCaseType: t.Record(
      t.Union([t.Literal("POSITIVE"), t.Literal("NEGATIVE"), t.Literal("BOUNDARY")]),
      t.Object({ total: t.Number(), passed: t.Number(), failed: t.Number() }),
      { description: "按案例形状（POSITIVE/NEGATIVE/BOUNDARY）拆分的通过/失败计数" },
    ),
  },
  { additionalProperties: true, description: "一次金标准验证的汇总。" },
);

const validationCaseResultSchema = t.Object(
  {
    caseName: t.String(),
    caseType: t.Union([t.Literal("POSITIVE"), t.Literal("NEGATIVE"), t.Literal("BOUNDARY")]),
    expected: t.String(),
    actual: t.String(),
    passed: t.Boolean(),
    note: t.String({ description: "失败原因；通过时为空串" }),
  },
  { additionalProperties: true, description: "一个金标准案例的运行结果。" },
);

const ruleRecordSchema = t.Object(
  {
    id: t.String(),
    code: t.String(),
    name: t.String(),
    contractType: t.String(),
    description: t.String(),
    enabled: t.Boolean(),
    disabledReason: t.Union([t.String(), t.Null()]),
    disabledBy: t.Union([t.String(), t.Null()]),
    disabledAt: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
  },
  { additionalProperties: true, description: "一条规则。" },
);

const ruleVersionSchema = t.Object(
  {
    id: t.String(),
    ruleId: t.String(),
    version: t.Number(),
    params: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean()]), {
      description: "扁平的原语参数集（string | number | boolean）",
    }),
    stances: stancesSchema,
    status: ruleVersionStatusSchema,
    publishedBy: t.Union([t.String(), t.Null()]),
    publishedAt: t.Union([t.String(), t.Null()]),
    lastValidationRunId: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
  },
  { additionalProperties: true, description: "一个规则版本。已发布版本不可变。" },
);

const validationRunSchema = t.Object(
  {
    id: t.String(),
    ruleVersionId: t.String(),
    ruleCode: t.String(),
    triggeredBy: t.String(),
    startedAt: t.String(),
    finishedAt: t.String(),
    status: validationRunStatusSchema,
    summary: validationSummarySchema,
    details: t.Array(validationCaseResultSchema, { description: "每个金标准案例的结果" }),
  },
  { additionalProperties: true, description: "一次金标准验证运行。只追加。" },
);

const ruleListItemSchema = t.Object(
  {
    id: t.String(),
    code: t.String(),
    name: t.String(),
    contractType: t.String(),
    description: t.String(),
    enabled: t.Boolean(),
    disabledReason: t.Union([t.String(), t.Null()]),
    disabledBy: t.Union([t.String(), t.Null()]),
    disabledAt: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
    currentVersion: t.Union([t.Number(), t.Null()], {
      description: "最高版本号；有草稿时即草稿版本号",
    }),
    status: t.Union([ruleVersionStatusSchema, t.Null()], {
      description: "最高版本的状态：draft / published / retired",
    }),
    lastValidation: t.Union([
      t.Object({
        status: validationRunStatusSchema,
        finishedAt: t.String(),
        summary: validationSummarySchema,
      }),
      t.Null(),
    ]),
    publishedBy: t.Union([t.String(), t.Null()]),
  },
  { additionalProperties: true, description: "规则管理表格的一行。" },
);

const ruleDetailSchema = t.Object(
  {
    rule: ruleRecordSchema,
    versions: t.Array(ruleVersionSchema, { description: "全部版本，最新在前" }),
    activeDraft: t.Union([ruleVersionSchema, t.Null()], {
      description: "当前打开的草稿，每个规则至多一个",
    }),
    draftValidationRun: t.Union([validationRunSchema, t.Null()]),
  },
  { additionalProperties: true, description: "规则详情。" },
);

const actionLogSchema = t.Object(
  {
    id: t.String(),
    ruleId: t.String(),
    action: t.String({ description: "disable / enable / publish" }),
    actor: t.String(),
    reason: t.Union([t.String(), t.Null()]),
    versionId: t.Union([t.String(), t.Null()], {
      description: "publish 提升的版本；disable/enable 为 null",
    }),
    createdAt: t.String(),
  },
  { additionalProperties: true, description: "一条规则治理记录。" },
);

const ruleEnvelopeSchema = t.Object({ rule: ruleRecordSchema }, { additionalProperties: true });

const versionEnvelopeSchema = t.Object(
  { version: ruleVersionSchema },
  { additionalProperties: true },
);

const runEnvelopeSchema = t.Object({ run: validationRunSchema }, { additionalProperties: true });

const publishEnvelopeSchema = t.Object(
  { rule: ruleRecordSchema, version: ruleVersionSchema },
  { additionalProperties: true },
);

const RULE_ERROR_RESPONSES = {
  400: errorSchema,
  404: notFoundSchema,
  409: errorSchema,
  422: errorSchema,
};

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
      .get("/api/rules", async () => rules.listRules(), {
        detail: {
          summary: "列出规则",
          description:
            "返回规则目录（规则管理表格的数据源），按创建顺序排列。每行含规则基本信息、最高版本号与其状态、最近一次验证摘要与当前发布人。\n\n" +
            "- 只读。规则参数本身不在此返回，需要时取 `GET /api/rules/{id}`。",
          tags: RULE_TAGS,
        },
        response: { 200: t.Array(ruleListItemSchema) },
      })
      .get(
        "/api/rules/:id",
        async ({ params, set }) => {
          const detail = await rules.getRuleDetail(params.id);
          if (!detail) {
            set.status = 404;
            return { error: "规则不存在" };
          }
          return detail;
        },
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          detail: {
            summary: "获取规则详情",
            description:
              "返回一条规则的完整详情：规则本身、全部版本（最新在前）、当前打开的草稿（至多一个）以及为该草稿把关的验证运行。\n\n" +
              "- 已发布版本是不可变的，是审计快照引用参数的对象；修改参数只能新建草稿。\n\n" +
              "状态码：`200` 正常；`404` 规则不存在；`422` 路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: ruleDetailSchema, 404: notFoundSchema, 422: errorSchema },
        },
      )
      // The governance trail: every disable, enable and publish on this rule,
      // newest first. Read-only — the record is append-only.
      .get(
        "/api/rules/:id/actions",
        async ({ params }) => {
          const actions = await rules.listActions(params.id);
          return { actions };
        },
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          detail: {
            summary: "获取规则操作记录",
            description:
              "返回一条规则的治理轨迹：每一次停用、启用与发布，最新在前，含操作人、时间、原因与被提升的版本。" +
              "记录**只追加**，是规则编辑器「操作记录」标签页的数据源。\n\n" +
              "- 只读。\n\n" +
              "状态码：`200` 正常（无记录时 `actions` 为空数组）；`422` 路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: {
            200: t.Object({ actions: t.Array(actionLogSchema) }, { additionalProperties: true }),
            422: errorSchema,
          },
        },
      )
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
        {
          body: createRuleBody,
          detail: {
            summary: "新建规则",
            description:
              "用引擎目录中已有的规则代码新建一条规则，并附带其首个版本参数。代码必须属于引擎目录（`isEngineRuleCode`），否则 `400`。\n\n" +
              "- 参数集必须是**扁平的原语键值**（string / number / boolean）；嵌套结构在 schema 之外被拒绝，返回 `400` 与可读原因。\n" +
              "- `stances` 是四种谈判立场的中文说明，可为空串。\n" +
              "- 幂等性：**非幂等**，重复的 `code` 会命中仓库的状态冲突。\n\n" +
              "状态码：`201` 创建成功并返回规则详情；`400` 代码不在引擎目录或参数格式不正确；`409` 代码重复等状态冲突；`422` 请求体不合法。",
            tags: RULE_TAGS,
          },
          response: { 201: ruleDetailSchema, ...RULE_ERROR_RESPONSES },
        },
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
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: updateRuleBody,
          detail: {
            summary: "更新规则元信息",
            description:
              "修改规则的名称、适用合同类型或描述。**不涉及参数**——参数只能通过版本接口修改。\n\n" +
              "- 幂等性：**幂等**，重复提交相同的字段值结果不变。\n\n" +
              "状态码：`200` 返回更新后的规则；`404` 规则不存在；`409` 状态冲突；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: ruleEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
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
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: versionBody,
          detail: {
            summary: "新建规则版本（草稿）",
            description:
              "为规则新建一个**草稿**版本，带一组新的扁平参数与谈判立场。每个规则至多同时存在一个草稿；已有草稿时返回 `409`。\n\n" +
              "- 参数必须是扁平的原语键值，否则 `400`。\n" +
              "- 草稿要经过金标准案例验证通过后才能发布。\n" +
              "- 幂等性：**非幂等**，每次调用都新建一个版本。\n\n" +
              "状态码：`201` 返回新建的版本；`400` 参数格式不正确；`404` 规则不存在；`409` 已有打开的草稿或其它冲突；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 201: versionEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
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
        {
          params: t.Object({
            id: t.String({ description: "规则 id" }),
            versionId: t.String({ description: "版本 id" }),
          }),
          body: versionBody,
          detail: {
            summary: "修订规则草稿",
            description:
              "修订规则当前打开的**草稿**版本：覆盖其参数与立场。已发布版本不可变，因此本接口只会作用于草稿——" +
              "这正是操作员在验证失败后可以修正参数、而不必另开一个草稿的原因。\n\n" +
              "- 参数必须是扁平的原语键值，否则 `400`。\n" +
              "- 幂等性：**幂等**，同一组参数重复提交结果相同。\n\n" +
              "状态码：`200` 返回修订后的版本；`400` 参数格式不正确；`404` 规则或版本不存在；`409` 目标不是可编辑的草稿；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: versionEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
      )
      .post(
        "/api/rules/:id/validate",
        async ({ params, body, set, headers }) => {
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
            triggeredBy: operatorFrom(headers) ?? body.triggeredBy,
            startedAt,
            summary: result.summary,
            details: result.details,
          });
          return { run };
        },
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: t.Object({
            triggeredBy: t.String({ description: "触发人；可由 X-Operator 覆盖" }),
          }),
          detail: {
            summary: "用金标准案例验证草稿",
            description:
              "在进程内用该规则当前**草稿**的参数运行金标准案例集，记录每个案例的结果，并返回这次验证运行。\n\n" +
              "- 前置条件：规则必须存在且有一个打开的草稿；没有草稿返回 `409`。\n" +
              "- 触发人取自 `X-Operator`，缺省回落到请求体的 `triggeredBy`。\n" +
              "- 副作用：追加一条验证运行记录（append-only），它是发布门禁读取的最新一次运行。\n" +
              "- 幂等性：**非幂等**，每次调用都会新增一条运行记录。\n\n" +
              "状态码：`200` 返回验证运行；`404` 规则不存在；`409` 没有待验证的草稿；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: runEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
      )
      .post(
        "/api/rules/:id/publish",
        async ({ params, body, set, headers }) => {
          try {
            const result = await rules.publish(
              params.id,
              operatorFrom(headers) ?? body.publishedBy,
            );
            return { rule: result.rule, version: result.version };
          } catch (error) {
            if (error instanceof RuleRepositoryError) {
              set.status = error.status;
              return { error: error.message };
            }
            throw error;
          }
        },
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: t.Object({
            publishedBy: t.String({ description: "发布人；可由 X-Operator 覆盖" }),
          }),
          detail: {
            summary: "发布规则版本",
            description:
              "把规则的当前草稿发布为新的已发布版本：现有已发布版本被退休，草稿被提升。发布**不可逆**，已发布版本此后不可变，审计快照会引用它。\n\n" +
              "- 门禁：草稿必须已通过金标准案例验证（由仓库判定），未通过时按状态冲突返回 `409`。\n" +
              "- 发布人取自 `X-Operator`，缺省回落到请求体的 `publishedBy`。\n" +
              "- 副作用：写一条 `publish` 治理记录。\n" +
              "- 幂等性：**非幂等**，重复发布没有草稿可提升时返回 `409`。\n\n" +
              "状态码：`200` 返回 `{ rule, version }`；`404` 规则不存在；`409` 发布门禁未满足或无可发布草稿；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: publishEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
      )
      .post(
        "/api/rules/:id/disable",
        async ({ params, body, set, headers }) => {
          try {
            const rule = await rules.disableRule(params.id, {
              reason: body.reason,
              actor: operatorFrom(headers) ?? body.actor ?? "规则管理员",
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
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: t.Object({
            reason: t.String({ description: "停用原因，记入治理记录" }),
            actor: t.Optional(
              t.String({ description: "操作人；可由 X-Operator 覆盖，缺省「规则管理员」" }),
            ),
          }),
          detail: {
            summary: "停用规则",
            description:
              "停用一条规则。停用后，新建的审计快照在组装评估时会**完全省略**这条规则；已经产生的历史评估不受影响。\n\n" +
              "- 操作人取自 `X-Operator`，缺省回落到请求体的 `actor`，再缺省为「规则管理员」。\n" +
              "- 副作用：写一条带原因的 `disable` 治理记录。\n" +
              "- 幂等性：**幂等**——重复停用不改变结果（仍会记录）。\n\n" +
              "状态码：`200` 返回更新后的规则；`404` 规则不存在；`409` 状态冲突；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: ruleEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
      )
      .post(
        "/api/rules/:id/enable",
        async ({ params, body, set, headers }) => {
          try {
            const rule = await rules.enableRule(params.id, {
              actor: operatorFrom(headers) ?? body.actor ?? "规则管理员",
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
        {
          params: t.Object({ id: t.String({ description: "规则 id" }) }),
          body: t.Object({
            actor: t.Optional(
              t.String({ description: "操作人；可由 X-Operator 覆盖，缺省「规则管理员」" }),
            ),
          }),
          detail: {
            summary: "启用规则",
            description:
              "重新启用一条已停用的规则。之后新建的审计快照会重新包含这条规则的评估。\n\n" +
              "- 操作人取自 `X-Operator`，缺省回落到请求体的 `actor`，再缺省为「规则管理员」。\n" +
              "- 副作用：写一条 `enable` 治理记录。\n" +
              "- 幂等性：**幂等**，重复启用不改变结果。\n\n" +
              "状态码：`200` 返回更新后的规则；`404` 规则不存在；`409` 状态冲突；`422` 请求体/路径参数不合法。",
            tags: RULE_TAGS,
          },
          response: { 200: ruleEnvelopeSchema, ...RULE_ERROR_RESPONSES },
        },
      )
  );
}
