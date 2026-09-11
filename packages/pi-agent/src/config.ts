import { LLMNotConfiguredError } from "@contract-audit/audit/model";
import { InMemoryCredentialStore, InMemoryModelsStore, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const PI_AGENT_PROVIDER = "xyg" as const;
export const PI_AGENT_VERSION = "0.85.1" as const;

export interface PiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  maxInput: number;
  maxOutput: number;
}

export function loadPiConfig(): PiConfig {
  const endpoint = process.env.XYG_ENDPOINT;
  const apiKey = process.env.XYG_API_KEY;
  const model = process.env.XYG_MODEL;

  if (!endpoint || !apiKey || !model) {
    throw new LLMNotConfiguredError("LLM_NOT_CONFIGURED");
  }

  return {
    endpoint,
    apiKey,
    model,
    maxInput: Number(process.env.XYG_MAX_INPUT ?? 128000),
    maxOutput: Number(process.env.XYG_MAX_OUTPUT ?? 4096),
  };
}

export function buildModel(config: PiConfig): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: PI_AGENT_PROVIDER,
    baseUrl: config.endpoint,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.maxInput,
    maxTokens: config.maxOutput,
  };
}

/**
 * Creates the Pi model runtime entirely in memory: the provider, its models,
 * and the API key live only in process memory. No key is logged, persisted,
 * or written to any file (architecture constraint).
 */
export async function createModelRuntime(config: PiConfig): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    modelsStore: new InMemoryModelsStore(),
    credentials: new InMemoryCredentialStore(),
    allowModelNetwork: false,
  });

  runtime.registerProvider(PI_AGENT_PROVIDER, {
    name: "XYG",
    baseUrl: config.endpoint,
    api: "openai-completions",
    authHeader: true,
    apiKey: config.apiKey,
    models: [
      {
        id: config.model,
        name: config.model,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.maxInput,
        maxTokens: config.maxOutput,
      },
    ],
  });

  return runtime;
}
