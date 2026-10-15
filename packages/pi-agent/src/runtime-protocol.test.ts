import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface GatewayRequest {
  messages: { role: string; content: unknown }[];
  tools: { function: { name: string } }[];
  chat_template_kwargs?: { enable_thinking?: boolean };
}

const ambientInstruction = "AMBIENT_AUDIT_OVERRIDE";

function completionStream(toolCall: boolean): Response {
  const delta = toolCall
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "read-assessments",
            type: "function",
            function: { name: "get_rule_assessments", arguments: "{}" },
          },
        ],
      }
    : { role: "assistant", content: "预付款比例符合制度上限。" };
  const chunks = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    },
  ];
  const body = chunks
    .map(
      (chunk) =>
        `data: ${JSON.stringify({
          id: "audit-completion",
          object: "chat.completion.chunk",
          created: 0,
          model: "audit-contract-model",
          ...chunk,
        })}\n\n`,
    )
    .join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

test.each(["test-key", ""])(
  "audit requests isolate tools and honor API key %j",
  async (apiKey) => {
    const workspace = await mkdtemp(join(tmpdir(), "audit-sdk-boundary-"));
    const requests: GatewayRequest[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        expect(request.headers.get("authorization")).toBe(apiKey ? `Bearer ${apiKey}` : null);
        requests.push((await request.json()) as GatewayRequest);
        return completionStream(requests.length === 1);
      },
    });

    try {
      await mkdir(join(workspace, ".pi"));
      await writeFile(join(workspace, "AGENTS.md"), ambientInstruction);
      await writeFile(join(workspace, ".pi", "APPEND_SYSTEM.md"), ambientInstruction);
      const runtimePath = fileURLToPath(new URL("./runtime.ts", import.meta.url));
      const orchestratorPath = fileURLToPath(
        new URL("../../audit/src/orchestrator.ts", import.meta.url),
      );
      const plaintextPath = fileURLToPath(
        new URL("../../audit/src/plaintext-adapter.ts", import.meta.url),
      );
      const child = Bun.spawn(
        [
          "bun",
          "-e",
          `
          import { PiAuditAgent } from ${JSON.stringify(runtimePath)};
          import { createAuditSnapshot } from ${JSON.stringify(orchestratorPath)};
          import { normalizeContractDocument } from ${JSON.stringify(plaintextPath)};
          const snapshot = createAuditSnapshot({
            sourceRecordId: "audit-sdk-boundary",
            document: normalizeContractDocument("预付款为合同金额的20%。"),
            enabledRuleCodes: ["ADVANCE_PAYMENT_LIMIT"],
          });
          const agent = new PiAuditAgent({
            endpoint: "http://127.0.0.1:${server.port}/v1",
            apiKey: ${JSON.stringify(apiKey)},
            model: "audit-contract-model",
            maxInput: 128000,
            maxOutput: 256,
          });
          const result = await agent.run(snapshot, AbortSignal.timeout(10000), () => {});
          console.log(JSON.stringify({ proposals: result.proposals }));
        `,
        ],
        { cwd: workspace, stdout: "pipe", stderr: "pipe" },
      );
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (exitCode !== 0) throw new Error(`SDK audit subprocess exited ${exitCode}: ${stderr}`);
        expect(JSON.parse(stdout).proposals).toEqual([]);
      } finally {
        if (child.exitCode === null) child.kill();
      }

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(JSON.stringify(request.messages)).not.toContain(ambientInstruction);
        expect(request.messages.some((message) => message.role === "developer")).toBe(false);
        expect(request.messages[0]?.role).toBe("system");
        expect(request.chat_template_kwargs?.enable_thinking).toBe(false);
        expect(request.tools.map((tool) => tool.function.name).sort()).toEqual([
          "get_contract_document",
          "get_evidence",
          "get_rule_assessments",
          "read_contract_block",
          "search_contract",
          "submit_finding_proposal",
        ]);
      }
      const assessmentResult = requests[1]?.messages.find((message) => message.role === "tool");
      expect(JSON.parse(String(assessmentResult?.content)).assessments[0].disposition).toBe(
        "COMPLIANT",
      );
    } finally {
      server.stop(true);
      await rm(workspace, { recursive: true, force: true });
    }
  },
  15000,
);
