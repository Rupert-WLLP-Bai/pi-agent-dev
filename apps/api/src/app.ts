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
import { createDecisionRuntime } from "./decision/runtime";
import { InMemoryShadowDecisionRepository } from "./decision/testing/in-memory-shadow-repository";
import { demoProposalsFor } from "./demo-agent";
import { AuditDispatcher } from "./dispatcher";
import { createLiveOcrPort, loadOcrConfig, type OcrPort } from "./document/ocr";
import {
  createMemoryOcrSettingsStore,
  createOcrSettingsRepository,
  type OcrSettingsStore,
} from "./document/ocr/ocr-settings-repository";
import { loadObjectStoreConfig } from "./document/original-store";
import { type ApiHealth, buildHealthSnapshot } from "./health";
import { assertAuditDataDestination } from "./llm/audit-data-policy";
import { LlmProviderRegistry } from "./llm/provider-registry";
import {
  createLlmProviderRepository,
  createMemoryLlmProviderStore,
  type LlmProviderStore,
} from "./llm/provider-repository";
import { reencryptPlainApiKeys } from "./llm/reencrypt-plain-keys";
import { seedProviderFromEnv } from "./llm/seed-from-env";
import { apiHealthSchema, openapiOptions, openapiTags } from "./openapi";
import { createQccSubjectVerificationPort } from "./qcc/adapter";
import {
  connectRedis,
  createCachedSubjectVerificationPort,
  type VerificationCache,
} from "./qcc/cache";
import { createRequestContext, type RequestContextOptions } from "./request-context";
import { agentRunsRoutes } from "./routes/agent-runs";
import { type AuditRouteDeps, auditCasesRoutes } from "./routes/audit-cases";
import { contractsRoutes } from "./routes/contracts";
import { type DecisionsRouteDeps, decisionsRoutes } from "./routes/decisions";
import { demoWorldRoutes } from "./routes/demo-world";
import { dossiersRoutes } from "./routes/dossiers";
import { findingsRoutes } from "./routes/findings";
import { llmProvidersRoutes } from "./routes/llm-providers";
import { ocrSettingsRoutes } from "./routes/ocr-settings";
import { remediationsRoutes } from "./routes/remediations";
import { reviewsRoutes } from "./routes/reviews";
import { rulesRoutes } from "./routes/rules";
import { statsRoutes } from "./routes/stats";
import { validationRoutes } from "./routes/validation";
import { verificationsRoutes } from "./routes/verifications";
import { AuditEventBroker } from "./sse";

