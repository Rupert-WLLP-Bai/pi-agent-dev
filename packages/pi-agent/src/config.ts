import { LLMNotConfiguredError } from "@contract-audit/audit/model";
import { InMemoryCredentialStore, InMemoryModelsStore, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const PI_AGENT_PROVIDER = "xyg" as const;
export const PI_AGENT_VERSION = "0.85.1" as const;

/**
 * vLLM OpenAI-compat (deepseek-v4-flash / dsv4) thinks by default. The stream
 * then fills `max_tokens` with `reasoning` and never emits tool calls, so the
 * dispatcher hits AGENT_TIMEOUT with only RUN_STARTED. Sending
 * `chat_template_kwargs.enable_thinking=false` turns that off — measured at
 * ~2s for a tiny completion versus minutes of silent reasoning.
 */
export const VLLM_THINKING_OFF_COMPAT = {
  thinkingFormat: "chat-template",
  chatTemplateKwargs: { enable_thinking: false },
  thinkingTokenBudgetField: "thinking_token_budget",
  // Pi maps a reasoning model onto OpenAI's `developer` role. Infini-AI and
  // most other OpenAI-compat gateways only accept system/user/assistant/tool,
  // so a 400 would otherwise complete the session with zero tool calls.
  supportsDeveloperRole: false,
} as const satisfies NonNullable<Model<"openai-completions">["compat"]>;

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
    // Must be true so Pi actually emits the thinking-off chat_template_kwargs.
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.maxInput,
    maxTokens: config.maxOutput,
    compat: VLLM_THINKING_OFF_COMPAT,
  };
}

/**
 * Creates the Pi model runtime entirely in memory: the provider, its models,
 * and the API key live only in process memory. This function logs nothing,
 * persists nothing, and writes no key to any file.
 */
export async function createModelRuntime(config: PiConfig): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    modelsStore: new InMemoryModelsStore(),
    credentials: new InMemoryCredentialStore(),
    allowModelNetwork: false,
  });

  const model = buildModel(config);
  runtime.registerProvider(PI_AGENT_PROVIDER, {
    name: "XYG",
    baseUrl: config.endpoint,
    api: "openai-completions",
    authHeader: true,
    apiKey: config.apiKey,
    models: [
      {
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      },
    ],
  });

  return runtime;
}
