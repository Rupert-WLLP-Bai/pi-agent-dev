import { Elysia, t } from "elysia";
import type { AuditCaseRepository, ReviewQueueItem } from "../db/repositories";
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
      { query: queueQuery },
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
        if (auditCase.stage !== "AWAITING_REVIEW") {
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
      { body: assignmentBody },
    );
}
