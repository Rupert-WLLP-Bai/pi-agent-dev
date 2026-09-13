import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import type { AuditEventBroker } from "../sse";

interface FindingsRouteDeps {
  repository: AuditCaseRepository;
  broker: AuditEventBroker;
}

const reviewBody = t.Object({
  decision: t.Union([t.Literal("ACCEPTED"), t.Literal("REJECTED")]),
  reason: t.Optional(t.String()),
});

export function findingsRoutes({ repository, broker }: FindingsRouteDeps) {
  return new Elysia().post(
    "/api/findings/:id/reviews",
    async ({ params, body, set }) => {
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
          reviewerId: "anonymous",
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
    { body: reviewBody },
  );
}
