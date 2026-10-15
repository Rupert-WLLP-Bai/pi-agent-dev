import type { AgentTraceObservation, AgentTraceTokens } from "@contract-audit/audit/model";
import type { AgentTraceSink } from "@contract-audit/audit/ports";

export interface PiTraceReporter {
  /** Hand this to the collector. */
  readonly sink: AgentTraceSink;
  /** Feed every Pi session event here, in the order the SDK delivers them. */
  observe(event: unknown): void;
  /** How many tool calls the reporter saw. Distinguishes "no findings" from "never ran". */
  readonly toolCalls: number;
  /**
   * The provider's own error text when a turn ended in `stopReason: "error"`.
   * Empty-content 400s otherwise look like a successful no-tool run.
   */
  readonly lastProviderError: string | null;
  /** Reports the run's own outcome; call once, when the run leaves its try block. */
  close(outcome: "completed" | "failed"): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Token counts as the trace reports them, or null when the provider gave none. */
function readTokens(message: unknown): AgentTraceTokens | null {
  if (!isRecord(message)) return null;
  const usage = message.usage;
  if (!isRecord(usage)) return null;
  const { input, output } = usage;
  if (typeof input !== "number" || typeof output !== "number") return null;
  const tokens: AgentTraceTokens = { input, output };
  if (typeof usage.cacheRead === "number") tokens.cacheRead = usage.cacheRead;
  if (typeof usage.cacheWrite === "number") tokens.cacheWrite = usage.cacheWrite;
  if (typeof usage.reasoning === "number") tokens.reasoning = usage.reasoning;
  if (typeof usage.totalTokens === "number") tokens.total = usage.totalTokens;
  return tokens;
}

/**
 * The assistant's own words for a turn, or null when the message carries none
 * — a pure tool-calling turn produces no text.
 */
function assistantTextOf(message: unknown): string | null {
  if (!isRecord(message) || message.role !== "assistant") return null;
  const content = message.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (isRecord(part) && part.type === "text" ? part.text : null))
    .filter((part): part is string => typeof part === "string")
    .join("")
    .trim();
  return text || null;
}

function stage(at: string, label: string, turnIndex?: number): AgentTraceObservation {
  return {
    kind: "STAGE",
    at,
    label,
    ref: null,
    parentRef: null,
    input: turnIndex === undefined ? null : { turnIndex },
    output: null,
    isError: false,
    durationMs: null,
    tokens: null,
  };
}

/** A nested call's parent, or null when the SDK reports no parent. */
function parentRefOf(raw: Record<string, unknown>): string | null {
  const parent = raw.parentToolCallId;
  return typeof parent === "string" && parent.length > 0 ? parent : null;
}

/**
 * What a closed turn executed, as the trace's output for the TURN_COMPLETED
 * step: the count of tool results it returned, or null when the SDK attached
 * none. Kept deliberately small — the tool rows themselves carry the payloads.
 */
function toolResultCountOf(message: unknown, toolResults: unknown): { toolResults: number } | null {
  if (Array.isArray(toolResults)) return { toolResults: toolResults.length };
  return isRecord(message) && Array.isArray(message.content) ? { toolResults: 0 } : null;
}

/**
 * Turns Pi session events into trace steps.
 *
 * Events arrive from the SDK as `unknown` and are read defensively: an event
 * type we do not model, or a field that changed shape, is skipped rather than
 * crashing the audit it is meant to describe.
 *
 * The reporter tracks run and turn boundaries and tool counts. Tool durations
 * come from the SDK's monotonic clock rather than wall-clock event timestamps.
 * Nested calls — the ones a tool made through `ctx.executeTool()` — arrive with
 * `parentToolCallId`, which becomes the step's `parentRef`; the tree the trace
 * describes is observed from the SDK, never inferred from ordering.
 */
