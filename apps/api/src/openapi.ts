import type { ElysiaOpenAPIConfig } from "@elysiajs/openapi";
import { t } from "elysia";

/**
 * The reference page's single source of truth.
 *
 * `openapiTags` holds the tag names as constants so a route never repeats a
 * Chinese string literal, and `openapiDocumentation` describes the document as
 * a whole. `openapiOptions` is spread straight into the plugin:
 *
 * ```ts
 * app.use(openapi({ ...openapiOptions }))
 * ```
 *
 * The Scalar provider that ships with `@elysiajs/openapi` is used, and the
 * spec is embedded into the page — so the reference is one self-contained HTML
 * response, not a second round trip for the JSON.
 */

/**
 * One tag per feature area, in the product's own vocabulary. The order here is
 * the order the reference's sidebar shows them in.
 */
export const openapiTags = {
  /** 审计案件：创建、查看、取消、重试、重评估。 */
  auditCases: "审计案件",
  /** 复核中心：待复核队列与人工复核决策。 */
  reviews: "复核中心",
  /** 整改跟踪：整改项看板与状态流转。 */
  remediations: "整改跟踪",
  /** 规则治理：规则、版本、发布、启停与验证门禁。 */
  rules: "规则治理",
  /** 案例验证：金标准案例与验证运行。 */
  validation: "案例验证",
  /** 外部核验：主体核验时间线。 */
  verifications: "外部核验",
  /** 运行轨迹：Agent 运行记录与逐步轨迹。 */
  agentRuns: "运行轨迹",
  /** 统计：驾驶舱聚合指标。 */
  stats: "统计",
  /** 演示数据：演示世界的读取与播种。 */
  demo: "演示数据",
  /** 模型服务：LLM 提供商配置。 */
  llmProviders: "模型服务",
  /** 系统：健康检查等运行时端点。 */
  system: "系统",
} as const;

export type OpenapiTag = (typeof openapiTags)[keyof typeof openapiTags];

const DOMAIN_DESCRIPTION = [
  "合同智能审计智能体的 HTTP 接口。所有接口以 `/api` 为前缀，除健康检查外都返回 JSON。",
  "",
  "**审计案件（Audit Case）** 是一次审计的主体。提交合同文本或上传合同文件（.docx/.pdf/.txt）都会创建一个案件：产生一份不可变的 **Source Record**（原件来源），" +
    "并以当时的已发布 **规则版本** 组装一份 **Audit Snapshot（审计快照）**，随后入队等待 Agent 运行。案件沿着 PENDING → RUNNING → AWAITING_REVIEW → COMPLETED 推进；" +
    "失败或中断的案件可以重试或重评估，但正在运行或已完成的案件不能重评估。",
  "",
  "**发现（Finding）** 是 Agent 基于规则评估提出的问题。任何一条发现都必须经过**人工复核**才能落定：复核决策是**只追加**的，每次决策都会生成一个新的 Finding Revision，" +
    "旧版本不会被改写，因此一段历史始终可读。只有案件的全部链头发现都完成复核，案件才会闭合。",
  "",
  "**规则评估是确定性的**：规则参数来自已发布的规则版本，Agent 只能依据评估结果提出发现，**不能推翻规则结论**。规则版本一旦发布即不可变；" +
    "参数修改走新草稿，草稿通过金标准案例验证后才能发布。",
  "",
  "**证据锚定在不可变的 Source Record 上**：每条证据都指向合同文档中的具体片段或外部记录定位符。重复上传同一合同只会追加新的 Source Record，不会覆盖既有证据。",
  "",
  "**写操作需要操作人**：所有会记录操作人的变更接口都接受 `X-Operator` 请求头（百分号编码的 UTF-8 名字，浏览器无法直接发送非 ASCII 名字）；" +
    "缺省时回落到请求体中的操作人字段或系统默认值。",
].join("\n");

