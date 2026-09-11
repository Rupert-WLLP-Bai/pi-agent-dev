import { treaty } from "@elysiajs/eden";
import type { createApp } from "@contract-audit/api";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Eden Treaty client typed directly from the Elysia app (architecture
// constraint: monorepo front/back type derivation through Eden Treaty).
const api = treaty<ReturnType<typeof createApp>>(API_BASE_URL);

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface CreateAuditCaseInput {
  contractText: string;
  policyLimitRatio: number;
}

export async function createAuditCase({ contractText, policyLimitRatio }: CreateAuditCaseInput) {
  const { data, error } = await api.api["audit-cases"].post({
    source: "text",
    contractText,
    policyLimitRatio,
  });
  if (error) throw new ApiRequestError("创建审计失败", error.status);
  return data;
}

export async function getAuditCases() {
  const { data, error } = await api.api["audit-cases"].get();
  if (error) throw new ApiRequestError("加载审计列表失败", Number(error.status));
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
