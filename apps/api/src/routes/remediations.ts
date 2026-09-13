import { Elysia, t } from "elysia";
import type { AuditCaseRepository, Remediation } from "../db/repositories";
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

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "");

/**
 * 整改跟踪. The board is a projection with no state of its own; every move an
 * operator makes goes through one of the two write actions here, each of which
 * emits the event that lets a live board follow along.
 */
export function remediationsRoutes({ repository, broker }: RemediationsRouteDeps) {
  return new Elysia()
    .get("/api/remediations", async () => repository.getRemediationBoard())
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
      { body: updateBody },
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
      { body: closeBody },
    );
}
