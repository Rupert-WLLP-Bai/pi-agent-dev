import { Elysia, t } from "elysia";
import type { AuditCaseRepository, Remediation } from "../db/repositories";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";
import type { AuditEventBroker } from "../sse";

export interface RemediationsRouteDeps {
  repository: AuditCaseRepository;
  broker: AuditEventBroker;
}

const updateBody = t.Object({
  owner: t.Optional(t.Union([t.String(), t.Null()])),
  dueAt: t.Optional(t.Union([t.String(), t.Null()])),
  progressNote: t.Optional(t.Union([t.String(), t.Null()])),
  // Advance is opt-in and one step only: pending → in_progress → awaiting_review.
  // Every status is accepted here so an illegal target (a skip, or `closed`)
  // gets the state machine's 409 reason instead of a validation 422.
  status: t.Optional(
    t.Union([
      t.Literal("pending"),
      t.Literal("in_progress"),
      t.Literal("awaiting_review"),
      t.Literal("closed"),
    ]),
  ),
});

const closeBody = t.Object({ closedBy: t.String({ minLength: 1 }) });

const REMEDIATION_TAGS = [openapiTags.remediations];

/**
 * One board card. `additionalProperties` stays open, so a response schema
 * never strips or rejects a card the board returns.
 */
const remediationCardSchema = t.Object(
  {
    id: t.String(),
    caseId: t.String(),
    contractTitle: t.String(),
    summary: t.String(),
    severity: t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH")]),
    owner: t.Union([t.String(), t.Null()]),
    dueAt: t.Union([t.String(), t.Null()]),
    overdue: t.Boolean({ description: "读时派生；已关闭的卡片永不逾期" }),
  },
  { additionalProperties: true },
);

const remediationStatusSchema = t.Union([
  t.Literal("pending"),
  t.Literal("in_progress"),
  t.Literal("awaiting_review"),
  t.Literal("closed"),
]);

const remediationColumnSchema = t.Object(
  {
    status: remediationStatusSchema,
    count: t.Number(),
    items: t.Array(remediationCardSchema),
  },
  { additionalProperties: true },
);

/** The 整改跟踪 board: every column in lifecycle order, even when empty. */
const remediationBoardSchema = t.Object(
  {
    columns: t.Array(remediationColumnSchema),
    total: t.Number(),
  },
  { additionalProperties: true },
);

const remediationSchema = t.Object(
  {
    id: t.String(),
    auditCaseId: t.String(),
    findingRevisionId: t.String(),
    summary: t.String(),
    severity: t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH")]),
    owner: t.Union([t.String(), t.Null()]),
    dueAt: t.Union([t.String(), t.Null()]),
    status: remediationStatusSchema,
    progressNote: t.Union([t.String(), t.Null()]),
    closedBy: t.Union([t.String(), t.Null()]),
    closedAt: t.Union([t.String(), t.Null()]),
    closureEvidence: t.Union([t.Array(t.Any()), t.Null()]),
    closureHint: t.Union([
      t.Literal("implemented"),
      t.Literal("open"),
      t.Literal("unknown"),
      t.Null(),
    ]),
    createdAt: t.String(),
    updatedAt: t.String(),
  },
  { additionalProperties: true, description: "一条整改项。" },
);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "");

/**
 * 整改跟踪. The board is a projection with no state of its own; every move an
 * operator makes goes through one of the two write actions here, each of which
 * emits the event that lets a live board follow along.
 */
