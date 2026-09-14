import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { readDemoWorld, seedDemoWorld } from "../demo/seed-world";
import { errorSchema, openapiTags } from "../openapi";

const DEMO_TAGS = [openapiTags.demo];

/** One planted scenario: its story, what it verifies, and the cases it carries. */
const seededScenarioSchema = t.Object(
  {
    id: t.String(),
    title: t.String(),
    story: t.String(),
    verifies: t.String(),
    featured: t.Boolean(),
    cases: t.Array(
      t.Object({
        caseKey: t.String(),
        caseId: t.String(),
        title: t.String(),
        summary: t.String(),
        status: t.String(),
        stage: t.String(),
      }),
      { description: "该场景下的案件摘要（caseKey/caseId/title/status/stage）" },
    ),
  },
  { additionalProperties: true, description: "一个已播种的演示场景。" },
);

/** The demo world as the 演示概览 page reads it. */
const demoWorldSchema = t.Object(
  {
    seededCaseCount: t.Number({ description: "当前演示案件数" }),
    rngSeed: t.Union([t.Number(), t.Null()]),
    fillerCount: t.Number(),
    scenarios: t.Array(seededScenarioSchema),
  },
  { additionalProperties: true, description: "演示世界视图。" },
);

const seedResultSchema = t.Object(
  {
    seededCaseCount: t.Number(),
    rngSeed: t.Union([t.Number(), t.Null()]),
    fillerCount: t.Number(),
    scenarios: t.Array(seededScenarioSchema),
    planted: t.Number({ description: "本次新播种的案件数" }),
    removed: t.Number({ description: "本次移除的旧演示案件数" }),
  },
  { additionalProperties: true, description: "播种结果。" },
);

export function demoWorldRoutes(deps: { repository: AuditCaseRepository }) {
  return new Elysia()
    .get("/api/demo/world", async () => readDemoWorld(deps.repository), {
      detail: {
        summary: "读取演示世界",
        description:
          "返回当前演示世界：已播种的案子数、随机种子、填充案件数，以及每个演示场景的故事与其包含的案件。\n\n" +
          "- 只读，不修改任何数据。演示概览页据此渲染。",
        tags: DEMO_TAGS,
      },
      response: { 200: demoWorldSchema },
    })
    .post(
      "/api/demo/world",
      async ({ body }) =>
        seedDemoWorld(deps.repository, {
          reset: body.reset ?? true,
          ...(body.fillerCount === undefined ? {} : { fillerCount: body.fillerCount }),
          ...(body.rngSeed === undefined ? {} : { rngSeed: body.rngSeed }),
        }),
      {
        body: t.Object({
          reset: t.Optional(
            t.Boolean({
              description: "是否先清除此前播种的演示案件；缺省 true（只清演示数据，不动真实案件）",
            }),
          ),
          fillerCount: t.Optional(
            t.Integer({ minimum: 0, maximum: 80, description: "额外生成的填充案件数" }),
          ),
          rngSeed: t.Optional(t.Integer({ description: "随机种子；相同种子得到相同世界" })),
        }),
        detail: {
          summary: "播种演示世界",
          description:
            "（重新）生成演示数据集：每个场景种下若干案件，可选地生成若干填充案件，并返回播种结果。\n\n" +
            "- `reset` 缺省为 true：先删除**此前播种的演示案件**再重建，不会触碰真实案件。\n" +
            "- `rngSeed` 固定时结果确定可复现。\n" +
            "- 副作用：写入案件、快照、发现与整改项。幂等性：**非幂等**，重复调用会重新播种（结果由种子决定）。\n\n" +
            "状态码：`200` 播种完成；`422` 请求体不合法（如 fillerCount 超出 0–80）。",
          tags: DEMO_TAGS,
        },
        response: { 200: seedResultSchema, 422: errorSchema },
      },
    );
}
