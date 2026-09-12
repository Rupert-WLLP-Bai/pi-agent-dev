import type { AgentTraceObservation, AgentTraceStep } from "./model";
import type { AgentTraceSink } from "./ports";

/** Receives each collected step, in sequence order. */
export type AgentTraceWriter = (step: AgentTraceStep) => Promise<void>;

export interface AgentTraceCollector {
  /** Hand this to the agent. Never throws, never blocks. */
  readonly sink: AgentTraceSink;
  /** Resolves once every accepted step has been written. */
  flush(): Promise<void>;
  /** Steps accepted so far, in sequence order. Used by tests and smoke runs. */
  readonly steps: readonly AgentTraceStep[];
}

/**
 * Collects the steps an agent reports and writes them in the order they were
 * observed.
 *
 * The agent calls `sink` synchronously from its own event callbacks, so this
 * assigns `sequence` immediately and queues the write behind the previous one.
 * That keeps the stored order stable without making the agent wait on I/O.
 *
 * A failed write is swallowed on purpose. A trace is evidence about an audit;
 * losing a trace step must not turn a successful audit into a failed one.
 */
export function createAgentTraceCollector(
  runId: string,
  write: AgentTraceWriter,
): AgentTraceCollector {
  const steps: AgentTraceStep[] = [];
  let tail: Promise<void> = Promise.resolve();

  const sink: AgentTraceSink = (observation: AgentTraceObservation) => {
    const step: AgentTraceStep = { ...observation, runId, sequence: steps.length };
    steps.push(step);
    tail = tail.then(() => write(step)).catch(() => undefined);
  };

  return {
    sink,
    steps,
    flush: () => tail,
  };
}
