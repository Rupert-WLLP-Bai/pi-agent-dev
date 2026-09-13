import type {
  AgentRunSummary,
  AuditActionLog,
  AuditOverview,
  CaseSummary,
  createApp,
  Remediation,
  RemediationBoard,
  ReviewQueueItem,
  RuleDetail,
  RuleListItem,
  RuleVersionRecord,
  ValidationCaseListItem,
  ValidationRunListItem,
  ValidationRunRecord,
  ValidationRunView,
} from "@contract-audit/api";
import type { AgentRunTrace } from "@contract-audit/audit/model";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import { treaty } from "@elysiajs/eden";
import { readOperator } from "./operator";
import type { RuleParams } from "./rule-presentation";

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

/**
 * The review queue: one row per chain-head finding on a case awaiting review,
 * already ordered by the server (evidence conflicts, then severity, then SLA).
 */
export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  const { data, error } = await api.api.reviews.queue.get({ query: {} });
  if (error) throw new ApiRequestError("加载复核队列失败", Number(error.status));
  return data;
}

export interface AssignCaseInput {
  /** Operator name; null returns the case to the shared queue. */
  assignee?: string | null;
  priority?: ReviewPriority;
}

/** Assigns a case (受理/转交) or sets its review priority. */
export async function assignCase(id: string, input: AssignCaseInput) {
  const { data, error } = await api.api["audit-cases"]({ id }).assignment.post({
    ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  });
  if (error) throw new ApiRequestError("指派复核失败", error.status);
  return data;
}

/**
 * Picks the API's Chinese reason out of an Eden error body. A write refused for
 * a business reason (an illegal advance, a self-confirm) carries the reason the
 * operator needs, so the client surfaces it instead of a generic failure.
 */
function apiErrorDetail(error: { value: unknown }): string | null {
  const { value } = error;
  if (value === null || typeof value !== "object" || !("error" in value)) return null;
  const message = value.error;
  return typeof message === "string" && message.length > 0 ? message : null;
}

/** The 整改跟踪 board: four lifecycle columns, each with its cards and count. */
export async function listRemediations(): Promise<RemediationBoard> {
  const { data, error } = await api.api.remediations.get();
  if (error) throw new ApiRequestError("加载整改看板失败", Number(error.status));
  return data;
}

export interface UpdateRemediationInput {
  owner?: string | null;
  dueAt?: string | null;
  progressNote?: string | null;
  /** Advance exactly one step; `closed` is only reachable through closeRemediation. */
  status?: "in_progress" | "awaiting_review";
}

export async function updateRemediation(
  id: string,
  input: UpdateRemediationInput,
): Promise<Remediation> {
  const { data, error } = await api.api.remediations({ id }).patch({
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
    ...(input.progressNote === undefined ? {} : { progressNote: input.progressNote }),
    ...(input.status === undefined ? {} : { status: input.status }),
  });
  if (error) {
    throw new ApiRequestError(apiErrorDetail(error) ?? "更新整改项失败", Number(error.status));
  }
  if ("error" in data) throw new ApiRequestError("更新整改项失败", 500);
  return data;
}

/** Closes a 待复核 item. The reviewer must differ from the owner. */
export async function closeRemediation(id: string, closedBy: string): Promise<Remediation> {
  const { data, error } = await api.api.remediations({ id }).close.post({ closedBy });
  if (error) {
    throw new ApiRequestError(apiErrorDetail(error) ?? "关闭整改项失败", Number(error.status));
  }
  if ("error" in data) throw new ApiRequestError("关闭整改项失败", 500);
  return data;
}

export async function getAuditOverview(): Promise<AuditOverview> {
  const { data, error } = await api.api.stats.overview.get();
  if (error) throw new ApiRequestError("加载统计失败", Number(error.status));
  // Eden revives anything shaped like a date into a real Date, so the wire types
  // understate what arrives. Restore the shape this function promises rather than
  // letting every caller discover the difference at runtime.
  return {
    ...data,
    dailyCounts: data.dailyCounts.map((day) => ({ ...day, date: toDayKey(day.date) })),
    pendingReview: data.pendingReview.map((item) => ({
      ...item,
      updatedAt: new Date(item.updatedAt).toISOString(),
    })),
  };
}

/** `YYYY-MM-DD` for a day bucket that arrived as a Date; anything else passes through. */
const toDayKey = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

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

/**
 * Reassesses a case under the rules in force now: the server rebuilds the
 * snapshot from the current published Rule Versions and requeues it. Distinct
 * from a retry, which reruns the agent against the snapshot it already has.
 */
