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

      try {
        await repository.appendReviewRevision(params.id, {
          decision: body.decision,
          reason: body.reason,
          reviewerId: "anonymous",
          reviewedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("FINDING_ALREADY_REVIEWED")) {
          set.status = 409;
          return { error: "Finding already reviewed" };
        }
        throw error;
      }

      await repository.updateCaseStatus(finding.auditCaseId, "COMPLETED", "COMPLETED");
      broker.publish({ type: "audit.completed", auditCaseId: finding.auditCaseId });
      return { id: params.id, reviewed: true as const };
    },
    { body: reviewBody },
  );
}
