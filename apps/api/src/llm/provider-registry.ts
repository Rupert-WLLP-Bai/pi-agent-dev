import type { ActiveProviderConfig, LlmProviderStore } from "./provider-repository";

/**
 * What `GET /api/health` reports for the model service: presence and target
 * only — the credential is never part of this shape.
 */
export interface ProviderDescription {
  providerName: string | null;
  endpoint: string | null;
  model: string | null;
  configured: boolean;
}

/**
 * Holds the config the next audit run uses. `refresh()` re-reads the active
 * `llm_providers` row; `current()` is synchronous because the dispatcher reads
 * an agent's identity while a run is starting, where awaiting a database
 * round-trip is not an option. With no active row `current()` is undefined and
 * the caller falls back to `loadPiConfig()` from the `XYG_*` environment.
 */
export class LlmProviderRegistry {
  private cache: ActiveProviderConfig | undefined;

  constructor(private readonly providers: LlmProviderStore) {}

  /**
   * Re-reads the active row. A database failure clears the cache rather than
   * throwing: health must keep answering, and the environment fallback is the
   * correct degraded behaviour.
   */
  async refresh(): Promise<void> {
    try {
      this.cache = (await this.providers.activeConfig()) ?? undefined;
    } catch {
      this.cache = undefined;
    }
  }

  /** The active provider's config, or undefined when the runtime should use `XYG_*`. */
  current(): ActiveProviderConfig | undefined {
    return this.cache;
  }

  /** The model-service line's inputs: the active provider, else the environment. */
  describe(): ProviderDescription {
    if (this.cache) {
      return {
        providerName: this.cache.name,
        endpoint: this.cache.endpoint,
        model: this.cache.model,
        configured: this.cache.apiKey.length > 0,
      };
    }
    return {
      providerName: null,
      endpoint: process.env.XYG_ENDPOINT ?? null,
      model: process.env.XYG_MODEL ?? null,
      configured: Boolean(process.env.XYG_API_KEY),
    };
  }
}
