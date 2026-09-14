import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";
import type { AuditEventBroker } from "../sse";

interface FindingsRouteDeps {
  repository: AuditCaseRepository;
  broker: AuditEventBroker;
}

const reviewBody = t.Object({
  decision: t.Union([t.Literal("ACCEPTED"), t.Literal("REJECTED")], {
    description: "ACCEPTED 会打开一条整改项；REJECTED 只落定复核",
  }),
  reason: t.Optional(t.String({ description: "复核理由，记入该修订的人工复核" })),
});

export function findingsRoutes({ repository, broker }: FindingsRouteDeps) {
  return new Elysia().post(
    "/api/findings/:id/reviews",
    async ({ params, body, set, headers }) => {
      const finding = await repository.getFinding(params.id);
      if (!finding) {
        set.status = 404;
        return { error: "Finding not found" };
      }

      let remediationId: string | null = null;
      try {
        const review = await repository.appendReviewRevision(params.id, {
          decision: body.decision,
          reason: body.reason,
          reviewerId: operatorFrom(headers) ?? "anonymous",
          reviewedAt: new Date().toISOString(),
        });
        remediationId = review.remediationId;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("FINDING_ALREADY_REVIEWED")) {
          set.status = 409;
          return { error: "Finding already reviewed" };
        }
        throw error;
      }

      if (remediationId !== null) {
        broker.publish({
          type: "remediation.created",
          auditCaseId: finding.auditCaseId,
          id: remediationId,
        });
      }

      // Each finding is reviewed on its own. The case only closes once every
      // chain-head finding carries a Human Review, so a multi-finding case
      // stays AWAITING_REVIEW until the last one is decided. `completed` is
      // true on exactly the review that performs the transition.
      const completed = await repository.completeCaseIfAllFindingsReviewed(finding.auditCaseId);
      if (completed) {
        broker.publish({ type: "audit.completed", auditCaseId: finding.auditCaseId });
      }
      return { id: params.id, reviewed: true as const };
    },
    {
      params: t.Object({ id: t.String({ description: "发现（Finding Revision）id" }) }),
      body: reviewBody,
      detail: {
        summary: "人工复核一条发现",
        description:
          "对一条链头发现记录人工复核决策。复核是**只追加**的：每次决策生成一个新的 Finding Revision，旧版本不被改写，历史始终可读。\n\n" +
          "- 前置条件：该发现必须尚未复核，否则返回 `409`（一条发现只复核一次）。\n" +
          "- ACCEPTED 会打开一条整改项并推送 `remediation.created`；REJECTED 只落定复核。\n" +
          "- 案件只有在**全部**链头发现都完成复核后才闭合（AWAITING_REVIEW → COMPLETED）；" +
          "执行这一转换的那次复核会额外推送 `audit.completed`。\n" +
          "- 操作人取自 `X-Operator` 请求头（百分号编码），缺省记为 `anonymous`。\n\n" +
          "状态码：`200` 已记录（`{ id, reviewed: true }`）；`404` 发现不存在；`409` 该发现已复核；`422` 请求体或路径参数不合法。",
        tags: [openapiTags.reviews],
      },
      response: {
        200: t.Object(
          {
            id: t.String(),
            reviewed: t.Boolean({ description: "恒为 true" }),
          },
          { additionalProperties: true },
        ),
        404: notFoundSchema,
        409: errorSchema,
        422: errorSchema,
      },
    },
  );
}