export async function reassessAuditCase(id: string) {
  const { data, error } = await api.api["audit-cases"]({ id }).reassess.post();
  if (error) throw new ApiRequestError("重评失败", error.status);
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

// ── Rule governance ──────────────────────────────────────────────

export interface RuleStanceInput {
  preferred: string;
  acceptableRetreat: string;
  unacceptable: string;
  exceptionApproval: string;
}

export type RuleParamValues = Record<string, string | number | boolean>;
export interface CreateRuleInput {
  code: string;
  name: string;
  contractType: string;
  description: string;
  params: RuleParams;
  stances: RuleStanceInput;
}

/**
 * The server's Chinese reason when it sent one, else a caller-supplied
 * fallback — a 409 that gates a publish must reach the operator verbatim. */
function serverReason(error: { value: unknown }, fallback: string): string {
  const value = error.value;
  if (typeof value === "object" && value !== null && "error" in value) {
    const reason = value.error;
    if (typeof reason === "string" && reason.length > 0) return reason;
  }
  return fallback;
}

export async function listRules(): Promise<RuleListItem[]> {
  const { data, error } = await api.api.rules.get();
  if (error) throw new ApiRequestError("加载规则列表失败", Number(error.status));
  return data;
}

/** A rule's governance trail (操作记录): disable, enable and publish, newest first. */
export async function listRuleActions(id: string): Promise<AuditActionLog[]> {
  const { data, error } = await api.api.rules({ id }).actions.get();
  if (error) throw new ApiRequestError("加载规则操作记录失败", Number(error.status));
  return data.actions;
}

export async function getRule(id: string): Promise<RuleDetail> {
  const { data, error } = await api.api.rules({ id }).get();
  if (error) throw new ApiRequestError("加载规则详情失败", error.status);
  if (!data || "error" in data) throw new ApiRequestError("无法加载规则详情", 404);
  return data;
}

export async function createRule(input: CreateRuleInput): Promise<RuleDetail> {
  const { data, error } = await api.api.rules.post(input);
  if (error) throw new ApiRequestError(serverReason(error, "创建规则失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("创建规则失败", 500);
  return data;
}

export async function updateRule(
  id: string,
  input: { name?: string; contractType?: string; description?: string },
): Promise<RuleDetail["rule"]> {
  const { data, error } = await api.api.rules({ id }).put(input);
  if (error) throw new ApiRequestError(serverReason(error, "更新规则失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("更新规则失败", 500);
  return data.rule;
}

export async function createRuleVersion(
  id: string,
  input: { params: RuleParams; stances: RuleStanceInput },
): Promise<RuleVersionRecord> {
  const { data, error } = await api.api.rules({ id }).versions.post(input);
  if (error)
    throw new ApiRequestError(serverReason(error, "创建规则版本失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("创建规则版本失败", 500);
  return data.version;
}

/**
 * Saves parameters and stances onto the open draft. The editor calls this when
 * a draft already exists — a rule carries at most one draft, so a fresh POST
 * would be a 409. */
export async function updateRuleVersion(
  id: string,
  versionId: string,
  input: { params: RuleParams; stances: RuleStanceInput },
): Promise<RuleVersionRecord> {
  const { data, error } = await api.api.rules({ id }).versions({ versionId }).put(input);
  if (error)
    throw new ApiRequestError(serverReason(error, "保存规则草稿失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("保存规则草稿失败", 500);
  return data.version;
}

export async function validateRule(id: string, triggeredBy: string): Promise<ValidationRunRecord> {
  const { data, error } = await api.api.rules({ id }).validate.post({ triggeredBy });
  if (error)
    throw new ApiRequestError(serverReason(error, "运行规则验证失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("运行规则验证失败", 500);
  return data.run;
}

export async function publishRule(
  id: string,
  publishedBy: string,
): Promise<{ rule: RuleDetail["rule"]; version: RuleVersionRecord }> {
  const { data, error } = await api.api.rules({ id }).publish.post({ publishedBy });
  if (error) throw new ApiRequestError(serverReason(error, "发布规则失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("发布规则失败", 500);
  return data;
}

/**
 * Takes a rule out of rotation (停用). New audit cases omit it; cases already
 * recorded keep the assessments they captured. A reason is required so the
 * governance trail explains the disablement.
 */
export async function disableRule(id: string, reason: string): Promise<RuleListItem> {
  const { data, error } = await api.api
    .rules({ id })
    .disable.post({ reason, actor: readOperator() });
  if (error) throw new ApiRequestError(serverReason(error, "停用规则失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("停用规则失败", 500);
  return data.rule as RuleListItem;
}

/** Puts a disabled rule back in rotation (启用), clearing the disable overlay. */
export async function enableRule(id: string): Promise<RuleListItem> {
  const { data, error } = await api.api.rules({ id }).enable.post({ actor: readOperator() });
  if (error) throw new ApiRequestError(serverReason(error, "启用规则失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("启用规则失败", 500);
  return data.rule as RuleListItem;
}

// ── Case validation ──────────────────────────────────────────────

export async function listValidationCases(
  query: { ruleCode?: string; caseType?: string } = {},
): Promise<ValidationCaseListItem[]> {
  const { data, error } = await api.api.validation.cases.get({ query });
  if (error) throw new ApiRequestError("加载验证案例失败", Number(error.status));
  if (!Array.isArray(data)) throw new ApiRequestError("加载验证案例失败", 500);
  return data;
}

/**
 * Runs the golden set for one rule (or every rule when `ruleId` is omitted)
 * against the rule version's current parameters.
 */
export async function runValidation(input: { ruleId?: string; triggeredBy: string }) {
  const { data, error } = await api.api.validation.runs.post(input);
  if (error) throw new ApiRequestError(serverReason(error, "运行验证失败"), Number(error.status));
  if (!data || "error" in data) throw new ApiRequestError("运行验证失败", 500);
  return data;
}

export async function listValidationRuns(ruleId?: string): Promise<ValidationRunListItem[]> {
  const { data, error } = await api.api.validation.runs.get({
    query: ruleId === undefined ? {} : { ruleId },
  });
  if (error) throw new ApiRequestError("加载验证历史失败", Number(error.status));
  if (!Array.isArray(data)) throw new ApiRequestError("加载验证历史失败", 500);
  return data;
}

export async function getValidationRun(id: string): Promise<ValidationRunView> {
  const { data, error } = await api.api.validation.runs({ id }).get();
  if (error) throw new ApiRequestError("加载验证运行失败", error.status);
  if (!data || "error" in data) throw new ApiRequestError("加载验证运行失败", 404);
  return data;
}
