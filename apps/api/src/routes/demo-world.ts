import { Elysia, t } from "elysia";
import type { AuditCaseRepository } from "../db/repositories";
import { runDemoWorldOperation } from "../demo/demo-world-operation";
import { DemoResetRefusedError, plantDemoCases, readDemoWorld } from "../demo/seed-world";
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

const resetResultSchema = t.Object(
  {
    removed: t.Number({ description: "本次移除的演示案件数" }),
  },
  { additionalProperties: true, description: "重置结果。" },
);

/** A refused destructive action: stable code plus the reason, never a trace. */
const refusalSchema = t.Object(
  {
    error: t.String({ description: "拒绝原因编码，如 demo_reset_refused" }),
    code: t.String({ description: "具体拒绝码，如 app_env_not_demo / demo_run_active" }),
    reason: t.String({ description: "中文拒绝原因，可直接展示" }),
  },
  { additionalProperties: true, description: "受环境保护的破坏性操作被拒绝。" },
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
      async ({ body, set }) => {
        // Every destructive request goes through one atomic operation: the
        // environment guard, the database identity and registration, the
        // active-run refusal, the advisory lock, the delete and the seed all
        // live in the repository's single transaction. `reset: false` is the
        // only additive path, and it plants on top of whatever is there.
        try {
          if (body.reset === false) {
            return await plantDemoCases(deps.repository, {
              ...(body.fillerCount === undefined ? {} : { fillerCount: body.fillerCount }),
              ...(body.rngSeed === undefined ? {} : { rngSeed: body.rngSeed }),
            });
          }
          const result = await runDemoWorldOperation(deps.repository, {
            appEnv: process.env.APP_ENV,
            confirmation: process.env.DEMO_RESET_CONFIRMATION,
            environmentId: process.env.DEMO_ENVIRONMENT_ID,
            databaseName: process.env.DEMO_DATABASE_NAME,
            databaseUrl: process.env.DATABASE_URL,
            seed: {
              ...(body.fillerCount === undefined ? {} : { fillerCount: body.fillerCount }),
              ...(body.rngSeed === undefined ? {} : { rngSeed: body.rngSeed }),
            },
          });
          if (!result.outcome.ok) {
            set.status = 409;
            return {
              error: "demo_reset_refused",
              code: result.outcome.code,
              reason: result.outcome.reason,
            };
          }
          if (result.view === null) {
            set.status = 409;
            return {
              error: "demo_reset_refused",
              code: "seed_not_performed",
              reason: "重置完成但未播种：POST 需要 seed 参数或 reset:false。",
            };
          }
          return { ...result.view, planted: result.planted, removed: result.outcome.removed };
        } catch (error) {
          if (error instanceof DemoResetRefusedError) {
            set.status = 409;
            return { error: "demo_reset_refused", code: error.code, reason: error.reason };
          }
          throw error;
        }
      },
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
    )
    .delete(
      "/api/demo/world",
      async ({ set }) => {
        // The same atomic operation the CLI runs, reset-only: the advisory
        // lock, identity, registration and active-run checks all happen in the
        // one transaction that deletes. A refusal returns 409 with a code and
        // reason, so the caller can tell an unconfigured deployment from a
        // genuinely busy one.
        const result = await runDemoWorldOperation(deps.repository, {
          appEnv: process.env.APP_ENV,
          confirmation: process.env.DEMO_RESET_CONFIRMATION,
          environmentId: process.env.DEMO_ENVIRONMENT_ID,
          databaseName: process.env.DEMO_DATABASE_NAME,
          databaseUrl: process.env.DATABASE_URL,
        });
        if (!result.outcome.ok) {
          set.status = 409;
          return {
            error: "demo_reset_refused",
            code: result.outcome.code,
            reason: result.outcome.reason,
          };
        }
        return { removed: result.outcome.removed };
      },
      {
        detail: {
          summary: "重置演示世界",
          description:
            "删除**此前播种的演示案件**及其关系链（快照、发现、复核、整改、影子记录），保留非演示案件、配置、规则与迁移记录。\n\n" +
            "- 环境保护：`APP_ENV` 必须为 demo/test；必须显式确认目标数据库名；连接库必须与登记一致。\n" +
            "- 有演示案件仍在排队或运行时拒绝（`demo_run_active`）。\n" +
            "- 删除在单事务内持互斥锁执行；不触碰对象存储中的非演示原件。\n\n" +
            "状态码：`200` 已重置；`409` 环境/确认/身份/活动运行检查未通过。",
          tags: DEMO_TAGS,
        },
        response: { 200: resetResultSchema, 409: refusalSchema },
      },
    );
}
