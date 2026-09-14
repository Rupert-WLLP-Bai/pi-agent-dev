import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { openapiTags } from "../openapi";

/** Dashboard aggregates, all computed in SQL over stored rows. */
const auditOverviewSchema = t.Object(
  {
    totalCases: t.Number(),
    awaitingReview: t.Number({ description: "阶段为 AWAITING_REVIEW 的案件数" }),
    reachedReview: t.Number({ description: "到达复核及以后的案件数" }),
    dailyCounts: t.Array(t.Object({ date: t.String(), count: t.Number() }), {
      description: "最近 30 天，由早到晚",
    }),
    findingsByType: t.Array(t.Object({ findingType: t.String(), count: t.Number() }), {
      description: "仅统计链头发现",
    }),
    acceptedFindings: t.Number(),
    rejectedFindings: t.Number(),
    citedFindings: t.Number({ description: "提议引用了至少一条证据的链头发现数" }),
    chainHeadFindings: t.Number(),
    medianAgentDurationMs: t.Union([t.Number(), t.Null()], {
      description: "成功运行的中位耗时；尚无运行时为 null",
    }),
    successfulAgentRuns: t.Number(),
    pendingReview: t.Array(
      t.Object({
        id: t.String(),
        title: t.Union([t.String(), t.Null()]),
        updatedAt: t.String(),
        highestSeverity: t.Union([
          t.Literal("LOW"),
          t.Literal("MEDIUM"),
          t.Literal("HIGH"),
          t.Null(),
        ]),
      }),
      { description: "按更新时间倒序" },
    ),
  },
  { additionalProperties: true, description: "驾驶舱聚合指标。" },
);

export function statsRoutes({ repository }: { repository: AuditCaseRepository }) {
  return (
    new Elysia()
      // Read-only aggregates for the dashboard. Every figure is derived from
      // stored rows so the cockpit and the queue can never disagree.
      .get("/api/stats/overview", () => repository.getOverview(), {
        detail: {
          summary: "获取驾驶舱总览",
          description:
            "返回审计驾驶舱的聚合指标：案件总量、待复核数、到达复核数、最近 30 天的每日创建量、按类型聚合的链头发现、复核结果计数（接受/驳回）、" +
            "证据引用数、成功运行数与中位耗时，以及按更新时间倒序的待复核案件列表。\n\n" +
            "- 所有数字都在 SQL 中对存储行聚合计算，因此驾驶舱与复核队列不会就同一份数据给出不一致的答案。\n" +
            "- 只读，无参数。",
          tags: [openapiTags.stats],
        },
        response: { 200: auditOverviewSchema },
      })
  );
}
