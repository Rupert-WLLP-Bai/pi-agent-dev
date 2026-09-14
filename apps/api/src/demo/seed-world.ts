import {
  DEFAULT_FILLER_COUNT,
  DEFAULT_RNG_SEED,
  demoScenarioCases,
  demoScenarios,
  generateFillerCases,
  type ScenarioCase,
} from "@contract-audit/audit/demo-scenarios";
import type { FindingType, RemediationStatus } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import {
  counterpartyCreditCodes,
  counterpartyNames,
  evaluatePartyHistoryRule,
} from "@contract-audit/audit/party-history-rule";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { runSubjectVerification } from "@contract-audit/audit/subject-verification";
import { createFixtureSubjectVerificationPort } from "@contract-audit/audit/subject-verification-fixture";
import type { AuditCaseRepository } from "../db/repositories";
import { demoProposalsFor } from "../demo-agent";

type DemoWorldRepository = Pick<
  AuditCaseRepository,
  | "createPendingCase"
  | "saveSubjectVerifications"
  | "findPriorPartyCases"
  | "savePartyHistory"
  | "getPartyHistory"
  | "appendFindingRevision"
  | "updateCaseStatus"
  | "setCaseAssignment"
  | "appendReviewRevision"
  | "completeCaseIfAllFindingsReviewed"
  | "updateRemediation"
  | "closeRemediation"
  | "deleteDemoSeededCases"
  | "listDemoSeededCases"
  | "contractIdForCase"
>;

export interface SeedDemoWorldInput {
  reset?: boolean;
  fillerCount?: number;
  rngSeed?: number;
}

export interface SeededScenarioView {
  id: string;
  title: string;
  story: string;
  verifies: string;
  featured: boolean;
  cases: Array<{
    caseKey: string;
    caseId: string;
    title: string;
    summary: string;
    status: string;
    stage: string;
  }>;
}

export interface DemoWorldView {
  seededCaseCount: number;
  rngSeed: number | null;
  fillerCount: number;
  scenarios: SeededScenarioView[];
}

export interface SeedDemoWorldResult extends DemoWorldView {
  planted: number;
  removed: number;
}

async function advanceRemediation(
  repository: DemoWorldRepository,
  remediationId: string,
  status: RemediationStatus,
  owner?: string,
  closer?: string,
): Promise<void> {
  if (status === "pending") return;
  if (owner) {
    await repository.updateRemediation(remediationId, { owner });
  }
  if (status === "in_progress" || status === "awaiting_review" || status === "closed") {
    await repository.updateRemediation(remediationId, { status: "in_progress" });
  }
  if (status === "awaiting_review" || status === "closed") {
    await repository.updateRemediation(remediationId, { status: "awaiting_review" });
  }
  if (status === "closed") {
    await repository.closeRemediation(remediationId, closer ?? "李复核");
  }
}

