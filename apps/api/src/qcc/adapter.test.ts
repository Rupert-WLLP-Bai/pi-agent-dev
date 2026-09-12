import { expect, test } from "bun:test";
import { createQccSubjectVerificationPort } from "./adapter";
import type { McpFetch } from "./mcp-client";

/**
 * Recorded provider responses, replayed through the injectable fetch. The
 * shapes are copied from live calls (2026-09): the unique-match query returns
 * `企业信息` as a single OBJECT, the multi-candidate query as an ARRAY — the
 * exact shape mismatch that once broke the adapter live.
 */

const sse = (payload: unknown) =>
  `event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  })}\n\n`;

const UNIQUE_MATCH = {
  匹配结果: "唯一精确匹配",
  检索关键字: "腾讯科技（深圳）有限公司",
  摘要: "已锁定唯一精确主体，可直接调用下游工具。",
  企业信息: {
    企业名称: "腾讯科技（深圳）有限公司",
    统一社会信用代码: "9144030071526726XG",
  },
};

const MULTI_MATCH = {
  匹配结果: "多候选",
  检索关键字: "深圳精工科技有限公司",
  摘要: "命中多个相关主体，无法自动锁定。",
  企业信息: [
    {
      企业名称: "深圳市宝田精工科技有限公司",
      统一社会信用代码: "91440300758618541E",
      状态: "存续",
    },
    { 企业名称: "深圳中科精工科技有限公司", 统一社会信用代码: "91440300MA5ER4GH88", 状态: "存续" },
  ],
};

const NO_MATCH = { 匹配结果: "未匹配", 检索关键字: "不存在公司" };

const RISK_SCAN = {
  企业名称: "腾讯科技（深圳）有限公司",
  摘要: "已全量扫描 35 项风险因子：7 项有记录、28 项无记录。",
  风险因子扫描: [
    { 风险因子: "失信信息", 条目数: 0, 明细工具: "get_dishonest_info" },
    { 风险因子: "被执行人", 条目数: 2, 明细工具: "get_judgment_debtor_info" },
    { 风险因子: "裁判文书", 条目数: 1917, 明细工具: "get_judicial_documents" },
  ],
};

/** Routes requests by tool name so one fake fetch serves the whole flow. */
function fakeFetch(responses: Record<string, () => unknown>): McpFetch {
  return async (_input, init) => {
    const request = JSON.parse(init.body) as { params: { name: string } };
    const respond = responses[request.params.name];
    if (respond === undefined) throw new Error(`unexpected tool: ${request.params.name}`);
    return { ok: true, status: 200, text: async () => sse(respond()) };
  };
}

const CONFIG = {
  companyEndpoint: "https://example.test/company",
  riskEndpoint: "https://example.test/risk",
  token: "test-token",
};

test("resolves a unique match (object-shaped 企业信息) and scans its risks", async () => {
  const port = createQccSubjectVerificationPort({
    ...CONFIG,
    fetchImpl: fakeFetch({
      get_company_by_query: () => UNIQUE_MATCH,
      get_company_risk_scan: () => RISK_SCAN,
    }),
  });

  const outcome = await port.verify("腾讯科技（深圳）有限公司");

  expect(outcome.status).toBe("RESOLVED");
  expect(outcome.matched?.name).toBe("腾讯科技（深圳）有限公司");
  expect(outcome.matched?.unifiedSocialCreditCode).toBe("9144030071526726XG");
  expect(outcome.dimensions).toHaveLength(3);
  // Dimensions are reported verbatim — classification is the subject rule's job.
  expect(outcome.dimensions[1]).toEqual({
    factor: "被执行人",
    count: 2,
    detailTool: "get_judgment_debtor_info",
  });
  expect(outcome.failureReason).toBeNull();
});

test("returns AMBIGUOUS with candidates for a multi-candidate query (array-shaped)", async () => {
  const port = createQccSubjectVerificationPort({
    ...CONFIG,
    fetchImpl: fakeFetch({ get_company_by_query: () => MULTI_MATCH }),
  });

  const outcome = await port.verify("深圳精工科技有限公司");

  expect(outcome.status).toBe("AMBIGUOUS");
  expect(outcome.candidates.map((candidate) => candidate.name)).toEqual([
    "深圳市宝田精工科技有限公司",
    "深圳中科精工科技有限公司",
  ]);
  expect(outcome.dimensions).toEqual([]);
});

test("returns UNRESOLVED when the provider reports no match", async () => {
  const port = createQccSubjectVerificationPort({
    ...CONFIG,
    fetchImpl: fakeFetch({ get_company_by_query: () => NO_MATCH }),
  });

  const outcome = await port.verify("不存在公司");

  expect(outcome.status).toBe("UNRESOLVED");
  expect(outcome.summary).toContain("未发现");
});

test("downgrades a provider failure to UNAVAILABLE with the failure reason", async () => {
  const failing: McpFetch = async () => {
    throw new Error("connection reset");
  };
  const port = createQccSubjectVerificationPort({ ...CONFIG, fetchImpl: failing });

  const outcome = await port.verify("任意公司");

  expect(outcome.status).toBe("UNAVAILABLE");
  expect(outcome.failureReason).toContain("connection reset");
});

test("returns UNRESOLVED when the risk scan misses after a unique query", async () => {
  const port = createQccSubjectVerificationPort({
    ...CONFIG,
    fetchImpl: fakeFetch({
      get_company_by_query: () => UNIQUE_MATCH,
      get_company_risk_scan: () => ({ 无匹配项: "未匹配到搜索关键词" }),
    }),
  });

  const outcome = await port.verify("腾讯科技（深圳）有限公司");

  expect(outcome.status).toBe("UNRESOLVED");
  expect(outcome.summary).toContain("风险扫描未匹配");
});
