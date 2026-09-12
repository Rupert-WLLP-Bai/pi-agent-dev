/**
 * Minimal MCP stream client for the Qichacha agent platform.
 *
 * QCC exposes each server as a JSON-RPC-over-SSE HTTP endpoint. This client
 * sends one `tools/call` request per invocation and reads the single SSE
 * `message` event that carries the result. It is deliberately not a general
 * MCP implementation — it covers exactly the two calls the subject-verification
 * adapter needs: `get_company_by_query` and `get_company_risk_scan`.
 *
 * `fetchImpl` exists so tests can replay recorded provider responses without
 * the network; production code leaves it undefined and uses global fetch.
 */

export interface McpToolResult {
  /** The parsed JSON content the tool returned (QCC wraps text as JSON). */
  content: unknown;
}

export type McpFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class McpStreamClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: McpFetch = globalThis.fetch,
  ) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `MCP HTTP ${response.status}: ${await response.text().catch(() => "unreadable")}`,
      );
    }

    const text = await response.text();
    const data = this.parseSseMessage(text);
    const content = data?.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error(`MCP response missing content: ${text.slice(0, 200)}`);
    }

    const first = content[0] as { type: string; text?: string };
    if (first.type !== "text" || typeof first.text !== "string") {
      throw new Error(`MCP response not text: ${JSON.stringify(first).slice(0, 200)}`);
    }

    return { content: JSON.parse(first.text) };
  }

  /** Extracts the JSON-RPC result from an SSE `event: message` body. */
  private parseSseMessage(raw: string): { result?: { content?: unknown[] } } {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      return JSON.parse(line.slice(6));
    }
    throw new Error(`No SSE data line in response: ${raw.slice(0, 200)}`);
  }
}
