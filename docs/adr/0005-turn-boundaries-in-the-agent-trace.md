---
status: accepted
---

# Capture Pi turn boundaries as trace steps instead of deriving turns in the UI

The trace tree groups Tool Calls under the Agent Turn that issued them, and a run's token accounting belongs to those turns. Turn boundaries are therefore captured from Pi's own `turn_start` / `turn_end` events as `TURN_STARTED` / `TURN_COMPLETED` STAGE steps in the Agent Trace, instead of letting the UI derive turns from step adjacency.

Pi's `turn_end` event is the only real boundary: it carries the assistant `message`, the turn's `toolResults`, and the full `usage` (input, output, cacheRead, cacheWrite, totalTokens). `turn_start` carries only `turnIndex` and a timestamp. The turn's output — what the assistant said, which tools it ran, what it cost — is complete only at the end, so the end event, not adjacency or a start marker, is what the trace records and the UI renders.

## Considered Options

- **Deriving turns in the UI from adjacency.** Grouping a run of Tool Calls between assistant messages would make the grouping a presentation heuristic: two unrelated runs that happen to look alike would render the same tree, and any step kind the heuristic forgot would silently reshape the grouping. The trace is the record of what happened; grouping that depends on reading order is not a boundary, it is a guess.
- **Deriving turns from `turn_start` alone.** A start marker without the end event would bound a turn only when the next one begins, leaving the final turn unbounded and attributing no usage or tool results to it.
- **Synthesizing a turn per tool call.** That would assert a one-turn-per-call shape the SDK never claims and would double-count usage on turns that issued several calls.

## Context

- Pi 1.2.0 emits `turn_start` (`turnIndex`, `timestamp`) and `turn_end` (`turnIndex`, `message`, `toolResults`, `messageEntryId`, `toolResultEntryIds`) session events.
- The trace reporter maps these two events to STAGE steps defensively; usage fields the provider omits stay absent rather than being zero-filled.
- A trace step's stage codes are the stable contract between producer and UI; adding `TURN_STARTED` / `TURN_COMPLETED` keeps the UI a renderer, not an interpreter.

## Consequences

- Token counts (input/output/cacheRead/cacheWrite/totalTokens) and tool-result counts are recorded at the boundary where the SDK reports them, so a turn's cost is attributable to the turn that produced it.
- Legacy traces recorded before turn stages existed render unchanged: the UI groups them under a synthetic root turn, so history stays readable without rewriting stored traces.
- The UI contains no turn-inference logic to drift out of sync with the runtime — it renders the stages the trace recorded.