async function plantCase(
  repository: DemoWorldRepository,
  spec: ScenarioCase,
  contractId?: string | null,
): Promise<string> {
  const sourceRecordId = crypto.randomUUID();
  const snapshot = createAuditSnapshot({
    sourceRecordId,
    document: normalizeContractDocument(spec.text),
  });
  const { caseId } = await repository.createPendingCase(
    sourceRecordId,
    snapshot,
    { type: "DEMO", displayName: spec.title },
    {
      createdAt: new Date(spec.createdAt),
      assignee: spec.assignee ?? null,
      contractId: contractId ?? null,
      metadata: {
        demoSeed: true,
        scenarioId: spec.scenarioId,
        caseKey: spec.id,
      },
    },
  );

  const verification = await runSubjectVerification({
    parties: snapshot.parties,
    port: createFixtureSubjectVerificationPort(),
  });
  await repository.saveSubjectVerifications(caseId, verification);

  const creditCodes = counterpartyCreditCodes(snapshot.parties, verification.verifications);
  const prior = await repository.findPriorPartyCases({
    excludeCaseId: caseId,
    createdBefore: new Date(spec.createdAt),
    partyNames: counterpartyNames(snapshot.parties),
    creditCodes,
  });
  const history = evaluatePartyHistoryRule({
    parties: snapshot.parties,
    priorFindings: prior,
  });
  await repository.savePartyHistory(caseId, history);

  const context = {
    ...snapshot,
    evidence: [...snapshot.evidence, ...verification.evidence, ...history.evidence],
    ruleAssessments: [...snapshot.ruleAssessments, verification.ruleAssessment, history.assessment],
  };
  const proposals = demoProposalsFor(context);

  if (proposals.length === 0) {
    await repository.updateCaseStatus(caseId, "COMPLETED", "COMPLETED");
    return caseId;
  }

  const findingIds: Array<{ id: string; findingType: FindingType }> = [];
  for (const proposal of proposals) {
    const id = await repository.appendFindingRevision(caseId, proposal, null);
    findingIds.push({ id, findingType: proposal.findingType });
  }
  await repository.updateCaseStatus(caseId, "AWAITING_REVIEW", "AWAITING_REVIEW");

  if (spec.assignee) {
    await repository.setCaseAssignment(caseId, { assignee: spec.assignee });
  }

  if (spec.reviews === undefined) return caseId;

  const reviewed = new Set<string>();
  for (const review of spec.reviews) {
    const match = findingIds.find(
      (item) => item.findingType === review.findingType && !reviewed.has(item.id),
    );
    if (!match) continue;
    reviewed.add(match.id);
    const { remediationId } = await repository.appendReviewRevision(match.id, {
      decision: review.decision,
      reviewerId: review.reviewerId,
      reviewedAt: spec.createdAt,
      ...(review.reason === undefined ? {} : { reason: review.reason }),
    });
    if (remediationId && spec.remediationStatus) {
      await advanceRemediation(
        repository,
        remediationId,
        spec.remediationStatus,
        spec.remediationOwner,
        spec.remediationCloser,
      );
    }
  }

  for (const item of findingIds) {
    if (reviewed.has(item.id)) continue;
    await repository.appendReviewRevision(item.id, {
      decision: "REJECTED",
      reviewerId: spec.assignee ?? "系统演示",
      reviewedAt: spec.createdAt,
      reason: "演示数据：非本场景关注的发现。",
    });
  }

  await repository.completeCaseIfAllFindingsReviewed(caseId);
  return caseId;
}

export async function seedDemoWorld(
  repository: DemoWorldRepository,
  input: SeedDemoWorldInput = {},
): Promise<SeedDemoWorldResult> {
  const fillerCount = input.fillerCount ?? DEFAULT_FILLER_COUNT;
  const rngSeed = input.rngSeed ?? DEFAULT_RNG_SEED;
  const removed = input.reset === false ? 0 : await repository.deleteDemoSeededCases();
  const specs = [...demoScenarioCases, ...generateFillerCases(rngSeed, fillerCount)].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const lineageContracts = new Map<string, string>();
  for (const spec of specs) {
    const contractId = spec.contractLineage
      ? (lineageContracts.get(spec.contractLineage) ?? null)
      : null;
    const caseId = await plantCase(repository, spec, contractId);
    if (spec.contractLineage && !lineageContracts.has(spec.contractLineage)) {
      const linked = await repository.contractIdForCase(caseId);
      if (linked) lineageContracts.set(spec.contractLineage, linked);
    }
  }
  const view = await readDemoWorld(repository);
  return { ...view, planted: specs.length, removed, rngSeed, fillerCount };
}

export async function readDemoWorld(repository: DemoWorldRepository): Promise<DemoWorldView> {
  const planted = await repository.listDemoSeededCases();
  const byKey = new Map(planted.map((row) => [row.caseKey, row]));
  const caseByKey = new Map(demoScenarioCases.map((item) => [item.id, item]));
  const scenarios: SeededScenarioView[] = demoScenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    story: scenario.story,
    verifies: scenario.verifies,
    featured: scenario.featured === true,
    cases: scenario.caseIds.flatMap((caseKey) => {
      const plantedCase = byKey.get(caseKey);
      const spec = caseByKey.get(caseKey);
      if (!plantedCase || !spec) return [];
      return [
        {
          caseKey,
          caseId: plantedCase.caseId,
          title: spec.title,
          summary: spec.summary,
          status: plantedCase.status,
          stage: plantedCase.stage,
        },
      ];
    }),
  }));
  const filler = planted.filter((row) => row.scenarioId === "filler");
  return {
    seededCaseCount: planted.length,
    rngSeed: planted.length === 0 ? null : DEFAULT_RNG_SEED,
    fillerCount: filler.length,
    scenarios,
  };
}
