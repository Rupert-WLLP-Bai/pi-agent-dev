import type { AgentTraceObservation, AgentTraceTokens } from "@contract-audit/audit/model";
import type { AgentTraceSink } from "@contract-audit/audit/ports";

export interface PiTraceReporter {
  /** Hand this to the collector. */
  readonly sink: AgentTraceSink;
  /** Feed every Pi session event here, in the order the SDK delivers them. */
  observe(event: unknown): void;
  /** How many tool calls the reporter saw. Distinguishes "no findings" from "never ran". */
  readonly toolCalls: number;
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
  return { input, output };
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
    input: turnIndex === undefined ? null : { turnIndex },
    output: null,
    isError: false,
    durationMs: null,
    tokens: null,
  };
}

/**
 * Turns Pi session events into trace steps.
 *
 * Events arrive from the SDK as `unknown` and are read defensively: an event
 * type we do not model, or a field that changed shape, is skipped rather than
 * crashing the audit it is meant to describe.
 *
 * The reporter is stateful only for timing — the SDK reports when a turn or
 * tool *starts* and when it *ends*, and a harness view is far less useful
 * without the gap between the two.
 */
export function createPiTraceReporter(
  sink: AgentTraceSink,
  now: () => number = Date.now,
): PiTraceReporter {
  const toolStartedAt = new Map<string, number>();
  let toolCalls = 0;
  let started = false;
  let closed = false;

  const elapsed = (since: number | undefined): number | null =>
    since === undefined ? null : Math.max(0, now() - since);

  return {
    sink,
    get toolCalls() {
      return toolCalls;
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
        case "tool_execution_start": {
          const { toolCallId, toolName } = raw;
          if (typeof toolCallId !== "string" || typeof toolName !== "string") return;
          toolCalls += 1;
          toolStartedAt.set(toolCallId, now());
          sink({
            kind: "TOOL_CALL",
            at,
            label: toolName,
            ref: toolCallId,
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
          const durationMs = elapsed(toolStartedAt.get(toolCallId));
          toolStartedAt.delete(toolCallId);
          sink({
            kind: "TOOL_RESULT",
            at,
            label: toolName,
            ref: toolCallId,
            input: null,
            output: raw.result ?? null,
            isError: raw.isError === true,
            durationMs,
            tokens: null,
          });
          return;
        }
        case "message_end": {
          const text = assistantTextOf(raw.message);
          if (text === null) return;
          sink({
            kind: "MESSAGE",
            at,
            label: "assistant",
            ref: null,
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
