import type { AuditSnapshot, FindingProposal, RuleAssessment } from "@contract-audit/audit/model";
import type { AuditAgentPort } from "@contract-audit/audit/ports";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import { FakeAuditAgent, PiAuditAgent } from "@contract-audit/pi-agent";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { loadApiConfig } from "./config";
import { createRepository } from "./db/repositories";
import { AuditDispatcher } from "./dispatcher";
import { createQccSubjectVerificationPort } from "./qcc/adapter";
import { type AuditRouteDeps, auditCasesRoutes } from "./routes/audit-cases";
import { findingsRoutes } from "./routes/findings";
import { statsRoutes } from "./routes/stats";
import { AuditEventBroker } from "./sse";

export type AppDeps = AuditRouteDeps;
export type { AuditOverview, CaseSummary } from "./db/repositories";

/**
 * Deterministic stand-in for the Pi agent used by acceptance runs. It reports
 * exactly one finding, chosen by precedence:
 *
 * 1. any POLICY_CONFLICT across all deterministic rules — settled conflicts
 *    always outrank inconclusive dimensions;
 * 2. any NEEDS_HUMAN_REVIEW from a clause-absence rule (penalty, termination,
 *    dispute) — these signal missing protective clauses;
 * 3. subject red-line inconclusive — entity could not be verified;
 * 4. a low-severity notice when everything is clean.
 *
 * Among POLICY_CONFLICTs, subject red lines rank first (a bad counterparty
 * is the most fundamental risk), then clause conflicts by their rule order.
 */
const CONFLICT_PRIORITY: Array<{
  ruleCode: string;
  findingType: FindingProposal["findingType"];
  severity: FindingProposal["severity"];
  rationale: string;
  remediation: string;
}> = [
  {
    ruleCode: "SUBJECT_RED_LINE_RISK",
    findingType: "SUBJECT_RED_LINE_RISK",
    severity: "HIGH",
    rationale: "",
    remediation: "签约前要求相对方处理失信记录，或增加履约担保、缩短付款周期。",
  },
  {
    ruleCode: "ADVANCE_PAYMENT_LIMIT",
    findingType: "ADVANCE_PAYMENT_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "预付款比例高于制度上限",
    remediation: "调整预付款比例至制度上限以内",
  },
  {
    ruleCode: "PENALTY_RATIO_LIMIT",
    findingType: "PENALTY_RATIO_POLICY_CONFLICT",
    severity: "HIGH",
    rationale: "违约金比例高于制度上限",
    remediation: "调整违约金比例至制度上限以内",
  },
  {
    ruleCode: "DISPUTE_JURISDICTION",
    findingType: "DISPUTE_JURISDICTION_CONFLICT",
    severity: "MEDIUM",
    rationale: "争议管辖地与我方所在地不一致",
    remediation: "协商将争议管辖地修改为我方所在地。",
  },
];

const ABSENCE_FINDINGS: Array<{
  ruleCode: string;
  findingType: FindingProposal["findingType"];
  severity: FindingProposal["severity"];
  remediation: string;
}> = [
  {
    ruleCode: "PENALTY_RATIO_LIMIT",
    findingType: "PENALTY_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充违约责任条款，明确违约金比例。",
  },
  {
    ruleCode: "TERMINATION_CLAUSE_PRESENT",
    findingType: "TERMINATION_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充合同终止/解除条款，明确终止条件和程序。",
  },
  {
    ruleCode: "DISPUTE_JURISDICTION",
    findingType: "DISPUTE_CLAUSE_MISSING",
    severity: "MEDIUM",
    remediation: "补充争议解决条款，明确管辖法院或仲裁机构。",
  },
];

const assessmentBy = (snapshot: AuditSnapshot, ruleCode: string): RuleAssessment | undefined =>
  snapshot.ruleAssessments.find((item) => item.ruleCode === ruleCode);

const demoProposalFor = (snapshot: AuditSnapshot): FindingProposal | null => {
  // 1. POLICY_CONFLICT by priority order
  for (const entry of CONFLICT_PRIORITY) {
    const assessment = assessmentBy(snapshot, entry.ruleCode);
    if (assessment?.disposition === "POLICY_CONFLICT") {
      return {
        findingType: entry.findingType,
        severity: entry.severity,
        rationale: entry.rationale || assessment.basis,
        evidenceIds: assessment.evidenceIds,
        remediation: entry.remediation,
      };
    }
  }

  // 2. Clause-absence findings (NEEDS_HUMAN_REVIEW from missing clauses)
  for (const entry of ABSENCE_FINDINGS) {
    const assessment = assessmentBy(snapshot, entry.ruleCode);
    if (assessment?.disposition === "NEEDS_HUMAN_REVIEW") {
      return {
        findingType: entry.findingType,
        severity: entry.severity,
        rationale: assessment.basis,
        evidenceIds: assessment.evidenceIds,
        remediation: entry.remediation,
      };
    }
  }

  // 3. Subject inconclusive
  const subject = assessmentBy(snapshot, "SUBJECT_RED_LINE_RISK");
  if (subject?.disposition === "NEEDS_HUMAN_REVIEW") {
    return {
      findingType: "NEEDS_HUMAN_REVIEW",
      severity: "MEDIUM",
      rationale: subject.basis,
      evidenceIds: subject.evidenceIds,
      remediation: "确认合同当事人对应的主体后重新发起核验。",
    };
  }

  // 4. All clean — no finding, the case passes without review.
  return null;
};

function agentFactoryFor(mode: "pi" | "fake"): (snapshot: AuditSnapshot) => AuditAgentPort {
  if (mode === "fake") return (snapshot) => new FakeAuditAgent(demoProposalFor(snapshot));
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
