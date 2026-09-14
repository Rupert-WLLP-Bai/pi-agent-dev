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
import { loadObjectStoreConfig } from "./document/original-store";
import { type ApiHealth, buildHealthSnapshot } from "./health";
import { LlmProviderRegistry } from "./llm/provider-registry";
import {
  createLlmProviderRepository,
  createMemoryLlmProviderStore,
  type LlmProviderStore,
} from "./llm/provider-repository";
import { reencryptPlainLlmProviderKeys } from "./llm/reencrypt-provider-keys";
import { seedProviderFromEnv } from "./llm/seed-from-env";
import { apiHealthSchema, openapiOptions, openapiTags } from "./openapi";
import { createQccSubjectVerificationPort } from "./qcc/adapter";
import {
  connectRedis,
  createCachedSubjectVerificationPort,
  type VerificationCache,
} from "./qcc/cache";
import { agentRunsRoutes } from "./routes/agent-runs";
import { type AuditRouteDeps, auditCasesRoutes } from "./routes/audit-cases";
import { contractsRoutes } from "./routes/contracts";
import { demoWorldRoutes } from "./routes/demo-world";
import { findingsRoutes } from "./routes/findings";
import { llmProvidersRoutes } from "./routes/llm-providers";
import { remediationsRoutes } from "./routes/remediations";
import { reviewsRoutes } from "./routes/reviews";
import { rulesRoutes } from "./routes/rules";
import { statsRoutes } from "./routes/stats";
import { validationRoutes } from "./routes/validation";
import { verificationsRoutes } from "./routes/verifications";
import { AuditEventBroker } from "./sse";

export type AppDeps = AuditRouteDeps & {
  /** Model-service persistence; absent falls back to the in-memory store (tests). */
  llmProviders?: LlmProviderStore;
  /** The runtime registry shared by the agent factory and the health snapshot. */
  registry?: LlmProviderRegistry;
  /** The connected Redis cache the health probe pings; null when Redis is off. */
  redisCache?: VerificationCache | null;
};
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
export type { DemoWorldView, SeedDemoWorldResult, SeededScenarioView } from "./demo/seed-world";
export type { OriginalStorage } from "./document/original-store";
export type { ApiHealth } from "./health";
export type { ValidationRunView } from "./routes/validation";
export type {
  ValidationChange,
  ValidationDiffEntry,
  ValidationOutcome,
} from "./validation-diff";

function agentFactoryFor(
  mode: "pi" | "fake",
  registry: LlmProviderRegistry,
): (snapshot: AuditSnapshot) => AuditAgentPort {
  if (mode === "fake") return (snapshot) => new FakeAuditAgent(demoProposalsFor(snapshot));
  // The dispatcher calls this once per run and reads `agent.identity`, so the
  // registry lookup must stay synchronous — `current()` is a cache read.
  return () => new PiAuditAgent(registry.current());
}

function subjectVerificationPortFor(
  config: ReturnType<typeof loadApiConfig>,
  cache: Awaited<ReturnType<typeof connectRedis>>,
) {
  if (config.subjectVerificationMode === "qcc" && config.qccToken) {
    return createCachedSubjectVerificationPort(
      createQccSubjectVerificationPort({
        companyEndpoint: config.qccCompanyEndpoint,
        riskEndpoint: config.qccRiskEndpoint,
        token: config.qccToken,
      }),
      cache,
    );
  }
  return createFixtureSubjectVerificationPort();
}

export function createApp(deps: AppDeps) {
  const config = loadApiConfig();
  const providers = deps.llmProviders ?? createMemoryLlmProviderStore();
  const registry = deps.registry ?? new LlmProviderRegistry(providers);
  return new Elysia()
    .onRequest(({ request, set }) => {
      const incoming = request.headers.get("x-request-id")?.trim();
      const requestId = incoming && incoming.length > 0 ? incoming : crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
    })
    .onError(({ set }) => {
      if (set.status === 200 || set.status === undefined) set.status = 500;
      const requestId = set.headers["x-request-id"] ?? crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
      return { error: "internal_error", requestId };
    })
    .use(cors({ origin: config.webOrigin }))
    .use(auditCasesRoutes({ ...deps, maxUploadBytes }))
    .use(contractsRoutes({ repository: deps.repository }))
    .use(demoWorldRoutes({ repository: deps.repository }))
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
    .use(
      llmProvidersRoutes({
        providers,
        // Every mutation re-reads the active row so the next audit run picks up
        // the change without a restart.
        onChanged: () => registry.refresh(),
      }),
    )
    .get(
      "/api/health",
      async ({ set }): Promise<ApiHealth> => {
        const databaseOk = await deps.repository.ping();
        const dispatcherOk = deps.dispatcher.isStarted;
        // Only the database and the dispatcher are fatal; a degraded cache or
        // object store still answers 200 with its connection flagged.
        if (!databaseOk || !dispatcherOk) {
          set.status = 503;
        }
        return buildHealthSnapshot({
          config,
          databaseOk,
          dispatcherOk,
          redis: { url: process.env.REDIS_URL, client: deps.redisCache ?? null },
          objectStore: loadObjectStoreConfig(),
          agent: { mode: config.agentMode, ...registry.describe() },
          qcc: {
            companyEndpoint: config.qccCompanyEndpoint,
            riskEndpoint: config.qccRiskEndpoint,
            tokenConfigured: config.qccToken.length > 0,
          },
        });
      },
      {
        response: { 200: apiHealthSchema, 503: apiHealthSchema },
        detail: {
          summary: "集成健康检查",
          description:
            "返回数据库、调度器、Redis、对象存储、模型服务与企查查的连通性。仅数据库或调度器失败时返回 503；凭据只报存在性，从不返回值。",
          tags: [openapiTags.system],
        },
      },
    )
    .use(openapi({ ...openapiOptions }));
}

/** The assembled Elysia app, named so consumers share one contract. */
export type AuditApp = ReturnType<typeof createApp>;

let app: AuditApp | undefined;

if (import.meta.main) {
  const config = loadApiConfig();
  const { db } = createDb(config.databaseUrl);
  const repository = createRepository(db);
  const rulesRepository = createRuleRepository(db);
  const providerRepository = createLlmProviderRepository(db);
  await reencryptPlainLlmProviderKeys(db);
  // Import the environment configuration as the first provider so the console
  // shows the model service that audits are actually using.
  await seedProviderFromEnv(providerRepository);
  // Read the active provider before the dispatcher starts, so the first audit
  // run already uses the operator's choice when one is configured.
  const providerRegistry = new LlmProviderRegistry(providerRepository);
  await providerRegistry.refresh();
  await seedRules(rulesRepository);
  await seedValidationCases(rulesRepository);
  const redisCache = await connectRedis(process.env.REDIS_URL);
  const broker = new AuditEventBroker();
  const dispatcher = new AuditDispatcher(
    repository,
    agentFactoryFor(config.agentMode, providerRegistry),
    broker,
    config.maxConcurrentAudits,
    subjectVerificationPortFor(config, redisCache),
    config.agentTimeoutMs,
    rulesRepository,
  );
  app = createApp({
    repository,
    dispatcher,
    broker,
    rules: rulesRepository,
    llmProviders: providerRepository,
    registry: providerRegistry,
    redisCache,
  });
  await dispatcher.start();
  app.listen(config.apiPort);
}

export default app;
