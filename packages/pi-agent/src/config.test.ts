import { expect, test } from "bun:test";
import { buildModel, VLLM_THINKING_OFF_COMPAT } from "./config";

const config = {
  endpoint: "http://llm.example",
  apiKey: "test-key",
  model: "deepseek-v4-flash",
  maxInput: 128000,
  maxOutput: 4096,
};

test("the audit model tells vLLM to keep thinking off", () => {
  const model = buildModel(config);
  expect(model.reasoning).toBe(true);
  expect(model.compat).toEqual(VLLM_THINKING_OFF_COMPAT);
  expect(model.compat?.chatTemplateKwargs).toEqual({ enable_thinking: false });
  expect(model.compat?.supportsDeveloperRole).toBe(false);
});
