import type { LlmProviderInput, LlmProviderStore } from "./provider-repository";

const DEFAULT_MAX_INPUT = 128_000;
const DEFAULT_MAX_OUTPUT = 4_096;

/** Reads a positive integer setting, falling back when it is absent or junk. */
function readLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Materializes the `XYG_*` environment configuration as the first provider row.
 *
 * The runtime falls back to those variables whenever no row is active, so
 * without this the console would show an empty model service while audits were
 * demonstrably using a working endpoint — the operator could not see or edit
 * the configuration actually in force. Importing it once makes the page the
 * single place the model service is described.
 *
 * Runs only when the table is empty, so a deployment that manages providers
 * through the console is never overwritten. A delete therefore re-imports on
 * the next boot, which is the honest state: the environment fallback is still
 * serving audits, so the row it describes still exists.
 *
 * Returns the imported row's id, or null when there was nothing to import.
 */
export async function seedProviderFromEnv(store: LlmProviderStore): Promise<string | null> {
  const existing = await store.list();
  if (existing.length > 0) return null;

  const endpoint = process.env.XYG_ENDPOINT?.trim();
  const apiKey = process.env.XYG_API_KEY?.trim();
  const model = process.env.XYG_MODEL?.trim();
  // Not configured via the environment either — leave the table empty and let
  // the runtime report LLM_NOT_CONFIGURED when an audit starts.
  if (!endpoint || !apiKey || !model) return null;

  const input: LlmProviderInput = {
    name: "默认模型服务",
    endpoint,
    model,
    apiKey,
    maxInput: readLimit(process.env.XYG_MAX_INPUT, DEFAULT_MAX_INPUT),
    maxOutput: readLimit(process.env.XYG_MAX_OUTPUT, DEFAULT_MAX_OUTPUT),
    enabled: true,
  };

  const created = await store.create(input);
  await store.activate(created.id);
  return created.id;
}