export function remediationsRoutes({ repository, broker }: RemediationsRouteDeps) {
  return new Elysia()
    .get("/api/remediations", async () => repository.getRemediationBoard(), {
      detail: {
        summary: "获取整改看板",
        description:
          "返回整改跟踪看板：按生命周期顺序排列的四列（pending / in_progress / awaiting_review / closed，空列也会出现）与总条数。" +
          "看板是投影，不持有自己的状态；任何变更都通过下面的两个写接口发生。\n\n" +
          "- 每张卡片带 `overdue`，由读时按截止时间派生；已关闭的卡片永不逾期。\n" +
          "- 只读，可重复调用。",
        tags: REMEDIATION_TAGS,
      },
      response: { 200: remediationBoardSchema },
    })
    .patch(
      "/api/remediations/:id",
      async ({ params, body, set }) => {
        const before = await repository.getRemediation(params.id);
        if (!before) {
          set.status = 404;
          return { error: "整改项不存在" };
        }

        let updated: Remediation;
        try {
          updated = await repository.updateRemediation(params.id, {
            ...(body.owner === undefined ? {} : { owner: body.owner }),
            ...(body.dueAt === undefined ? {} : { dueAt: body.dueAt }),
            ...(body.progressNote === undefined ? {} : { progressNote: body.progressNote }),
            ...(body.status === undefined ? {} : { status: body.status }),
          });
        } catch (error) {
          const message = errorMessage(error);
          if (message.startsWith("REMEDIATION_NOT_FOUND")) {
            set.status = 404;
            return { error: "整改项不存在" };
          }
          if (message.startsWith("REMEDIATION_CLOSED")) {
            set.status = 409;
            return { error: "整改项已关闭，不能修改" };
          }
          if (message.startsWith("REMEDIATION_ILLEGAL_TRANSITION")) {
            set.status = 409;
            return { error: "状态只能按 待整改 → 整改中 → 待复核 顺序推进" };
          }
          throw error;
        }

        if (body.status !== undefined && body.status !== before.status) {
          broker.publish({
            type: "remediation.transitioned",
            auditCaseId: updated.auditCaseId,
            id: updated.id,
            from: before.status,
            to: updated.status,
          });
        }
        return updated;
      },
      {
        params: t.Object({ id: t.String({ description: "整改项 id" }) }),
        body: updateBody,
        detail: {
          summary: "更新整改项",
          description:
            "更新一条整改项的负责人、截止时间、进展说明或状态。状态推进是**单步且显式**的：pending → in_progress → awaiting_review，每次只能前进一格，" +
            "不能跳级，也不能直接置为 closed（必须走关闭接口）。\n\n" +
            "- 已关闭的整改项不可再修改（`409`）。\n" +
            "- 为让非法目标返回状态机语义的 `409` 而非 schema 的 `422`，`status` 接受全部四个取值，由仓库判定合法性。\n" +
            "- 副作用：`status` 实际变化时推送 `remediation.transitioned`（含 from/to）。\n" +
            "- 幂等性：重复提交相同的字段值不产生事件。\n\n" +
            "状态码：`200` 返回更新后的整改项；`404` 整改项不存在；`409` 已关闭或非法状态流转；`422` 请求体/路径参数不合法。",
          tags: REMEDIATION_TAGS,
        },
        response: {
          200: remediationSchema,
          404: notFoundSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    )
    .post(
      "/api/remediations/:id/close",
      async ({ params, body, headers, set }) => {
        let closed: Remediation;
        try {
          const closedBy = operatorFrom(headers) ?? body.closedBy;
          closed = await repository.closeRemediation(params.id, closedBy);
        } catch (error) {
          const message = errorMessage(error);
          if (message.startsWith("REMEDIATION_NOT_FOUND")) {
            set.status = 404;
            return { error: "整改项不存在" };
          }
          if (message.startsWith("REMEDIATION_ALREADY_CLOSED")) {
            set.status = 409;
            return { error: "整改项已关闭" };
          }
          if (message.startsWith("REMEDIATION_NOT_AWAITING_REVIEW")) {
            set.status = 409;
            return { error: "只有待复核的整改项可以关闭" };
          }
          if (message.startsWith("REMEDIATION_SELF_CLOSE")) {
            set.status = 409;
            return { error: "责任人不能自行关闭；请由复核人确认" };
          }
          throw error;
        }

        broker.publish({
          type: "remediation.closed",
          auditCaseId: closed.auditCaseId,
          id: closed.id,
        });
        return closed;
      },
      {
        params: t.Object({ id: t.String({ description: "整改项 id" }) }),
        body: closeBody,
        detail: {
          summary: "关闭整改项",
          description:
            "关闭一条整改项。这是整条链上的最后一步：只有 `awaiting_review` 状态的整改项可以关闭，且**责任人不能自行关闭**——" +
            "必须由另一名复核人确认。\n\n" +
            "- 关闭人取自 `X-Operator` 请求头，缺省回落到请求体的 `closedBy`。\n" +
            "- 副作用：推送 `remediation.closed`。\n" +
            "- 幂等性：**非幂等**，重复关闭返回 `409`。\n\n" +
            "状态码：`200` 返回已关闭的整改项；`404` 不存在；`409` 已关闭、尚未进入待复核，或关闭人即责任人；`422` 请求体/路径参数不合法。",
          tags: REMEDIATION_TAGS,
        },
        response: {
          200: remediationSchema,
          404: notFoundSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    );
}
