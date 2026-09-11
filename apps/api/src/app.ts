import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { FakeAuditAgent, PiAuditAgent } from "@contract-audit/pi-agent";
import type { AuditSnapshot, FindingProposal } from "@contract-audit/audit/model";
import type { AuditAgentPort } from "@contract-audit/audit/ports";
import { createRepository } from "./db/repositories";
import { loadApiConfig } from "./config";
import { AuditDispatcher } from "./dispatcher";
import { AuditEventBroker } from "./sse";
import { auditCasesRoutes, type AuditRouteDeps } from "./routes/audit-cases";
import { findingsRoutes } from "./routes/findings";

export type AppDeps = AuditRouteDeps;

const demoProposalFor = (snapshot: AuditSnapshot): FindingProposal =>
  snapshot.ruleAssessment.disposition === "POLICY_CONFLICT"
    ? {
        findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
        severity: "HIGH",
        rationale: "预付款比例高于制度上限",
        evidenceIds: snapshot.evidence.map((locator) => locator.id),
        remediation: "调整预付款比例至制度上限以内",
      }
    : {
        findingType: "NEEDS_HUMAN_REVIEW",
        severity: "LOW",
        rationale: "预付款比例未超过制度上限",
        evidenceIds: snapshot.evidence.map((locator) => locator.id),
        remediation: "无需整改",
      };

function agentFactoryFor(mode: "pi" | "fake"): (snapshot: AuditSnapshot) => AuditAgentPort {
  if (mode === "fake") return (snapshot) => new FakeAuditAgent(demoProposalFor(snapshot));
  return () => new PiAuditAgent();
}

export function createApp(deps: AppDeps) {
  const config = loadApiConfig();
  return new Elysia()
    .use(cors({ origin: config.webOrigin }))
    .use(auditCasesRoutes(deps))
    .use(findingsRoutes({ repository: deps.repository, broker: deps.broker }))
    .get("/api/health", async ({ set }) => {
      const databaseOk = await deps.repository.ping();
      const dispatcherOk = deps.dispatcher.isStarted;
      if (!databaseOk || !dispatcherOk) {
        set.status = 503;
        return { status: "unavailable" as const, database: databaseOk, dispatcher: dispatcherOk };
      }
      return { status: "ok" as const };
    })
    .use(openapi({
      path: "/openapi",
      documentation: {
        info: { title: "Contract Audit API", version: "1.0.0" },
      },
    }));
}

let app: ReturnType<typeof createApp> | undefined;

if (import.meta.main) {
  const config = loadApiConfig();
  const repository = createRepository(config.databaseUrl);
  const broker = new AuditEventBroker();
  const dispatcher = new AuditDispatcher(repository, agentFactoryFor(config.agentMode), broker, config.maxConcurrentAudits);
  app = createApp({ repository, dispatcher, broker });
  await dispatcher.start();
  app.listen(config.apiPort);
}

export default app;
