import { Elysia } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";

export function statsRoutes({ repository }: { repository: AuditCaseRepository }) {
  return new Elysia()
    // Read-only aggregates for the dashboard. Every figure is derived from
    // stored rows so the cockpit and the queue can never disagree.
    .get("/api/stats/overview", () => repository.getOverview());
}
