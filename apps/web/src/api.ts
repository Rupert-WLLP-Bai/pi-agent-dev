import type { AgentRunSummary, AuditOverview, CaseSummary, createApp } from "@contract-audit/api";
import type { AgentRunTrace } from "@contract-audit/audit/model";
import { treaty } from "@elysiajs/eden";

// Same-origin by default so the Vite dev proxy (and a single-origin deployment)
// carry /api requests. An empty string is NOT a valid Eden base — it resolves
// requests against an invalid URL and every call fails. Set VITE_API_URL only
// when the API lives on a different origin.
const API_BASE_URL = import.meta.env.VITE_API_URL ?? window.location.origin;

// Eden Treaty client typed directly from the Elysia app (architecture
// constraint: monorepo front/back type derivation through Eden Treaty).
const api = treaty<ReturnType<typeof createApp>>(API_BASE_URL);

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface CreateAuditCaseInput {
  contractText: string;
  policyLimitRatio: number;
  /**
   * Built-in sample the textarea still holds verbatim. The API resolves it
   * against its own catalog and records DEMO provenance; an edited sample is
   * recorded as a plain paste.
   */
  demoId?: string;
}

export async function createAuditCase({
  contractText,
  policyLimitRatio,
  demoId,
}: CreateAuditCaseInput) {
  const { data, error } = await api.api["audit-cases"].post({
    source: "text",
    contractText,
    policyLimitRatio,
    ...(demoId === undefined ? {} : { demoId }),
  });
  if (error) throw new ApiRequestError("创建审计失败", error.status);
  return data;
}

export interface UploadContractFileInput {
  file: File;
  /** 0–1 ratio; the endpoint also tolerates a percentage above 1. */
  policyLimitRatio: number;
}

/**
 * Uploads a contract file (.docx/.pdf/.txt). Uses raw fetch rather than Eden
 * Treaty because Treaty's multipart typing adds no value for a single File,
 * while FormData keeps the browser's native file streaming.
 */
export async function createAuditCaseFromFile({ file, policyLimitRatio }: UploadContractFileInput) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("policyLimitRatio", String(policyLimitRatio));

  const response = await fetch(`${API_BASE_URL}/api/audit-cases/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiRequestError(body?.error ?? "上传合同失败", response.status);
  }
  return (await response.json()) as { id: string; status: string };
}

export async function getAuditCases(): Promise<CaseSummary[]> {
  const { data, error } = await api.api["audit-cases"].get();
  if (error) throw new ApiRequestError("加载审计列表失败", Number(error.status));
  return data;
}

/**
 * Every Agent Run for a case, newest first, each with its trace steps. A
 * retried case has more than one run; the caller picks which to show.
 */
export async function getAgentRunTraces(id: string): Promise<AgentRunTrace[]> {
  const { data, error } = await api.api["audit-cases"]({ id }).trace.get();
  if (error) throw new ApiRequestError("加载运行轨迹失败", error.status);
  if (!data || "error" in data) throw new ApiRequestError("无法加载运行轨迹", 404);
  return data;
}

export async function getAgentRuns(limit?: number): Promise<AgentRunSummary[]> {
  const { data, error } = await api.api["agent-runs"].get({
    query: limit === undefined ? {} : { limit },
  });
  if (error) throw new ApiRequestError("加载运行记录失败", Number(error.status));
  return data;
}

export async function getAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).get();
  if (error) throw new ApiRequestError("加载审计详情失败", error.status);
  if (!data || "error" in data) throw new ApiRequestError("无法加载审计详情", 404);
  return data;
}

export async function submitReview(
  findingId: string,
  decision: "ACCEPTED" | "REJECTED",
  reason?: string,
) {
  const { data, error } = await api.api.findings({ id: findingId }).reviews.post({
    decision,
    ...(reason === undefined ? {} : { reason }),
  });
  if (error) throw new ApiRequestError("提交复核失败", error.status);
  return data;
}

export async function getAuditOverview(): Promise<AuditOverview> {
  const { data, error } = await api.api.stats.overview.get();
  if (error) throw new ApiRequestError("加载统计失败", Number(error.status));
  return data;
}

export async function cancelAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).cancel.post();
  if (error) throw new ApiRequestError("取消审计失败", error.status);
  return data;
}

export async function retryAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).retry.post();
  if (error) throw new ApiRequestError("重试审计失败", error.status);
  return data;
}

export async function getApiHealth(): Promise<"ok" | "unavailable"> {
  const { data, error } = await api.api.health.get();
  if (error || !data) return "unavailable";
  return data.status;
}

export function getAuditEventsUrl(id: string): string {
  return `${API_BASE_URL}/api/audit-cases/${encodeURIComponent(id)}/events`;
}
