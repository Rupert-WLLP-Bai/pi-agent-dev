import { assertAllowedLlmEndpoint } from "./endpoint-allowlist";

/**
 * Shared OpenAI-compatible catalog probe for saved providers and draft settings.
 * Model limits are optional: the base OpenAI catalog does not specify them.
 */

/** A hung provider must not hold a request open; the fetch is abandoned after this long. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProviderModel {
  id: string;
  maxInput: number | null;
  maxOutput: number | null;
}

/** Every advertised token budget must be a positive integer; unknown stays null. */
function tokenLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function applyLimits(model: ProviderModel, value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  model.maxInput ??=
    ("max_input_tokens" in value ? tokenLimit(value.max_input_tokens) : null) ??
    ("input_token_limit" in value ? tokenLimit(value.input_token_limit) : null) ??
    ("maxInput" in value ? tokenLimit(value.maxInput) : null) ??
    ("context_length" in value ? tokenLimit(value.context_length) : null) ??
    ("context_window" in value ? tokenLimit(value.context_window) : null) ??
    ("max_model_len" in value ? tokenLimit(value.max_model_len) : null);
  model.maxOutput ??=
    ("max_output_tokens" in value ? tokenLimit(value.max_output_tokens) : null) ??
    ("max_completion_tokens" in value ? tokenLimit(value.max_completion_tokens) : null) ??
    ("output_token_limit" in value ? tokenLimit(value.output_token_limit) : null) ??
    ("maxOutput" in value ? tokenLimit(value.maxOutput) : null);
}

/** The probe result in full; each route projects the part it needs. */
export interface ProviderProbe {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  models: ProviderModel[];
}

/**
 * Reads `{endpoint}/models` with optional authentication. Transport failures
 * return a failed probe. A successful non-JSON response proves reachability
 * but provides no model catalog.
 */
export async function probeProvider(endpoint: string, apiKey: string): Promise<ProviderProbe> {
  try {
    assertAllowedLlmEndpoint(endpoint);
  } catch {
    return {
      ok: false,
      error: "模型服务地址不在允许范围内",
      latencyMs: 0,
      models: [],
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
      headers: apiKey.trim().length > 0 ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        error: `模型服务返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        latencyMs,
        models: [],
      };
    }
    const models: ProviderModel[] = [];
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data)) {
        for (const entry of body.data) {
          if (
            typeof entry !== "object" ||
            entry === null ||
            !("id" in entry) ||
            typeof entry.id !== "string" ||
            entry.id.length === 0
          )
            continue;
          const model: ProviderModel = { id: entry.id, maxInput: null, maxOutput: null };
          applyLimits(model, entry);
          if ("top_provider" in entry) applyLimits(model, entry.top_provider);
          if ("metadata" in entry) applyLimits(model, entry.metadata);
          models.push(model);
        }
      }
    } catch {
      // A 2xx with a non-JSON body still proves reachability; the catalog stays empty.
    }
    return { ok: true, error: null, latencyMs, models };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
      models: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