export type AppDeps = AuditRouteDeps & {
  /** Request correlation, write-origin policy and sanitized access observations. */
  requestContext?: RequestContextOptions;
  /** Independent shadow history; an in-memory store is used by isolated app tests. */
  decisions?: Omit<DecisionsRouteDeps, "caseExists">;
  /** Model-service persistence; absent falls back to the in-memory store (tests). */
  llmProviders?: LlmProviderStore;
  /** The runtime registry shared by the agent factory and the health snapshot. */
  registry?: LlmProviderRegistry;
  /** The connected Redis cache the health probe pings; null when Redis is off. */
  redisCache?: VerificationCache | null;
  /** The scanned-document recognizer; absent reads the wiring from the environment. */
  ocr?: OcrPort;
  /** Persisted OCR configuration; absent falls back to the in-memory store (tests). */
  ocrSettings?: OcrSettingsStore;
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
export type { ContractDetailView, ContractListItem } from "./routes/contracts";
export type { DossierAmountChain } from "./routes/dossiers";
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
  return () => {
    const configured = registry.current();
    const agent = new PiAuditAgent(configured);
    const endpoint = configured?.endpoint ?? process.env.XYG_ENDPOINT ?? "";
    return {
      identity: agent.identity,
      async run(snapshot, signal, trace) {
        assertAuditDataDestination(snapshot, endpoint);
        return agent.run(snapshot, signal, trace);
      },
    };
  };
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
  // Persisted OCR configuration. Absent (tests) falls back to the in-memory
  // store, so the settings routes behave identically without a database.
  const ocrSettings = deps.ocrSettings ?? createMemoryOcrSettingsStore();
  const decisions = deps.decisions ?? {
    repository: new InMemoryShadowDecisionRepository(),
    mode: "off" as const,
    provider: "disabled" as const,
  };
  // The recognizer the whole app shares: the health route probes it and every
  // parse reaches through it. It is a *live* port — it resolves its
  // configuration per operation, so a settings save changes what the next PDF
  // is read under without rebuilding this one or restarting the process. With
  // no stored row it resolves to the `OCR_*` environment configuration, which
  // is the existing behaviour kept intact as the bootstrap.
  const ocrPort: OcrPort =
    deps.ocr ??
    createLiveOcrPort(async () => {
      const stored = await ocrSettings.rawConfig();
      return stored ?? loadOcrConfig();
    });
  return new Elysia()
    .onError(({ code, set }) => {
      const requestId = set.headers["x-request-id"] ?? crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
      // A route that failed may already have declared its own status; that
      // judgement outranks this fallback. Elysia's own classifications arrive
      // with the status left at 200, so they must be mapped here: an unmatched
      // path or an unsupported method is NOT_FOUND, and reporting it as 500
      // tells the caller their mistake was a server fault. Only an
      // unclassified error — or one whose handler promised 5xx — is ours.
      if (set.status === undefined || set.status === 200) {
        set.status =
          code === "NOT_FOUND" ? 404 : code === "VALIDATION" ? 422 : code === "PARSE" ? 400 : 500;
      }
      const status = typeof set.status === "number" ? set.status : 500;
      if (status >= 500) return { error: "internal_error", requestId };
      return { error: String(code).toLowerCase(), requestId };
    })
    .use(createRequestContext({ ...deps.requestContext, webOrigin: config.webOrigin }))
    .use(cors({ origin: config.webOrigin }))
    .use(auditCasesRoutes({ ...deps, maxUploadBytes }))
    .use(contractsRoutes({ repository: deps.repository }))
    .use(dossiersRoutes({ maxUploadBytes, ocr: ocrPort }))
    .use(demoWorldRoutes({ repository: deps.repository }))
    .use(rulesRoutes({ rules: deps.rules }))
    .use(validationRoutes({ rules: deps.rules }))
    .use(agentRunsRoutes({ repository: deps.repository }))
    .use(
      decisionsRoutes({
        ...decisions,
        caseExists: async (id) => (await deps.repository.getCase(id)) !== null,
      }),
    )
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
    .use(
      ocrSettingsRoutes({
        settings: ocrSettings,
        // A save changes what the live recognizer resolves next; the port
        // itself is not rebuilt, so nothing in flight is disturbed.
        onChanged: async () => {},
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
          ocr: ocrPort,
        });
      },
      {
        response: { 200: apiHealthSchema, 503: apiHealthSchema },
        detail: {
          summary: "集成健康检查",
          description:
            "返回数据库、调度器、Redis、对象存储、模型服务、企查查与 OCR 识别的连通性。仅数据库或调度器失败时返回 503；凭据只报存在性，从不返回值。",
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
  if (process.env.APP_ENV === "demo" || process.env.APP_ENV === "production") {
    const encryptionSecret = process.env.LLM_KEY_ENCRYPTION_SECRET?.trim();
    if (!encryptionSecret || encryptionSecret.length < 32) {
      throw new Error("LLM_KEY_ENCRYPTION_SECRET_REQUIRED_MINIMUM_32_CHARACTERS");
    }
  }
  const { db } = createDb(config.databaseUrl);
  const repository = createRepository(db);
  const rulesRepository = createRuleRepository(db);
  const providerRepository = createLlmProviderRepository(db);
  await reencryptPlainApiKeys(db);
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
  // Persisted OCR configuration: the single row an operator saves from the
  // settings page. Absent (no migration applied yet) the recognizer falls back
  // to the `OCR_*` environment variables, which is the existing behaviour.
  const ocrSettingsRepository = createOcrSettingsRepository(db);
  // Live for the process's lifetime: it re-resolves its configuration on every
  // operation, so a settings save lands on the next parse — and the next audit
  // run — without a restart.
  const ocrPort = createLiveOcrPort(async () => {
    const stored = await ocrSettingsRepository.rawConfig();
    return stored ?? loadOcrConfig();
  });
  const decision = createDecisionRuntime({
    db,
    config: config.decision,
    caseExists: async (id) => (await repository.getCase(id)) !== null,
  });
  const dispatcher = new AuditDispatcher(
    repository,
    agentFactoryFor(config.agentMode, providerRegistry),
    broker,
    config.maxConcurrentAudits,
    subjectVerificationPortFor(config, redisCache),
    config.agentTimeoutMs,
    rulesRepository,
    ocrPort,
    decision.derive,
  );
  app = createApp({
    repository,
    dispatcher,
    broker,
    rules: rulesRepository,
    llmProviders: providerRepository,
    registry: providerRegistry,
    redisCache,
    ocrSettings: ocrSettingsRepository,
    ocr: ocrPort,
    decisions: decision.routeDeps,
  });
  await dispatcher.start();
  await decision.start();
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => {
      console.error("API_SHUTDOWN_TIMEOUT");
      process.exit(1);
    }, 5_000);
    deadline.unref();
    try {
      await app?.stop(true);
      await decision.stop();
      // Termination closes DB/cache sockets; startup recovers interrupted runs.
      process.exit(0);
    } catch {
      console.error("API_SHUTDOWN_FAILED");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  app.listen(config.apiPort);
}

export default app;
