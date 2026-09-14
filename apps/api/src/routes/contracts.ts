import { Elysia, type Static, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { notFoundSchema, openapiTags } from "../openapi";

export interface ContractsRouteDeps {
  repository: AuditCaseRepository;
}

const CONTRACT_TAGS = [openapiTags.auditCases];

/** A finding severity, restricted to the three grades the engine emits. */
const severitySchema = t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH")]);

/** One accepted chain-head finding on a revision, keyed by Rule Code. */
const findingPinSchema = t.Object({
  ruleCode: t.String(),
  findingType: t.String(),
  severity: severitySchema,
});

const contractSchema = t.Object({
  id: t.String(),
  title: t.String(),
  createdAt: t.String(),
});

const contractRevisionSchema = t.Object({
  id: t.String(),
  contractId: t.String(),
  version: t.Number(),
  sourceRecordId: t.String(),
  label: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

const contractListItemSchema = t.Object({
  id: t.String(),
  title: t.String(),
  createdAt: t.String(),
  revisionCount: t.Number(),
  latestVersion: t.Union([t.Number(), t.Null()]),
});

/** The three buckets a pair of adjacent revisions yields. */
const revisionFindingDiffSchema = t.Object({
  introduced: t.Array(findingPinSchema),
  resolved: t.Array(findingPinSchema),
  persisting: t.Array(findingPinSchema),
});

const contractRevisionViewSchema = t.Object({
  revision: contractRevisionSchema,
  auditCaseId: t.Union([t.String(), t.Null()]),
  // The UI tolerates future status/stage codes, so these stay plain nullable
  // strings rather than a closed union that would reject a newer engine value.
  caseStatus: t.Union([t.String(), t.Null()]),
  caseStage: t.Union([t.String(), t.Null()]),
  findingPins: t.Array(findingPinSchema),
});

const contractDetailSchema = t.Object({
  contract: contractSchema,
  revisions: t.Array(contractRevisionViewSchema),
  diffs: t.Array(
    t.Object({
      fromVersion: t.Number(),
      toVersion: t.Number(),
      diff: revisionFindingDiffSchema,
    }),
  ),
});

/** Wire shape of one contract list row, owned here for the Eden client and the UI. */
export type ContractListItem = Static<typeof contractListItemSchema>;

/** Wire shape of a contract detail payload, owned here for the Eden client and the UI. */
export type ContractDetailView = Static<typeof contractDetailSchema>;

export function contractsRoutes({ repository }: ContractsRouteDeps) {
  return new Elysia()
    .get("/api/contracts", async () => repository.listContracts(), {
      detail: {
        summary: "列出合同",
        description: "返回系统中所有 Contract 及其 revision 数量，供新建审计时关联已有合同。",
        tags: CONTRACT_TAGS,
      },
      response: {
        200: t.Array(contractListItemSchema),
      },
    })
    .get(
      "/api/contracts/:id",
      async ({ params, set }) => {
        const detail = await repository.getContract(params.id);
        if (!detail) {
          set.status = 404;
          return { error: "contract_not_found" };
        }
        return detail;
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          summary: "合同详情",
          description:
            "展示一份 Contract 的全部 Contract Revision、各自审计案件状态，以及相邻版本之间的 finding diff。",
          tags: CONTRACT_TAGS,
        },
        response: { 200: contractDetailSchema, 404: notFoundSchema },
      },
    );
}
