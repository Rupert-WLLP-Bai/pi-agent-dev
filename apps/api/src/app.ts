import type { AuditSnapshot } from "@contract-audit/audit/model";
import type { AuditAgentPort } from "@contract-audit/audit/ports";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { FakeAuditAgent, PiAuditAgent } from "@contract-audit/pi-agent";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { loadApiConfig, maxUploadBytes } from "./config";
import { createDb, createRepository } from "./db/repositories";
import { createRuleRepository } from "./db/rule-repository";
import { seedRules } from "./db/seed-rules";
import { seedValidationCases } from "./db/seed-validation-cases";
import { demoProposalsFor } from "./demo-agent";
import { AuditDispatcher } from "./dispatcher";
import { createQccSubjectVerificationPort } from "./qcc/adapter";
import { agentRunsRoutes } from "./routes/agent-runs";
import { type AuditRouteDeps, auditCasesRoutes } from "./routes/audit-cases";
import { findingsRoutes } from "./routes/findings";
import { remediationsRoutes } from "./routes/remediations";
import { reviewsRoutes } from "./routes/reviews";
import { rulesRoutes } from "./routes/rules";
import { statsRoutes } from "./routes/stats";
import { validationRoutes } from "./routes/validation";
import { verificationsRoutes } from "./routes/verifications";
import { AuditEventBroker } from "./sse";

export type AppDeps = AuditRouteDeps;
export type {
  AgentRunSummary,
  AuditOverview,
  CaseSummary,
  Remediation,
  RemediationBoard,
  RemediationCard,
  RemediationColumn,
  ReviewQueueItem,
  SubjectVerificationListItem,
} from "./db/repositories";
export type {
  AuditActionLog,
  RuleDetail,
  RuleListItem,
  RuleVersionRecord,
  SeedValidationCase,
  ValidationCaseListItem,
  ValidationRunDetail,
  ValidationRunListItem,
  ValidationRunRecord,
} from "./db/rule-repository";
export type { ValidationRunView } from "./routes/validation";
/**
 * The integration-health snapshot `GET /api/health` returns. Credentials are
 * reported as presence only — never as values — so the endpoint is safe to
 * poll from the browser and to log.
 */
export interface ApiHealth {
  status: "ok" | "unavailable";
  database: boolean;
  dispatcher: boolean;
  /** Which agent implementation is wired in; "fake" needs no LLM credentials. */
  agentMode: "pi" | "fake";
  /** Whether the QCC bearer token is present, not the token itself. */
  qccConfigured: boolean;
  /** Whether the real agent's LLM key is present, not the key itself. */
  llmConfigured: boolean;
}

export type {
  ValidationChange,
  ValidationDiffEntry,
  ValidationOutcome,
} from "./validation-diff";

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
    .use(auditCasesRoutes({ ...deps, maxUploadBytes }))
    .use(rulesRoutes({ rules: deps.rules }))
    .use(validationRoutes({ rules: deps.rules }))
    .use(agentRunsRoutes({ repository: deps.repository }))
    .use(findingsRoutes({ repository: deps.repository, broker: deps.broker }))
    .use(remediationsRoutes({ repository: deps.repository, broker: deps.broker }))
    .use(
      reviewsRoutes({
        repository: deps.repository,
        broker: deps.broker,
        slaHours: config.reviewSlaHours,
      }),
    )
    .use(verificationsRoutes({ repository: deps.repository }))
    .use(statsRoutes({ repository: deps.repository }))
    .get("/api/health", async ({ set }): Promise<ApiHealth> => {
      const databaseOk = await deps.repository.ping();
      const dispatcherOk = deps.dispatcher.isStarted;
      if (!databaseOk || !dispatcherOk) {
        set.status = 503;
      }
      // Every field is reported in both states so the integrations page can
      // name the exact failing integration rather than only the aggregate.
      return {
        status: databaseOk && dispatcherOk ? "ok" : "unavailable",
        database: databaseOk,
        dispatcher: dispatcherOk,
        agentMode: config.agentMode,
        qccConfigured: config.qccToken.length > 0,
        llmConfigured: config.llmConfigured,
      };
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

/** The assembled Elysia app, named so consumers share one contract. */
export type AuditApp = ReturnType<typeof createApp>;

let app: AuditApp | undefined;

if (import.meta.main) {
  const config = loadApiConfig();
  const { db } = createDb(config.databaseUrl);
  const repository = createRepository(db);
  const rulesRepository = createRuleRepository(db);
  await seedRules(rulesRepository);
  await seedValidationCases(rulesRepository);
  const broker = new AuditEventBroker();
  const dispatcher = new AuditDispatcher(
    repository,
    agentFactoryFor(config.agentMode),
    broker,
    config.maxConcurrentAudits,
    subjectVerificationPortFor(config),
    config.agentTimeoutMs,
    rulesRepository,
  );
  app = createApp({ repository, dispatcher, broker, rules: rulesRepository });
  await dispatcher.start();
  app.listen(config.apiPort);
}

export default app;
