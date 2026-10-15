import type { DrizzleDB } from "../db/repositories";
import type { DecisionsRouteDeps } from "../routes/decisions";
import type { DecisionConfig } from "./config";
import { classificationFor, deriveShadowJob } from "./derive";
import { createDecisionProvider } from "./index";
import { ShadowDecisionRepository } from "./shadow-repository";
import { ShadowDecisionWorker } from "./shadow-worker";

/** The composition the API root needs from the decision layer. */
export interface DecisionRuntime {
  /** The repository the decision routes read and write. */
  repository: ShadowDecisionRepository;
  /** Route dependencies: repository plus the mode/provider labels to report. */
  routeDeps: DecisionsRouteDeps;
  /** The dispatcher hook: derive an observation for a proven successful run. */
  derive: (input: {
    auditCaseId: string;
    snapshotId: string;
    agentRunId: string;
    snapshot: import("@contract-audit/audit/model").AuditSnapshot;
    traceId: string;
  }) => Promise<void>;
  /** Starts the independent worker loop; a no-op when the layer is off. */
  start: () => Promise<void>;
  /** Stops the loop and releases this process's leases. */
  stop: () => Promise<void>;
  /** Wakes the worker after a derivation, so a new job is picked up promptly. */
  notify: () => void;
}

/**
 * Builds the shadow decision layer from server configuration.
 *
 * `off` (the default) yields a runtime that derives nothing, starts no loop
 * and answers every route from history. That is deliberate: a deployment that
 * has not opted in must not be able to run inference through a configuration
 * accident, and the switch is checked in the derivation path rather than in
 * the worker.
 */
export const createDecisionRuntime = (input: {
  db: DrizzleDB;
  config: DecisionConfig;
  /** True when the deployment's source is a managed fixture, proven elsewhere. */
  managedFixture?: (auditCaseId: string) => boolean;
  /** True when the caller explicitly marked the submission internal. */
  callerMarkedInternal?: (auditCaseId: string) => boolean;
}): DecisionRuntime => {
  const repository = new ShadowDecisionRepository(input.db);
  const provider = createDecisionProvider(input.config);
  const worker = new ShadowDecisionWorker({
    repository,
    provider,
    owner: `shadow-${crypto.randomUUID()}`,
    concurrency: input.config.decisionConcurrency,
    leaseMs: input.config.decisionLeaseMs,
    pollIntervalMs: input.config.decisionPollIntervalMs,
    maxRetries: input.config.decisionMaxRetries,
  });

  return {
    repository,
    routeDeps: {
      repository,
      mode: input.config.decisionMode,
      provider: input.config.decisionProvider,
    },
    derive: async (derivation) => {
      if (input.config.decisionMode !== "shadow") return;
      await deriveShadowJob({
        config: input.config,
        repository,
        derivation,
        dataClassification: classificationFor({
          managedFixture: input.managedFixture?.(derivation.auditCaseId) ?? false,
          callerMarkedInternal: input.callerMarkedInternal?.(derivation.auditCaseId) ?? false,
        }),
      });
      worker.notify();
    },
    start: async () => {
      if (input.config.decisionMode !== "shadow") return;
      await worker.start();
    },
    stop: async () => {
      await worker.stop();
    },
    notify: () => worker.notify(),
  };
};
