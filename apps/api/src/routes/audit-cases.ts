import { Elysia, t } from "elysia";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import type { AuditCase, AuditSnapshot } from "@contract-audit/audit/model";
import type { AuditCaseRepository } from "../db/repositories";
import type { AuditDispatcher } from "../dispatcher";
import { AuditEventBroker, sseResponse } from "../sse";

export interface AuditRouteDeps {
  repository: AuditCaseRepository;
  dispatcher: AuditDispatcher;
  broker: AuditEventBroker;
}

const createBody = t.Object({
  source: t.Literal("text"),
  contractText: t.String(),
  policyLimitRatio: t.Optional(t.Number()),
});

export function auditCasesRoutes({ repository, dispatcher, broker }: AuditRouteDeps) {
  return new Elysia()
    .post("/api/audit-cases", async ({ body, set }) => {
      const sourceRecordId = crypto.randomUUID();
      const snapshot = createAuditSnapshot({
        sourceRecordId,
        contractText: body.contractText,
        policyLimitRatio: body.policyLimitRatio ?? 0.3,
      });
      const { caseId } = await repository.createPendingCase(sourceRecordId, snapshot);
      await dispatcher.enqueue(caseId);
      set.status = 202;
      return { id: caseId, status: "PENDING" as const };
    }, { body: createBody })
    .get("/api/audit-cases", async () => repository.getCases())
    .get("/api/audit-cases/:id", async ({ params, set }) => {
      const auditCase = await repository.getCase(params.id);
      if (!auditCase) {
        set.status = 404;
        return { error: "Audit case not found" };
      }
      const snapshot = await repository.getSnapshotByCase(params.id);
      const findings = await repository.getFindingsByCase(params.id);
      if (!snapshot) {
        set.status = 404;
        return { error: "Audit snapshot not found" };
      }
      return {
        case: auditCase,
        snapshot: { facts: snapshot.facts, evidence: snapshot.evidence, ruleAssessment: snapshot.ruleAssessment },
        findings,
      };
    })
    .get("/api/audit-cases/:id/events", ({ params, request }) =>
      sseResponse(broker, params.id, () => repository.getCase(params.id), request.signal))
    .post("/api/audit-cases/:id/cancel", async ({ params }) => {
      await dispatcher.cancel(params.id);
      return { id: params.id, status: "CANCELLED" as const };
    })
    .post("/api/audit-cases/:id/retry", async ({ params, set }) => {
      await dispatcher.retry(params.id);
      set.status = 202;
      return { id: params.id, status: "PENDING" as const };
    });
}
