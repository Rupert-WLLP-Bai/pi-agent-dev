import { Elysia, t } from "elysia";
import type { AuditCaseRepository, ReviewQueueItem } from "../db/repositories";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import type { AuditEventBroker } from "../sse";

export interface ReviewsRouteDeps {
  repository: AuditCaseRepository;
  broker: AuditEventBroker;
  /** Hours from case creation until a review item is overdue. */
  slaHours: number;
}

const assignmentBody = t.Object({
  assignee: t.Optional(t.Union([t.String(), t.Null()])),
  priority: t.Optional(t.Union([t.Literal("high"), t.Literal("normal"), t.Literal("low")])),
});

const queueQuery = t.Object({
  /** Operator name; keeps only items assigned to them. */
  mine: t.Optional(t.String()),
  /** "true" keeps only items past their SLA deadline. */
  overdue: t.Optional(t.String()),
  /** "true" keeps only evidence conflicts. */
  evidence: t.Optional(t.String()),
  /** "true" keeps only items that carry an assignee. */
  assigned: t.Optional(t.String()),
  search: t.Optional(t.String()),
});

/** The filter flags are opt-in, so any value other than "true"/"1" is off. */
const isTrue = (value: string | undefined): boolean => value === "true" || value === "1";

const REVIEW_TAGS = [openapiTags.reviews];

/** One queue row: a chain-head finding plus the SLA clock the operator works against. */
const reviewQueueItemSchema = t.Object(
  {
    caseId: t.String(),
    contractTitle: t.String({ description: "合同显示名；首块不是标题时为「未命名合同」" }),
    findingId: t.String(),
    findingType: t.String(),
    title: t.String({ description: "发现类型的中文标题" }),
    severity: t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH"), t.Null()]),
    evidenceConflict: t.Boolean({ description: "是否需要人工介入而非已定结论" }),
    assignee: t.Union([t.String(), t.Null()]),
    priority: t.Union([t.Literal("high"), t.Literal("normal"), t.Literal("low"), t.Null()], {
      description: "high / normal / low",
    }),
    dueAt: t.String(),
    remainingMs: t.Number({
      description: "距 SLA 截止的毫秒数，读时派生，负数表示已逾期",
    }),
    updatedAt: t.String(),
  },
  { additionalProperties: true, description: "复核队列的一行。" },
);

const assignmentSchema = t.Object(
  {
    id: t.String({ description: "审计案件 id" }),
    assignee: t.Union([t.String(), t.Null()]),
    priority: t.Union([t.Literal("high"), t.Literal("normal"), t.Literal("low"), t.Null()], {
      description: "high / normal / low",
    }),
  },
  { additionalProperties: true, description: "案件的当前分配。" },
);

function matchesQueueFilters(
  item: ReviewQueueItem,
  query: {
    mine?: string;
    overdue?: string;
    evidence?: string;
    assigned?: string;
    search?: string;
  },
): boolean {
  if (query.mine !== undefined && item.assignee !== query.mine) return false;
  if (isTrue(query.overdue) && item.remainingMs >= 0) return false;
  if (isTrue(query.evidence) && !item.evidenceConflict) return false;
  if (isTrue(query.assigned) && item.assignee === null) return false;
  const search = query.search?.trim().toLocaleLowerCase();
  if (search) {
    const haystack =
      `${item.contractTitle} ${item.title} ${item.findingType} ${item.caseId}`.toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

export function reviewsRoutes({ repository, broker, slaHours }: ReviewsRouteDeps) {
  return new Elysia()
    .get(
      "/api/reviews/queue",
      async ({ query }) => {
        const items = await repository.getReviewQueue({ slaHours });
        return items.filter((item) => matchesQueueFilters(item, query));
      },
      {
        query: queueQuery,
        detail: {
          summary: "获取待复核队列",
          description:
            "返回待复核队列：每个等待复核的案件的链头发现，连同严重度、SLA 剩余时间与分配信息。\n\n" +
            "过滤参数都是可选的、按需开启；除 `mine` 与 `search` 外，只有 `true`（或 `1`）才真正生效：\n" +
            "- `mine`：只保留分配给该操作人的条目；\n" +
            "- `overdue`：只保留已超过 SLA 截止的条目；\n" +
            "- `evidence`：只保留存在证据冲突的条目；\n" +
            "- `assigned`：只保留已有分配人的条目；\n" +
            "- `search`：对合同标题、发现标题、发现类型与案件 id 做不区分大小写的子串匹配。\n\n" +
            "排序：证据冲突优先，其次严重度从高到低，再其次截止时间由早到晚。只读。",
          tags: REVIEW_TAGS,
        },
        response: { 200: t.Array(reviewQueueItemSchema), 422: errorSchema },
      },
    )
    .post(
      "/api/audit-cases/:id/assignment",
      async ({ params, body, set }) => {
        const auditCase = await repository.getCase(params.id);
        if (!auditCase) {
          set.status = 404;
          return { error: "Audit case not found" };
        }
        // Assignment is a review-queue action. A case that is not awaiting
        // review has no queue item to transfer, so the request is a conflict.
        if (auditCase.status !== "AWAITING_REVIEW" && auditCase.stage !== "AWAITING_REVIEW") {
          set.status = 409;
          return { error: "Audit case is not awaiting review" };
        }

        const assignment = await repository.setCaseAssignment(params.id, {
          ...(body.assignee === undefined ? {} : { assignee: body.assignee }),
          ...(body.priority === undefined ? {} : { priority: body.priority }),
        });
        broker.publish({
          type: "review.assigned",
          auditCaseId: params.id,
          assignee: assignment.assignee,
          priority: assignment.priority,
        });
        return { id: params.id, ...assignment };
      },
      {
        params: t.Object({ id: t.String({ description: "审计案件 id" }) }),
        body: assignmentBody,
        detail: {
          summary: "分配复核任务",
          description:
            "设置一个案件的复核人（assignee）与优先级（priority）。分配是**复核队列**的动作。\n\n" +
            "- 前置条件：案件必须处于 AWAITING_REVIEW；其它阶段没有队列条目可转移，返回 `409`。\n" +
            "- `assignee` / `priority` 均可显式传 `null` 以清除该字段。\n" +
            "- 副作用：推送 `review.assigned`。\n" +
            "- 幂等性：**幂等**——重复提交相同的分配不改变结果，但每次调用仍会推送一次事件。\n\n" +
            "状态码：`200` 返回当前分配；`404` 案件不存在；`409` 案件不在待复核阶段；`422` 请求体/路径参数不合法。",
          tags: REVIEW_TAGS,
        },
        response: {
          200: assignmentSchema,
          404: notFoundSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    );
}
