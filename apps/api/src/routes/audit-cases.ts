import { findDemoContract } from "@contract-audit/audit/demo-contracts";
import type { AuditSnapshot, RuleCode, SourceProvenance } from "@contract-audit/audit/model";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import { evaluateSubjectRiskRule } from "@contract-audit/audit/subject-rule";
import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import type { RuleRepository } from "../db/rule-repository";
import type { AuditDispatcher } from "../dispatcher";
import { parseContractFile } from "../document";
import { type AuditEventBroker, sseResponse } from "../sse";

export interface AuditRouteDeps {
  repository: AuditCaseRepository;
  dispatcher: AuditDispatcher;
  broker: AuditEventBroker;
  /** Published Rule Versions the snapshot's parameters are read from. */
  rules: RuleRepository;
}

/** The deterministic rules whose parameters shape snapshot assembly. */
const SNAPSHOT_RULE_CODES = [
  "ADVANCE_PAYMENT_LIMIT",
  "PENALTY_RATIO_LIMIT",
  "TERMINATION_CLAUSE_PRESENT",
  "DISPUTE_JURISDICTION",
] as const;

/**
 * Maps the published Rule Versions onto the parameters createAuditSnapshot
 * reads. An operator's explicit per-audit ceiling still wins — it is the same
 * concept stated for one audit — and when neither an override nor a published
 * rule is present the snapshot keeps its built-in default. Every version used
 * is returned too, so the resulting assessments can cite it.
 */
async function buildRuleInputs(rules: RuleRepository, policyLimitRatioOverride?: number) {
  const published = await rules.getPublishedVersions(SNAPSHOT_RULE_CODES);
  const advanceLimit = published.get("ADVANCE_PAYMENT_LIMIT")?.params.limitRatio;
  const penaltyLimit = published.get("PENALTY_RATIO_LIMIT")?.params.limitRatio;
  const jurisdiction = published.get("DISPUTE_JURISDICTION")?.params.preferredJurisdiction;

  const ruleVersions: Partial<Record<RuleCode, number>> = {};
  for (const [code, version] of published) ruleVersions[code as RuleCode] = version.version;

  return {
    policyLimitRatio:
      policyLimitRatioOverride ?? (typeof advanceLimit === "number" ? advanceLimit : undefined),
    policyPenaltyLimit: typeof penaltyLimit === "number" ? penaltyLimit : undefined,
    preferredJurisdiction: typeof jurisdiction === "string" ? jurisdiction : undefined,
    ruleVersions,
  };
}

const createBody = t.Object({
  source: t.Literal("text"),
  contractText: t.String(),
  policyLimitRatio: t.Optional(t.Number()),
  /** Built-in sample the textarea still holds verbatim, when one was loaded. */
  demoId: t.Optional(t.String()),
});

/**
 * Provenance of a pasted submission. The catalog decides what counts as a
 * built-in sample, and the text must still match it: once an operator edits a
 * loaded sample the submission is an ordinary paste again, and recording it as
 * DEMO would be a lie about where the contract came from.
 */
export function resolvePasteProvenance(body: {
  contractText: string;
  demoId?: string;
}): SourceProvenance {
  const demo = body.demoId === undefined ? undefined : findDemoContract(body.demoId);
  if (demo === undefined || demo.text.trim() !== body.contractText.trim()) {
    return { type: "TEXT_PASTE", displayName: null };
  }
  return { type: "DEMO", displayName: demo.title };
}

