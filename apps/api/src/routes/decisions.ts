import { randomUUID } from "node:crypto";
import { ENGINE_RULE_CODES, type RuleCode } from "@contract-audit/audit";
import type {
  DecisionAdvice,
  DecisionAdviceList,
  DecisionApiError,
  DecisionDetail,
} from "@contract-audit/audit/decision";
import { Elysia, status as httpStatus, t } from "elysia";
import type { ShadowDecisionRepository } from "../decision/shadow-repository";
import { toDecisionAdvice, toDecisionFeedback } from "../decision/shadow-repository";
import { openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";

/**
 * The narrow persistence surface the decision routes consume: exactly the
 * methods these handlers call, nothing the worker needs. Any store — the SQL
 * repository or an in-memory test double — satisfies it structurally, so a
 * test never casts a stand-in into place.
 */
export interface DecisionsRouteDeps {
  repository: Pick<
    ShadowDecisionRepository,
    | "getJob"
    | "listByCase"
    | "listFeedback"
    | "findFeedback"
    | "appendFeedback"
    | "terminalJobsOlderThan"
    | "deleteTerminalJobs"
  >;
  /**
   * Proves the addressed formal audit case exists. A well-formed UUID for a
   * case the database does not have is an honest 404, not an empty history
   * that would read as "this case ran with shadow mode off".
   */
  caseExists: (auditCaseId: string) => Promise<boolean>;
  /** The mode the deployment runs under; reads stay available when off. */
  mode: "off" | "shadow";
  /** The provider configured for shadow runs; reported so a viewer can label history. */
  provider: "disabled" | "fake" | "laya-cpu";
}

const DECISION_TAGS = [openapiTags.auditCases];

/**
 * The canonical UUID text. A value that cannot match a `uuid` column is
 * answered as 404 before any statement is sent, so a malformed id is an
 * honest "not found" rather than a driver cast error the caller would see as
 * a 500.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Actor attribution: never empty, never longer than the domain allows. */
const MAX_ACTOR_LENGTH = 128;

/**
 * The `Idempotency-Key` a caller may supply: printable ASCII, at most 128
 * characters. A key outside this grammar is rejected with 422 instead of
 * being silently downgraded to "no key", which would turn one intended retry
 * shield into two independent appended events.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7E]{1,128}$/;

const decisionErrorSchema = t.Object(
  {
    schemaVersion: t.Literal(1),
    error: t.String({ description: "稳定错误码" }),
    requestId: t.String({ description: "请求 id，用于关联服务端日志" }),
  },
  { description: "决策接口统一错误体；不含原始异常、提示词或合同片段。" },
);

const evidenceRefSchema = t.Object({
  evidenceId: t.String(),
  sourceRecordId: t.String(),
  blockId: t.Union([t.String(), t.Null()]),
  startOffset: t.Union([t.Number(), t.Null()]),
  endOffset: t.Union([t.Number(), t.Null()]),
});

const ruleConflictSchema = t.Object({
  assessmentId: t.String(),
  // TypeBox needs a tuple for inference; runtime validation uses the full catalogue.
  ruleCode: t.Unsafe<RuleCode>(t.Union(ENGINE_RULE_CODES.map((code) => t.Literal(code)))),
  conflictType: t.Literal("OPPOSED_ASSESSMENT"),
  baselineAnswer: t.Union([
    t.Object({ type: t.Literal("choice"), choice: t.String() }),
    t.Object({ type: t.Literal("score"), score: t.Number() }),
    t.Object({ type: t.Literal("noul"), noul: t.Number() }),
  ]),
  shadowAnswer: t.Union([
    t.Object({ type: t.Literal("choice"), choice: t.String() }),
    t.Object({ type: t.Literal("score"), score: t.Number() }),
    t.Object({ type: t.Literal("noul"), noul: t.Number() }),
  ]),
});

const adviceSchema = t.Object(
  {
    schemaVersion: t.Literal(1),
    decisionId: t.String(),
    auditCaseId: t.String(),
    snapshotId: t.String(),
    agentRunId: t.String(),
    contractDocumentHash: t.String(),
    mode: t.Literal("shadow"),
    status: t.Union([
      t.Literal("PENDING"),
      t.Literal("RUNNING"),
      t.Literal("SUCCEEDED"),
      t.Literal("FAILED"),
      t.Literal("SKIPPED"),
    ]),
    provider: t.Union([t.Literal("disabled"), t.Literal("fake"), t.Literal("laya-cpu")]),
    modelVersion: t.String(),
    taskType: t.Union([
      t.Literal("clause_category"),
      t.Literal("review_routing"),
      t.Literal("clause_score"),
    ]),
    questionKey: t.String(),
    questionVersion: t.String(),
    policyVersion: t.String(),
    redactionVersion: t.String(),
    answer: t.Union([
      t.Object({ type: t.Literal("choice"), choice: t.String() }),
      t.Object({ type: t.Literal("score"), score: t.Number() }),
      t.Object({ type: t.Literal("noul"), noul: t.Number() }),
      t.Null(),
    ]),
    rawProbabilities: t.Union([t.Record(t.String(), t.Number()), t.Null()]),
    rawScore: t.Union([t.Number(), t.Null()]),
    confidence: t.Union([t.Number(), t.Null()]),
    confidenceType: t.Union([
      t.Literal("laya_entropy_concentration"),
      t.Literal("answer_confidence"),
      t.Literal("none"),
    ]),
    calibrated: t.Boolean({ description: "是否经过独立校准；未验证一律 false" }),
    calibrationVersion: t.Union([t.String(), t.Null()]),
    thresholdPolicyVersion: t.Union([t.String(), t.Null()]),
    threshold: t.Union([t.Number(), t.Null()]),
    uncertainty: t.Union([
      t.Literal("unavailable"),
      t.Literal("uncalibrated"),
      t.Literal("calibrated"),
    ]),
    ruleConflicts: t.Array(ruleConflictSchema),
    needsHumanReview: t.Boolean(),
    evidenceRefs: t.Array(evidenceRefSchema),
    latencyMs: t.Union([t.Number(), t.Null()]),
    inputHash: t.String(),
    dataClassification: t.Union([
      t.Literal("SYNTHETIC"),
      t.Literal("MASKED"),
      t.Literal("INTERNAL"),
    ]),
    traceId: t.String(),
    fallbackReason: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    completedAt: t.Union([t.String(), t.Null()]),
  },
  {
    additionalProperties: true,
    description:
      "一条影子建议。它是辅助观察，不是 Finding 状态的真值源；未经校准的分数不得当作正确率。",
  },
);

const feedbackSchema = t.Object({
  schemaVersion: t.Literal(1),
  id: t.String(),
  decisionId: t.String(),
  decision: t.Union([t.Literal("accepted"), t.Literal("rejected"), t.Literal("needs_review")]),
  actor: t.String(),
  reason: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

const adviceListSchema = t.Object({
  schemaVersion: t.Literal(1),
  mode: t.Union([t.Literal("off"), t.Literal("shadow")]),
  provider: t.Union([t.Literal("disabled"), t.Literal("fake"), t.Literal("laya-cpu")]),
  items: t.Array(adviceSchema),
});

const detailSchema = t.Object({
  schemaVersion: t.Literal(1),
  advice: adviceSchema,
  feedback: t.Array(feedbackSchema),
});

const feedbackBody = t.Object({
  schemaVersion: t.Literal(1),
  decision: t.Union([t.Literal("accepted"), t.Literal("rejected"), t.Literal("needs_review")]),
  reason: t.Optional(
    t.String({ maxLength: 2000, description: "可选理由；不得包含凭据或完整合同内容" }),
  ),
});

/**
 * The request id these error bodies carry. Access control stamps
 * `x-request-id` on every request; where it is absent (bare route tests, a
 * request that failed before that hook ran) one is minted and echoed back so
 * a caller can always correlate the body with the server logs.
 */
const requestIdFrom = (set: {
  headers: { get?: (name: string) => string | null } & Record<string, unknown>;
}): string => {
  const stamp = set.headers["x-request-id"];
  const existing =
    typeof stamp === "string" && stamp !== ""
      ? stamp
      : typeof set.headers.get === "function"
        ? set.headers.get("x-request-id")
        : null;
  const requestId = typeof existing === "string" && existing !== "" ? existing : randomUUID();
  set.headers["x-request-id"] = requestId;
  return requestId;
};

/**
 * The feedback routes' read of the acting operator. `X-Operator` is
 * attribution, never authentication: a missing or malformed header leaves the
 * actor as the anonymous default, which is recorded honestly rather than
 * guessed at.
 */
const actorFromHeaders = (headers: Record<string, string | undefined>): string => {
  const raw = operatorFrom(headers);
  if (raw === undefined) return "anonymous";
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_ACTOR_LENGTH) return "anonymous";
  return trimmed;
};

