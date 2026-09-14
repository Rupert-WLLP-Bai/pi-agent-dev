import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";

export interface AgentRunRouteDeps {
  repository: AuditCaseRepository;
}

const DEFAULT_RUN_LIMIT = 25;

const AGENT_RUN_TAGS = [openapiTags.agentRuns];

const agentRunSchema = t.Object(
  {
    id: t.String(),
    auditCaseId: t.String(),
    provider: t.String(),
    model: t.String(),
    version: t.String(),
    usage: t.Union([t.Record(t.String(), t.Number()), t.Null()]),
    durationMs: t.Union([t.Number(), t.Null()]),
    error: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
  },
  { additionalProperties: true, description: "一次 Agent 运行。" },
);

const contractPartySchema = t.Object(
  {
    id: t.String({ description: "可被主体核验引用的稳定 id" }),
    label: t.String({ description: "合同中的称谓，如 甲方" }),
    name: t.String(),
    evidenceId: t.String({ description: "覆盖抽取名称的证据定位符" }),
  },
  { additionalProperties: true, description: "合同当事人。" },
);

/** A run-list row: the run plus the case it audited and how much it traced. */
const agentRunSummarySchema = t.Object(
  {
    id: t.String(),
    auditCaseId: t.String(),
    provider: t.String(),
    model: t.String(),
    version: t.String(),
    usage: t.Union([t.Record(t.String(), t.Number()), t.Null()]),
    durationMs: t.Union([t.Number(), t.Null()]),
    error: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    contractTitle: t.Union([t.String(), t.Null()]),
    parties: t.Array(contractPartySchema, { description: "合同当事人" }),
    caseStatus: t.Union(
      [
        t.Literal("PENDING"),
        t.Literal("RUNNING"),
        t.Literal("COMPLETED"),
        t.Literal("FAILED"),
        t.Literal("CANCELLED"),
        t.Literal("INTERRUPTED"),
      ],
      { description: "所属案件的状态" },
    ),
    stepCount: t.Number({ description: "该运行记录的轨迹步数" }),
  },
  { additionalProperties: true, description: "Agent 运行列表行。" },
);

/** One collected trace step: the agent's observation plus its place in the run. */
const agentTraceStepSchema = t.Object(
  {
    runId: t.String(),
    sequence: t.Number(),
    kind: t.Union([
      t.Literal("STAGE"),
      t.Literal("TOOL_CALL"),
      t.Literal("TOOL_RESULT"),
      t.Literal("MESSAGE"),
    ]),
    at: t.String(),
    label: t.String(),
    ref: t.Union([t.String(), t.Null()]),
    input: t.Any({ description: "工具参数；无参数时为 null" }),
    output: t.Any({ description: "工具返回值；无返回值时为 null" }),
    isError: t.Boolean(),
    durationMs: t.Union([t.Number(), t.Null()]),
    tokens: t.Union([t.Object({ input: t.Number(), output: t.Number() }), t.Null()]),
  },
  { additionalProperties: true, description: "轨迹中的一步。" },
);

const agentRunTraceSchema = t.Object(
  { run: agentRunSchema, steps: t.Array(agentTraceStepSchema) },
  { additionalProperties: true, description: "{ run, steps } 的运行轨迹。" },
);

/**
 * Agent Run traces.
 *
 * The trace endpoint is case-scoped because a trace only means anything next to
 * the case it audited; the index endpoint answers "what has the agent been
 * doing lately" across every case.
 */
export function agentRunsRoutes({ repository }: AgentRunRouteDeps) {
  return new Elysia()
    .get(
      "/api/agent-runs",
      ({ query }) => repository.getRecentRuns(query.limit ?? DEFAULT_RUN_LIMIT),
      {
        query: t.Object({
          limit: t.Optional(
            t.Numeric({
              minimum: 1,
              maximum: 100,
              description: "返回条数上限；缺省 25，范围 1–100",
            }),
          ),
        }),
        detail: {
          summary: "列出最近的 Agent 运行",
          description:
            "跨全部案件返回最近的 Agent 运行，按时间倒序，用于回答“Agent 最近在做什么”。每行包含运行身份（provider/model）、所属案件、当事人、案件状态与轨迹步数。\n\n" +
            "- 只读。`limit` 越界（<1 或 >100）会被 schema 拒绝。\n\n" +
            "状态码：`200` 正常；`422` 查询参数不合法。",
          tags: AGENT_RUN_TAGS,
        },
        response: { 200: t.Array(agentRunSummarySchema), 422: errorSchema },
      },
    )
    .get(
      "/api/audit-cases/:id/trace",
      async ({ params, set }) => {
        const auditCase = await repository.getCase(params.id);
        if (!auditCase) {
          set.status = 404;
          return { error: "Audit case not found" };
        }
        // Every run for the case, newest first — a retried case has more than
        // one, and hiding the earlier attempts would hide what went wrong.
        return repository.getTracesByCase(params.id);
      },
      {
        params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
        detail: {
          summary: "获取审计案件的 Agent 运行轨迹",
          description:
            "按案件返回该案件的**每一次** Agent 运行及其轨迹步骤（最新在前）。重试过的案件会有多次运行，历史运行不会被隐藏。" +
            "轨迹是执行日志而非结论摘要，步骤种类包括 STAGE / TOOL_CALL / TOOL_RESULT / MESSAGE。\n\n" +
            "- 只读。\n\n" +
            "状态码：`200` 正常（案件尚无运行时返回空数组）；`404` 案件不存在；`422` 路径参数不合法。",
          tags: AGENT_RUN_TAGS,
        },
        response: {
          200: t.Array(agentRunTraceSchema),
          404: notFoundSchema,
          422: errorSchema,
        },
      },
    );
}