export function auditCasesRoutes({ repository, dispatcher, broker, rules }: AuditRouteDeps) {
  return (
    new Elysia()
      .post(
        "/api/audit-cases",
        async ({ body, set }) => {
          const sourceRecordId = crypto.randomUUID();
          const snapshot = createAuditSnapshot({
            sourceRecordId,
            document: normalizeContractDocument(body.contractText),
            ...(await buildRuleInputs(rules, body.policyLimitRatio)),
          });
          const { caseId } = await repository.createPendingCase(
            sourceRecordId,
            snapshot,
            resolvePasteProvenance(body),
          );
          await dispatcher.enqueue(caseId);
          set.status = 202;
          return { id: caseId, status: "PENDING" as const };
        },
        { body: createBody },
      )
      // File upload: accepts multipart/form-data with a single contract file
      // (.docx, .pdf, .txt). The file is parsed into the same Contract Document
      // IR the text endpoint produces, so everything downstream — rules, party
      // extraction, the agent — is format-agnostic.
      .post(
        "/api/audit-cases/upload",
        async ({ body, set }) => {
          const sourceRecordId = crypto.randomUUID();
          let snapshot: AuditSnapshot;
          try {
            const parsed = await parseContractFile({
              filename: body.file.name,
              data: new Uint8Array(await body.file.arrayBuffer()),
            });
            // Form fields arrive as strings. The canonical unit is a 0–1 ratio
            // (same as the text endpoint's number field); a value above 1 is
            // treated as a percentage ("30" → 0.3) so both callers work.
            const rawLimit = Number(body.policyLimitRatio);
            const policyLimit =
              body.policyLimitRatio === undefined || Number.isNaN(rawLimit)
                ? undefined
                : rawLimit > 1
                  ? rawLimit / 100
                  : rawLimit;
            snapshot = createAuditSnapshot({
              sourceRecordId,
              document: parsed.document,
              ...(await buildRuleInputs(rules, policyLimit)),
            });
          } catch (error) {
            set.status = 422;
            return {
              error:
                error instanceof Error && error.name === "EmptyContractError"
                  ? "合同文件内容为空，无法发起审计"
                  : "不支持的合同格式（仅支持 .docx、.pdf、.txt）",
            };
          }
          const { caseId } = await repository.createPendingCase(sourceRecordId, snapshot, {
            type: "FILE_UPLOAD",
            displayName: body.file.name,
          });
          await dispatcher.enqueue(caseId);
          set.status = 202;
          return { id: caseId, status: "PENDING" as const };
        },
        {
          body: t.Object({
            file: t.File(),
            policyLimitRatio: t.Optional(t.String()),
          }),
        },
      )
      .get("/api/audit-cases", async () => repository.getCasesWithContractTitle())
      .get("/api/audit-cases/:id", async ({ params, set }) => {
        const auditCase = await repository.getCase(params.id);
        if (!auditCase) {
          set.status = 404;
          return { error: "Audit case not found" };
        }
        const snapshot = await repository.getSnapshotByCase(params.id);
        const findings = await repository.getFindingsByCase(params.id);
        if (!snapshot) {
          set.status = 404;
          return { error: "Audit snapshot not found" };
        }

        const { verifications, evidence: subjectEvidence } = await repository.getSubjectDimension(
          params.id,
        );
        const analyses = [
          ...snapshot.ruleAssessments,
          {
            ...evaluateSubjectRiskRule({ parties: snapshot.parties, verifications }),
            ruleVersion:
              (await rules.getPublishedVersions(["SUBJECT_RED_LINE_RISK"])).get(
                "SUBJECT_RED_LINE_RISK",
              )?.version ?? null,
          },
        ];

        return {
          case: auditCase,
          snapshot: {
            facts: snapshot.facts,
            parties: snapshot.parties,
            document: snapshot.contractDocument,
          },
          evidence: [...snapshot.evidence, ...subjectEvidence],
          ruleAssessments: analyses,
          subjectVerifications: verifications,
          findings,
        };
      })
      .get("/api/audit-cases/:id/events", ({ params, request }) =>
        sseResponse(broker, params.id, () => repository.getCase(params.id), request.signal),
      )
      .post("/api/audit-cases/:id/cancel", async ({ params }) => {
        await dispatcher.cancel(params.id);
        return { id: params.id, status: "CANCELLED" as const };
      })
      .post("/api/audit-cases/:id/retry", async ({ params, set }) => {
        await dispatcher.retry(params.id);
        set.status = 202;
        return { id: params.id, status: "PENDING" as const };
      })
  );
}
