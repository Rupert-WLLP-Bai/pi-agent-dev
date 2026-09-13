import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";

export interface VerificationsRouteDeps {
  repository: AuditCaseRepository;
}

const DEFAULT_LIMIT = 50;
/** One page cannot drain the whole append-only table. */
const MAX_LIMIT = 200;

/**
 * The external-verification timeline. Read-only: verification rows are
 * append-only, and the limit is clamped so a caller asking for a huge page
 * still gets a bounded one.
 */
export function verificationsRoutes({ repository }: VerificationsRouteDeps) {
  return new Elysia().get(
    "/api/verifications",
    async ({ query }) => {
      const requested = Number(query.limit ?? DEFAULT_LIMIT);
      const limit =
        Number.isFinite(requested) && requested > 0
          ? Math.min(Math.floor(requested), MAX_LIMIT)
          : DEFAULT_LIMIT;
      return { verifications: await repository.listSubjectVerifications(limit) };
    },
    { query: t.Object({ limit: t.Optional(t.String()) }) },
  );
}
