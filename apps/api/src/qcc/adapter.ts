import type { SubjectCandidate } from "@contract-audit/audit/model";
import type {
  SubjectVerificationOutcome,
  SubjectVerificationPort,
} from "@contract-audit/audit/ports";
import { type McpFetch, McpStreamClient } from "./mcp-client";

/**
 * Real Qichacha subject-verification adapter.
 * 1. `get_company_by_query` — resolves the name to one or more candidates.
 * 2. When exactly one candidate matches → `get_company_risk_scan` on the
 *    resolved name, mapping the 35 risk factors to our dimension model.
 * 3. When multiple candidates → AMBIGUOUS (same as the fixture).
 * 4. When zero → UNRESOLVED.
 *
 * The adapter never decides whether a result is a Finding — that is the
 * subject rule's job. It only resolves the entity and reports risk counts.
 */

const CACHE_TTL_DAYS = 7;
interface QccCompanyInfo {
  企业名称: string;
  统一社会信用代码: string;
  成立日期?: string;
  法定代表人名称?: string[];
  状态?: string;
}

interface QccCompanyQueryResponse {
  匹配结果: string;
  企业信息?: QccCompanyInfo | QccCompanyInfo[];
}

interface QccRiskFactor {
  风险因子: string;
  条目数: number;
  明细工具: string;
}

interface QccRiskScanResponse {
  企业名称: string;
  摘要: string;
  风险因子扫描: QccRiskFactor[];
  无匹配项?: string;
}

function cacheExpiry(capturedAt: string): string {
  const date = new Date(capturedAt);
  date.setDate(date.getDate() + CACHE_TTL_DAYS);
  return date.toISOString();
}

function toCandidate(raw: QccCompanyInfo): SubjectCandidate {
  return {
    name: raw.企业名称,
    unifiedSocialCreditCode: raw.统一社会信用代码 || "",
    registrationStatus: raw.状态 ?? "",
  };
}

async function scanRisk(
  client: McpStreamClient,
  matched: SubjectCandidate,
  capturedAt: string,
  signal?: AbortSignal,
): Promise<SubjectVerificationOutcome> {
  let scanResult: QccRiskScanResponse;
  try {
    const result = await client.callTool(
      "get_company_risk_scan",
      { searchKey: matched.name },
      signal,
    );
    scanResult = result.content as QccRiskScanResponse;
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      candidates: [],
      matched,
      dimensions: [],
      summary: "",
      capturedAt,
      expiresAt: null,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }

  if (scanResult.无匹配项) {
    return {
      status: "UNRESOLVED",
      candidates: [],
      matched: null,
      dimensions: [],
      summary: `企查查风险扫描未匹配到「${matched.name}」。`,
      capturedAt,
      expiresAt: cacheExpiry(capturedAt),
      failureReason: null,
    };
  }

  const dimensions = scanResult.风险因子扫描.map((factor) => ({
    factor: factor.风险因子,
    count: factor.条目数,
    detailTool: factor.明细工具,
  }));

  return {
    status: "RESOLVED",
    candidates: [],
    matched: {
      name: scanResult.企业名称 ?? matched.name,
      unifiedSocialCreditCode: matched.unifiedSocialCreditCode,
      registrationStatus: matched.registrationStatus,
    },
    dimensions,
    summary: scanResult.摘要,
    capturedAt,
    expiresAt: cacheExpiry(capturedAt),
    failureReason: null,
  };
}

export interface QccAdapterConfig {
  /** Base URL for the company MCP stream (entity resolution). */
  companyEndpoint: string;
  /** Base URL for the risk MCP stream (risk scan). */
  riskEndpoint: string;
  /** Bearer token for both endpoints. */
  token: string;
  /** Injectable for tests; production leaves it undefined. */
  fetchImpl?: McpFetch;
}

export function createQccSubjectVerificationPort(
  config: QccAdapterConfig,
): SubjectVerificationPort {
  const companyClient = new McpStreamClient(config.companyEndpoint, config.token, config.fetchImpl);
  const riskClient = new McpStreamClient(config.riskEndpoint, config.token, config.fetchImpl);
  return {
    provider: "qcc",
    tool: "get_company_risk_scan",

    async verify(subject: string, signal?: AbortSignal): Promise<SubjectVerificationOutcome> {
      const capturedAt = new Date().toISOString();

      // Step 1: resolve the entity name.
      let queryResult: QccCompanyQueryResponse;
      try {
        const result = await companyClient.callTool(
          "get_company_by_query",
          { searchKey: subject },
          signal,
        );
        queryResult = result.content as QccCompanyQueryResponse;
      } catch (error) {
        return {
          status: "UNAVAILABLE",
          candidates: [],
          matched: null,
          dimensions: [],
          summary: "",
          capturedAt,
          expiresAt: null,
          failureReason: error instanceof Error ? error.message : String(error),
        };
      }

      // No match at all.
      const info = queryResult.企业信息;
      if (queryResult.匹配结果 === "未匹配" || !info) {
        return {
          status: "UNRESOLVED",
          candidates: [],
          matched: null,
          dimensions: [],
          summary: `经企查查全量检索未发现名为「${subject}」的存续主体。`,
          capturedAt,
          expiresAt: cacheExpiry(capturedAt),
          failureReason: null,
        };
      }

      // Unique match: 企业信息 is a single object.
      if (!Array.isArray(info)) {
        const matched = toCandidate(info);
        return await scanRisk(riskClient, matched, capturedAt, signal);
      }

      // Multiple candidates — require human confirmation.
      const candidates = info.map(toCandidate);
      if (queryResult.匹配结果 === "多候选" && candidates.length > 1) {
        return {
          status: "AMBIGUOUS",
          candidates,
          matched: null,
          dimensions: [],
          summary: `企查查检索到 ${candidates.length} 个匹配主体，请确认后二次核验。`,
          capturedAt,
          expiresAt: cacheExpiry(capturedAt),
          failureReason: null,
        };
      }

      // Unique match from array — run the risk scan.
      return scanRisk(riskClient, candidates[0], capturedAt, signal);
    },
  };
}
