import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";

export interface AgentRunRouteDeps {
  repository: AuditCaseRepository;
}

const DEFAULT_RUN_LIMIT = 25;

/**
 * Agent Run traces.
 *
 * The trace endpoint is case-scoped because a trace only means anything next to
 * the case it audited; the index endpoint answers "what has the agent been
 * doing lately" across every case.
 */
export function agentRunsRoutes({ repository }: AgentRunRouteDeps) {
  return new Elysia()
    .get(
      "/api/agent-runs",
      ({ query }) => repository.getRecentRuns(query.limit ?? DEFAULT_RUN_LIMIT),
      {
        query: t.Object({
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        }),
      },
    )
    .get("/api/audit-cases/:id/trace", async ({ params, set }) => {
      const auditCase = await repository.getCase(params.id);
      if (!auditCase) {
        set.status = 404;
        return { error: "Audit case not found" };
      }
      // Every run for the case, newest first — a retried case has more than
      // one, and hiding the earlier attempts would hide what went wrong.
      return repository.getTracesByCase(params.id);
    });
}