export const openapiDocumentation = {
  info: {
    title: "合同智能审计智能体 API",
    version: "1.0.0",
    description: DOMAIN_DESCRIPTION,
  },
  servers: [
    { url: "http://localhost:3000", description: "本地开发（API 直连）" },
    { url: "http://localhost:8080/api", description: "演示环境（Nginx 反代，/api 前缀）" },
  ],
  tags: [
    { name: openapiTags.auditCases, description: "创建、查询、取消、重试与重评估审计案件。" },
    { name: openapiTags.reviews, description: "待复核队列、复核决策与分配。" },
    { name: openapiTags.remediations, description: "整改项看板、状态流转与关闭。" },
    { name: openapiTags.rules, description: "规则目录、版本、验证门禁、发布与启停。" },
    { name: openapiTags.validation, description: "金标准案例目录与验证运行记录。" },
    { name: openapiTags.verifications, description: "主体核验（外部核验）的只追加时间线。" },
    { name: openapiTags.agentRuns, description: "Agent 运行索引与单案件逐步轨迹。" },
    { name: openapiTags.stats, description: "驾驶舱聚合指标。" },
    { name: openapiTags.demo, description: "演示世界的读取与播种。" },
    { name: openapiTags.llmProviders, description: "大模型服务商配置与连通性测试。" },
    { name: openapiTags.system, description: "运行时健康检查。" },
  ],
} satisfies ElysiaOpenAPIConfig["documentation"];

/**
 * The standard error body. `error` is a stable machine code or a Chinese
 * message; branch on the status code, never parse this string.
 */
export const errorSchema = t.Object(
  { error: t.String({ description: "错误码或中文说明" }) },
  { description: "统一错误体。按 HTTP 状态码分支，不要解析 `error` 文本。" },
);

/** A resource that was addressed by id and does not exist (or has no such file). */
export const notFoundSchema = t.Object(
  { error: t.String({ description: "资源不存在的原因" }) },
  { description: "资源不存在：调用方应停止重试，并检查传入的 id。" },
);

/** One integration's health line: what was probed, and whether it answered. */
export const healthConnectionSchema = t.Object(
  {
    ok: t.Boolean({ description: "该集成是否健康" }),
    target: t.String({ description: "被探测目标（凭据已剥离），可安全渲染与记录" }),
    detail: t.Union([t.String(), t.Null()], { description: "失败说明；健康时为 null" }),
  },
  { additionalProperties: true },
);

/**
 * `GET /api/health`'s payload. Mirrors the `ApiHealth` interface in `./health`;
 * `status` is fatal-only — it is `unavailable` only when the database or the
 * dispatcher is down, while Redis and object storage degrade without changing
 * it.
 */
export const apiHealthSchema = t.Object(
  {
    status: t.Union([t.Literal("ok"), t.Literal("unavailable")]),
    database: t.Boolean(),
    dispatcher: t.Boolean(),
    agentMode: t.Union([t.Literal("pi"), t.Literal("fake")]),
    qccConfigured: t.Boolean(),
    llmConfigured: t.Boolean(),
    connections: t.Object(
      {
        database: healthConnectionSchema,
        redis: healthConnectionSchema,
        objectStore: healthConnectionSchema,
        llm: healthConnectionSchema,
        qcc: healthConnectionSchema,
        dispatcher: healthConnectionSchema,
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

/**
 * Ready-to-spread plugin options. `exclude` keeps the reference's own HTML and
 * JSON endpoints out of the document even if their `hide` detail changes; the
 * routes themselves already carry `hide: true`.
 *
 * Mounted under the `/api` prefix on purpose. The workbench reaches the API
 * through a proxy that forwards only `/api/*` — Vite in development, nginx in
 * the demo stack — so a reference served at `/openapi` would render when hit
 * directly on :3000 and 404 from the product link beside it. One path that
 * works from every entry point beats two that disagree.
 */
export const openapiOptions = {
  path: "/api/openapi",
  specPath: "/api/openapi/json",
  provider: "scalar",
  embedSpec: true,
  documentation: openapiDocumentation,
  exclude: { paths: ["/api/openapi", "/api/openapi/json"] },
} satisfies ElysiaOpenAPIConfig<true, "/api/openapi">;
