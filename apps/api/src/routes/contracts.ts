import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { notFoundSchema, openapiTags } from "../openapi";

export interface ContractsRouteDeps {
  repository: AuditCaseRepository;
}

const CONTRACT_TAGS = [openapiTags.auditCases];

export function contractsRoutes({ repository }: ContractsRouteDeps) {
  return new Elysia()
    .get("/api/contracts", async () => repository.listContracts(), {
      detail: {
        summary: "列出合同",
        description: "返回系统中所有 Contract 及其 revision 数量，供新建审计时关联已有合同。",
        tags: CONTRACT_TAGS,
      },
      response: {
        200: t.Array(
          t.Object({
            id: t.String(),
            title: t.String(),
            createdAt: t.String(),
            revisionCount: t.Number(),
            latestVersion: t.Union([t.Number(), t.Null()]),
          }),
        ),
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
        response: { 200: t.Any(), 404: notFoundSchema },
      },
    );
}
