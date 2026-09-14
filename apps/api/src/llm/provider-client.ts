/**
 * The outbound OpenAI-compatible probe behind `POST /:id/test` and
 * `GET /:id/models`. Both read `{endpoint}/models`, so one implementation
 * serves both: a caller that only wants reachability ignores `models`, and a
 * caller that wants the catalog ignores `ok`.
 */

/** A hung provider must not hold a request open; the fetch is abandoned after this long. */
export const PROBE_TIMEOUT_MS = 10_000;

/** The probe result in full; each route projects the part it needs. */
export interface ProviderProbe {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  models: string[];
}

/**
 * Reads `{endpoint}/models` with the provider's key. Every failure — a non-2xx
 * status, a refused connection, a timeout, a non-JSON body — becomes a probe
 * result instead of a throw, so a broken provider is never a 500 on the
 * console's own endpoint.
 */
export async function probeProvider(endpoint: string, apiKey: string): Promise<ProviderProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
    const models: string[] = [];
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data)) {
        for (const entry of body.data) {
          if (typeof entry === "object" && entry !== null && "id" in entry) {
            const id = entry.id;
            if (typeof id === "string") models.push(id);
          }
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
