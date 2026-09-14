import { Elysia, t } from "elysia";
import { probeProvider } from "../llm/provider-client";
import { LlmProviderRepositoryError, type LlmProviderStore } from "../llm/provider-repository";
import { errorSchema, notFoundSchema, openapiTags } from "../openapi";
import { operatorFrom } from "../operator-header";

export interface LlmProvidersRouteDeps {
  providers: LlmProviderStore;
  /**
   * Runs after every successful mutation so the runtime registry re-reads the
   * active row. It receives the acting operator for parity with the other
   * mutation routes; provider rows carry no actor column today, so the hook is
   * where that identity would be recorded.
   */
  onChanged?: (actor: string | undefined) => Promise<void>;
}

const TAG = [openapiTags.llmProviders];

const providerSchema = t.Object({
  id: t.String(),
  name: t.String(),
  endpoint: t.String(),
  model: t.String(),
  maxInput: t.Number(),
  maxOutput: t.Number(),
  enabled: t.Boolean(),
  isActive: t.Boolean(),
  apiKeyConfigured: t.Boolean(),
  apiKeyHint: t.Union([t.String(), t.Null()]),
  lastCheckedAt: t.Union([t.String(), t.Null()]),
  lastCheckOk: t.Union([t.Boolean(), t.Null()]),
  lastCheckError: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const testResultSchema = t.Object({
  ok: t.Boolean(),
  error: t.Union([t.String(), t.Null()]),
  latencyMs: t.Number(),
});
const modelsSchema = t.Object({ models: t.Array(t.String()) });
const idParams = t.Object({ id: t.String() });

const createBody = t.Object({
  name: t.String(),
  endpoint: t.String(),
  model: t.String(),
  apiKey: t.String(),
  maxInput: t.Optional(t.Number()),
  maxOutput: t.Optional(t.Number()),
  enabled: t.Optional(t.Boolean()),
});

const updateBody = t.Object({
  name: t.Optional(t.String()),
  endpoint: t.Optional(t.String()),
  model: t.Optional(t.String()),
  apiKey: t.Optional(t.String()),
  maxInput: t.Optional(t.Number()),
  maxOutput: t.Optional(t.Number()),
  enabled: t.Optional(t.Boolean()),
});

/**
 * CRUD and activation for the OpenAI-compatible providers an audit run can
 * use. Every mutation re-reads the active row through `onChanged`, so the
 * provider a change makes active is the one the next audit run picks up.
 */
export function llmProvidersRoutes({ providers, onChanged }: LlmProvidersRouteDeps) {
  return new Elysia()
    .get("/api/llm-providers", async () => providers.list(), {
      response: { 200: t.Array(providerSchema) },
      detail: {
        summary: "列出模型服务",
        description: "返回全部模型服务；不含任何原始 API Key，仅报告是否已配置与末四位掩码。",
        tags: TAG,
      },
    })
    .post(
      "/api/llm-providers",
      async ({ body, set, headers }) => {
        try {
          const provider = await providers.create(body);
          await onChanged?.(operatorFrom(headers));
          set.status = 201;
          return provider;
        } catch (error) {
          if (error instanceof LlmProviderRepositoryError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        body: createBody,
        response: { 201: providerSchema, 400: errorSchema, 409: errorSchema },
        detail: {
          summary: "新增模型服务",
          description:
            "创建一个 OpenAI 兼容的模型服务。新建行不自动激活——激活由显式的 activate 决定。名称必须唯一。",
          tags: TAG,
        },
      },
    )
    .patch(
      "/api/llm-providers/:id",
      async ({ params, body, set, headers }) => {
        try {
          const provider = await providers.update(params.id, body);
          await onChanged?.(operatorFrom(headers));
          return provider;
        } catch (error) {
          if (error instanceof LlmProviderRepositoryError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        params: idParams,
        body: updateBody,
        response: { 200: providerSchema, 400: errorSchema, 404: notFoundSchema, 409: errorSchema },
        detail: {
          summary: "修改模型服务",
          description:
            "更新一个模型服务。apiKey 省略或为空时保留原密钥；修改后若该行处于激活状态，下一次审计运行即使用新配置。",
          tags: TAG,
        },
      },
    )
    .delete(
      "/api/llm-providers/:id",
      async ({ params, set, headers }) => {
        try {
          await providers.remove(params.id);
          await onChanged?.(operatorFrom(headers));
          set.status = 204;
        } catch (error) {
          if (error instanceof LlmProviderRepositoryError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        params: idParams,
        response: { 204: t.Void(), 404: notFoundSchema },
        detail: {
          summary: "删除模型服务",
          description:
            "删除一个模型服务。若删除的是当前激活行，则按其创建顺序提升最早的启用行接替；无剩余行时回退到 XYG_* 环境变量。",
          tags: TAG,
        },
      },
    )
    .post(
      "/api/llm-providers/:id/activate",
      async ({ params, set, headers }) => {
        try {
          const provider = await providers.activate(params.id);
          await onChanged?.(operatorFrom(headers));
          return provider;
        } catch (error) {
          if (error instanceof LlmProviderRepositoryError) {
            set.status = error.status;
            return { error: error.message };
          }
          throw error;
        }
      },
      {
        params: idParams,
        response: { 200: providerSchema, 404: notFoundSchema },
        detail: {
          summary: "激活模型服务",
          description:
            "将某行设为当前激活模型服务（同时清除其它行的激活状态）；下一次审计运行即使用该配置。",
          tags: TAG,
        },
      },
    )
    .post(
      "/api/llm-providers/:id/test",
      async ({ params, set }) => {
        const credentials = await providers.credentialsFor(params.id);
        if (!credentials) {
          set.status = 404;
          return { error: "模型服务不存在" };
        }
        const probe = await probeProvider(credentials.endpoint, credentials.apiKey);
        await providers.recordCheck(params.id, probe.ok, probe.error);
        return { ok: probe.ok, error: probe.error, latencyMs: probe.latencyMs };
      },
      {
        params: idParams,
        response: { 200: testResultSchema, 404: notFoundSchema },
        detail: {
          summary: "测试模型服务连通性",
          description:
            "使用已保存的密钥请求 {endpoint}/models（10 秒超时），并记录最近一次检查结果。上游失败返回 ok:false 而非 5xx。",
          tags: TAG,
        },
      },
    )
    .get(
      "/api/llm-providers/:id/models",
      async ({ params, set }) => {
        const credentials = await providers.credentialsFor(params.id);
        if (!credentials) {
          set.status = 404;
          return { error: "模型服务不存在" };
        }
        const probe = await probeProvider(credentials.endpoint, credentials.apiKey);
        return { models: probe.ok ? probe.models : [] };
      },
      {
        params: idParams,
        response: { 200: modelsSchema, 404: notFoundSchema },
        detail: {
          summary: "获取模型列表",
          description:
            "使用已保存的密钥请求 {endpoint}/models 并返回模型 id 列表。上游失败时返回空列表，绝不抛出 5xx。",
          tags: TAG,
        },
      },
    );
}
