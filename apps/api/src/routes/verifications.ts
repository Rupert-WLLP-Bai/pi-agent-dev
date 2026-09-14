import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { openapiTags } from "../openapi";

export interface VerificationsRouteDeps {
  repository: AuditCaseRepository;
}

const DEFAULT_LIMIT = 50;
/** One page cannot drain the whole append-only table. */
const MAX_LIMIT = 200;

/** One row of the append-only external-verification timeline. */
const verificationItemSchema = t.Object(
  {
    id: t.String(),
    auditCaseId: t.String(),
    contractTitle: t.Union([t.String(), t.Null()]),
    partyId: t.String(),
    subjectName: t.String({
      description: "主体落定时的匹配法定名，否则为被查询的名称；不会为空",
    }),
    status: t.Union([
      t.Literal("RESOLVED"),
      t.Literal("AMBIGUOUS"),
      t.Literal("UNRESOLVED"),
      t.Literal("UNAVAILABLE"),
    ]),
    provider: t.Union([t.String(), t.Null()]),
    capturedAt: t.String(),
    expiresAt: t.Union([t.String(), t.Null()]),
  },
  { additionalProperties: true, description: "一条主体核验记录。" },
);

/**
 * The external-verification timeline. Read-only: verification rows are
 * append-only, and the limit is clamped so a caller asking for a huge page
 * still gets a bounded one.
 */
export function verificationsRoutes({ repository }: VerificationsRouteDeps) {
  return new Elysia().get(
    "/api/verifications",
    async ({ query }) => {
      const requested = Number(query.limit ?? DEFAULT_LIMIT);
      const limit =
        Number.isFinite(requested) && requested > 0
          ? Math.min(Math.floor(requested), MAX_LIMIT)
          : DEFAULT_LIMIT;
      return { verifications: await repository.listSubjectVerifications(limit) };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String({ description: "返回条数上限；缺省 50，硬上限 200" })),
      }),
      detail: {
        summary: "列出主体核验时间线",
        description:
          "返回外部核验（主体核验）的时间线，最新在前。每行是一条**只追加**的服务商回答：它把某个合同当事人解析成或无法解析成一家主体，" +
          "并带上状态、服务商与有效期。重复核验会追加新行，而不是覆盖旧行，因此复核人始终能看到当初决策依据的那次回答。\n\n" +
          "- `limit` 缺省为 50；非正数或非数字回落到默认值，超过 200 一律截断为 200，保证单页有界。\n" +
          "- 只读，无副作用。",
        tags: [openapiTags.verifications],
      },
      response: {
        200: t.Object(
          { verifications: t.Array(verificationItemSchema) },
          { additionalProperties: true, description: "主体核验时间线。" },
        ),
      },
    },
  );
}