export function decisionsRoutes({ repository, mode, provider, caseExists }: DecisionsRouteDeps) {
  return (
    new Elysia()
      // Every error a decision route can produce carries the canonical
      // `{schemaVersion, error, requestId}` body: the routes' own 404/409
      // responses below, Elysia's validation rejections (which would
      // otherwise echo the raw payload), and anything a handler throws
      // unexpectedly — that last one is sanitized to a bare internal_error so
      // a driver message can never leak into a response.
      .onError(({ code, set }) => {
        const requestId = requestIdFrom(set);
        if (code === "VALIDATION" || code === "PARSE") {
          return httpStatus(422, {
            schemaVersion: 1,
            error: "invalid_request",
            requestId,
          } satisfies DecisionApiError);
        }
        if (code === "NOT_FOUND") {
          return httpStatus(404, {
            schemaVersion: 1,
            error: "not_found",
            requestId,
          } satisfies DecisionApiError);
        }
        return httpStatus(500, {
          schemaVersion: 1,
          error: "internal_error",
          requestId,
        } satisfies DecisionApiError);
      })
      .get(
        "/api/audit-cases/:id/decisions",
        async ({ params, set, status }) => {
          const requestId = requestIdFrom(set);
          if (!UUID_PATTERN.test(params.id)) {
            return status(404, {
              schemaVersion: 1,
              error: "audit_case_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          if (!(await caseExists(params.id))) {
            return status(404, {
              schemaVersion: 1,
              error: "audit_case_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          const rows = await repository.listByCase(params.id);
          const items: DecisionAdvice[] = rows.map(toDecisionAdvice);
          // Reading history stays available when the layer is off: the list
          // reports the mode in force now, and the items are what was recorded
          // before. Switching off never erases what shadow mode observed.
          return status(200, {
            schemaVersion: 1,
            mode,
            provider,
            items,
          } satisfies DecisionAdviceList);
        },
        {
          params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
          detail: {
            summary: "列出案件的影子建议",
            description:
              "返回一个审计案件的影子建议历史， newest first。影子功能关闭时仍可读取已有记录：mode 报告当前开关状态，items 是历史观测，不会因当前无 Provider 被抹去。\n\n" +
              "辅助建议不改变正式审计结论；未经校准的分数只作参考。只读。未知或无效的案件 id 返回 `404 audit_case_not_found`；已存在但没有建议的案件返回空列表。",
            tags: DECISION_TAGS,
          },
          response: {
            200: adviceListSchema,
            404: decisionErrorSchema,
          },
        },
      )
      .get(
        "/api/decisions/:decisionId",
        async ({ params, set, status }) => {
          const requestId = requestIdFrom(set);
          if (!UUID_PATTERN.test(params.decisionId)) {
            return status(404, {
              schemaVersion: 1,
              error: "decision_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          const row = await repository.getJob(params.decisionId);
          if (row === null) {
            return status(404, {
              schemaVersion: 1,
              error: "decision_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          const feedback = await repository.listFeedback(params.decisionId);
          return status(200, {
            schemaVersion: 1,
            advice: toDecisionAdvice(row),
            feedback: feedback.map(toDecisionFeedback),
          } satisfies DecisionDetail);
        },
        {
          params: t.Object({ decisionId: t.String({ description: "影子建议 id" }) }),
          detail: {
            summary: "读取影子建议详情",
            description:
              "返回一条影子建议及其评估反馈。响应不含冻结的最小脱敏输入、完整原始提示词或 Provider 原始响应：状态与 fallbackReason 足以解释失败。只读。",
            tags: DECISION_TAGS,
          },
          response: {
            200: detailSchema,
            404: decisionErrorSchema,
          },
        },
      )
      .post(
        "/api/decisions/:decisionId/feedback",
        async ({ params, body, headers, set, status }) => {
          const requestId = requestIdFrom(set);
          if (!UUID_PATTERN.test(params.decisionId)) {
            return status(404, {
              schemaVersion: 1,
              error: "decision_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          // A key the caller supplied but the grammar rejects is a 422, not a
          // silent downgrade to keyless submission: the caller asked for
          // exactly-once append and gets told instead of double-recorded.
          const rawKey = headers["idempotency-key"];
          const trimmedKey = typeof rawKey === "string" ? rawKey.trim() : "";
          if (trimmedKey !== "" && !IDEMPOTENCY_KEY_PATTERN.test(trimmedKey)) {
            return status(422, {
              schemaVersion: 1,
              error: "invalid_idempotency_key",
              requestId,
            } satisfies DecisionApiError);
          }
          const idempotencyKey = trimmedKey === "" ? null : trimmedKey;
          const job = await repository.getJob(params.decisionId);
          if (job === null) {
            return status(404, {
              schemaVersion: 1,
              error: "decision_not_found",
              requestId,
            } satisfies DecisionApiError);
          }
          const actor = actorFromHeaders(headers as Record<string, string | undefined>);
          // The idempotency key is scoped by (decision, actor): a network retry
          // of the same key returns the stored event instead of appending a
          // second one, which is what makes a double submit harmless.
          const existing = await repository.findFeedback(params.decisionId, actor, idempotencyKey);
          // A different body under a key that already recorded an event is a
          // conflict, not a silent overwrite: the caller is told their retry
          // does not match what was stored.
          if (existing !== null) {
            const sameBody =
              existing.decision === body.decision &&
              (existing.reason ?? null) === (body.reason ?? null);
            if (!sameBody) {
              return status(409, {
                schemaVersion: 1,
                error: "feedback_idempotency_conflict",
                requestId,
              } satisfies DecisionApiError);
            }
            // Same key, same body: the stored event, at the same 201 a first
            // submission got, so a network retry cannot tell itself apart from
            // the original call.
            return status(201, toDecisionFeedback(existing));
          }
          const { event } = await repository.appendFeedback({
            decisionId: params.decisionId,
            decision: body.decision,
            actor,
            reason: body.reason ?? null,
            idempotencyKey,
          });
          return status(201, toDecisionFeedback(event));
        },
        {
          params: t.Object({ decisionId: t.String({ description: "影子建议 id" }) }),
          body: feedbackBody,
          detail: {
            summary: "记录影子建议的评估反馈",
            description:
              "对一条影子建议追加接受/驳回/需复核的评估反馈。反馈是**只追加**的，且独立于 Finding 的人工复核历史：记录反馈不会接受、驳回或修改任何 Finding、规则评估或审计案件状态。\n\n" +
              "- `Idempotency-Key` 按（decision, actor）作用域：同键同体返回已存事件（不追加），同键异体返回 `409`；缺键时每次提交都是独立事件。键必须是可打印 ASCII 且不超过 128 字符，否则 `422 invalid_idempotency_key`。\n" +
              "- `X-Operator` 只是归属标注，不是认证。\n" +
              "- 该入口仅用于评估影子建议，不能借它绕过正式风险确认或人工复核。\n\n" +
              "状态码：`201` 已追加；`404` 建议不存在；`409` 幂等键与已存事件体不一致；`422` 请求体或幂等键不合法。错误体统一为 `{schemaVersion, error, requestId}`。",
            tags: DECISION_TAGS,
          },
          response: {
            201: feedbackSchema,
            404: decisionErrorSchema,
            409: decisionErrorSchema,
            422: decisionErrorSchema,
          },
        },
      )
      // Retention: the operator-facing entry points. Dry run reports exactly
      // what would be removed; apply removes only terminal shadow records and
      // their feedback, and never a formal audit row.
      .post(
        "/api/decisions/retention",
        async ({ body }) => {
          const now = new Date();
          const ids = await repository.terminalJobsOlderThan(body.retentionDays, now);
          if (body.apply !== true) {
            return {
              schemaVersion: 1,
              dryRun: true,
              retentionDays: body.retentionDays,
              candidateCount: ids.length,
              deletedCount: 0,
            };
          }
          const deletedCount = await repository.deleteTerminalJobs(ids);
          return {
            schemaVersion: 1,
            dryRun: false,
            retentionDays: body.retentionDays,
            candidateCount: ids.length,
            deletedCount,
          };
        },
        {
          body: t.Object({
            retentionDays: t.Number({ minimum: 1, maximum: 365 }),
            apply: t.Optional(t.Boolean({ description: "true 才真正删除；缺省只预演" })),
          }),
          detail: {
            summary: "影子记录保留期清理（预演/执行）",
            description:
              "对**终态**影子记录（SUCCEEDED/FAILED/SKIPPED）按保留期清理，反馈随所属记录一并删除。活动租约中的记录不会被清理。\n\n" +
              "正式审计数据（Source Record、快照、Agent 运行、轨迹、Finding、复核、整改）从不在清理范围内。缺省 `apply` 为预演，只返回将删除的数量。",
            tags: DECISION_TAGS,
          },
          response: {
            200: t.Object({
              schemaVersion: t.Literal(1),
              dryRun: t.Boolean(),
              retentionDays: t.Number(),
              candidateCount: t.Number(),
              deletedCount: t.Number(),
            }),
            422: decisionErrorSchema,
          },
        },
      )
  );
}

export { decisionErrorSchema };
