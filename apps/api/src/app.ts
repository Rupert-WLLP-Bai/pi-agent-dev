import type { AuditSnapshot } from "@contract-audit/audit/model";
import type { AuditAgentPort } from "@contract-audit/audit/ports";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { FakeAuditAgent, PiAuditAgent } from "@contract-audit/pi-agent";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { loadApiConfig } from "./config";
import { createRepository } from "./db/repositories";
import { demoProposalsFor } from "./demo-agent";
import { AuditDispatcher } from "./dispatcher";
import { createQccSubjectVerificationPort } from "./qcc/adapter";
import { agentRunsRoutes } from "./routes/agent-runs";
import { type AuditRouteDeps, auditCasesRoutes } from "./routes/audit-cases";
import { findingsRoutes } from "./routes/findings";
import { statsRoutes } from "./routes/stats";
import { AuditEventBroker } from "./sse";

export type AppDeps = AuditRouteDeps;
export type { AgentRunSummary, AuditOverview, CaseSummary } from "./db/repositories";

function agentFactoryFor(mode: "pi" | "fake"): (snapshot: AuditSnapshot) => AuditAgentPort {
  if (mode === "fake") return (snapshot) => new FakeAuditAgent(demoProposalsFor(snapshot));
  return () => new PiAuditAgent();
}

function subjectVerificationPortFor(config: ReturnType<typeof loadApiConfig>) {
  if (config.subjectVerificationMode === "qcc" && config.qccToken) {
    return createQccSubjectVerificationPort({
      companyEndpoint: config.qccCompanyEndpoint,
      riskEndpoint: config.qccRiskEndpoint,
      token: config.qccToken,
    });
  }
  return createFixtureSubjectVerificationPort();
}

export function createApp(deps: AppDeps) {
  const config = loadApiConfig();
  return new Elysia()
    .use(cors({ origin: config.webOrigin }))
    .use(auditCasesRoutes(deps))
    .use(agentRunsRoutes({ repository: deps.repository }))
    .use(findingsRoutes({ repository: deps.repository, broker: deps.broker }))
    .use(statsRoutes({ repository: deps.repository }))
    .get("/api/health", async ({ set }) => {
      const databaseOk = await deps.repository.ping();
      const dispatcherOk = deps.dispatcher.isStarted;
      if (!databaseOk || !dispatcherOk) {
        set.status = 503;
        return { status: "unavailable" as const, database: databaseOk, dispatcher: dispatcherOk };
      }
      return { status: "ok" as const };
    })
    .use(
      openapi({
        path: "/openapi",
        documentation: {
          info: { title: "Contract Audit API", version: "1.0.0" },
        },
      }),
    );
}

let app: ReturnType<typeof createApp> | undefined;

if (import.meta.main) {
  const config = loadApiConfig();
  const repository = createRepository(config.databaseUrl);
  const broker = new AuditEventBroker();
  const dispatcher = new AuditDispatcher(
    repository,
    agentFactoryFor(config.agentMode),
    broker,
    config.maxConcurrentAudits,
    subjectVerificationPortFor(config),
    config.agentTimeoutMs,
  );
  app = createApp({ repository, dispatcher, broker });
  await dispatcher.start();
  app.listen(config.apiPort);
}

export default app;
