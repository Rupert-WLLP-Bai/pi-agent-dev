import { treaty } from "@elysiajs/eden";
import type { createApp } from "@contract-audit/api";

// Eden Treaty client typed directly from the Elysia app (architecture
// constraint: monorepo front/back type derivation through Eden Treaty).
const api = treaty<ReturnType<typeof createApp>>(
  import.meta.env.VITE_API_URL ?? "http://localhost:3000",
);

export async function createAuditCase(contractText: string, policyLimitRatio?: number) {
  const { data, error } = await api.api["audit-cases"].post({
    source: "text",
    contractText,
    ...(policyLimitRatio === undefined ? {} : { policyLimitRatio }),
  });
  if (error) throw new Error(`请求失败 (${error.status})`);
  return data;
}

export async function getAuditCases() {
  const { data, error } = await api.api["audit-cases"].get();
  if (error) throw new Error(`请求失败 (${error.status})`);
  return data;
}

export async function getAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).get();
  if (error) throw new Error(`请求失败 (${error.status})`);
  if (!data || "error" in data) throw new Error("无法加载审计详情");
  return data;
}

export async function submitReview(findingId: string, decision: "ACCEPTED" | "REJECTED", reason?: string) {
  const { data, error } = await api.api.findings({ id: findingId }).reviews.post({
    decision,
    ...(reason === undefined ? {} : { reason }),
  });
  if (error) throw new Error(`请求失败 (${error.status})`);
  return data;
}

export async function cancelAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).cancel.post();
  if (error) throw new Error(`请求失败 (${error.status})`);
  return data;
}

export async function retryAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).retry.post();
  if (error) throw new Error(`请求失败 (${error.status})`);
  return data;
}