export function createPiTraceReporter(
  sink: AgentTraceSink,
  now: () => number = Date.now,
): PiTraceReporter {
  let toolCalls = 0;
  let lastProviderError: string | null = null;
  let started = false;
  let closed = false;
  let turnIndex = 0;
  let turnOpenedAt: number | null = null;

  return {
    sink,
    get toolCalls() {
      return toolCalls;
    },
    get lastProviderError() {
      return lastProviderError;
    },
    observe(raw) {
      if (!isRecord(raw)) return;
      const at = new Date(now()).toISOString();
      switch (raw.type) {
        case "agent_start":
          // One trace describes one run, so the first start wins even if the
          // session is prompted again.
          if (!started) {
            started = true;
            sink(stage(at, "RUN_STARTED"));
          }
          return;
        case "turn_start":
          // One trace describes one run, so the first start wins even if the
          // session is prompted again. A turn is the only boundary the SDK
          // actually draws; the UI groups by it rather than guessing.
          turnIndex += 1;
          turnOpenedAt = now();
          sink(stage(at, "TURN_STARTED", turnIndex));
          return;
        case "turn_end": {
          if (turnOpenedAt === null) return;
          const durationMs = Math.max(0, Math.round(now() - turnOpenedAt));
          turnOpenedAt = null;
          const message = raw.message;
          sink({
            ...stage(at, "TURN_COMPLETED", turnIndex),
            durationMs,
            tokens: isRecord(message) ? readTokens(message) : null,
            output: isRecord(message) ? toolResultCountOf(message, raw.toolResults) : null,
          });
          return;
        }
        case "tool_execution_start": {
          const { toolCallId, toolName } = raw;
          if (typeof toolCallId !== "string" || typeof toolName !== "string") return;
          toolCalls += 1;
          sink({
            kind: "TOOL_CALL",
            at,
            label: toolName,
            ref: toolCallId,
            parentRef: parentRefOf(raw),
            input: raw.args ?? null,
            output: null,
            isError: false,
            durationMs: null,
            tokens: null,
          });
          return;
        }
        case "tool_execution_end": {
          const { toolCallId, toolName } = raw;
          if (typeof toolCallId !== "string" || typeof toolName !== "string") return;
          const durationMs =
            typeof raw.durationMs === "number" &&
            Number.isFinite(raw.durationMs) &&
            raw.durationMs >= 0
              ? Math.round(raw.durationMs)
              : null;
          sink({
            kind: "TOOL_RESULT",
            at,
            label: toolName,
            ref: toolCallId,
            parentRef: parentRefOf(raw),
            input: null,
            output: raw.result ?? null,
            isError: raw.isError === true,
            durationMs,
            tokens: null,
          });
          return;
        }
        case "message_end": {
          if (isRecord(raw.message) && raw.message.stopReason === "error") {
            const errorMessage =
              typeof raw.message.errorMessage === "string" && raw.message.errorMessage.length > 0
                ? raw.message.errorMessage
                : "provider error";
            lastProviderError = errorMessage;
            sink({
              kind: "MESSAGE",
              at,
              label: "assistant",
              ref: null,
              parentRef: null,
              input: null,
              output: errorMessage,
              isError: true,
              durationMs: null,
              tokens: readTokens(raw.message),
            });
            return;
          }
          const text = assistantTextOf(raw.message);
          if (text === null) return;
          sink({
            kind: "MESSAGE",
            at,
            label: "assistant",
            ref: null,
            parentRef: null,
            input: null,
            output: text,
            isError: false,
            durationMs: null,
            tokens: readTokens(raw.message),
          });
          return;
        }
        default:
          // `agent_end` deliberately falls through: it also fires when a
          // session is torn down after an abort, so it cannot say whether the
          // run succeeded. `close` reports the run's own outcome instead.
          return;
      }
    },
    close(outcome) {
      if (closed) return;
      closed = true;
      const label = outcome === "completed" ? "RUN_COMPLETED" : "RUN_FAILED";
      sink(stage(new Date(now()).toISOString(), label));
    },
  };
}
