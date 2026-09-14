import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type { AgentTraceStep } from "@contract-audit/audit/model";
import { Button, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  formatDuration,
  formatTraceOffset,
  formatTracePayload,
  getTraceStageLabel,
  traceStepKindLabels,
} from "../audit-presentation";

/** One timeline row: a step, plus the step that answered it when it was a call. */
export interface TraceEntry {
  key: string;
  step: AgentTraceStep;
  result: AgentTraceStep | null;
}

/** Consecutive same-name tool calls that render as one foldable cluster. */
export interface TraceGroup {
  key: string;
  entries: TraceEntry[];
}

const entryKey = (step: AgentTraceStep): string => `${step.runId}:${step.sequence}`;

const groupExpandKey = (group: TraceGroup): string => `group:${group.key}`;

const stepDomId = (key: string): string => `trace-step-${key}`;

/**
 * Pairs each tool call with the result that answered it.
 *
 * Pairing is by `ref`, not by adjacency: the same tool can be called twice, and
 * two calls can be in flight at once. A result whose call is missing — a trace
 * that starts mid-run — is kept as its own row rather than dropped.
 */
export function toTraceEntries(steps: AgentTraceStep[]): TraceEntry[] {
  const entries: TraceEntry[] = [];
  const awaitingResultAt = new Map<string, number>();

  for (const step of steps) {
    if (step.kind === "TOOL_CALL" && step.ref !== null) {
      awaitingResultAt.set(step.ref, entries.length);
      entries.push({ key: entryKey(step), step, result: null });
      continue;
    }
    if (step.kind === "TOOL_RESULT" && step.ref !== null) {
      const index = awaitingResultAt.get(step.ref);
      if (index !== undefined) {
        awaitingResultAt.delete(step.ref);
        entries[index] = { ...entries[index], result: step };
        continue;
      }
    }
    entries.push({ key: entryKey(step), step, result: null });
  }

  return entries;
}

/**
 * Collapse consecutive same-name tool calls into one group. A MESSAGE, STAGE,
 * or a different tool name starts a new group. A lone call stays a group of one.
 */
export function groupTraceEntries(entries: TraceEntry[]): TraceGroup[] {
  const groups: TraceGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (
      last !== undefined &&
      last.entries[0]?.step.kind === "TOOL_CALL" &&
      entry.step.kind === "TOOL_CALL" &&
      last.entries[0].step.label === entry.step.label
    ) {
      last.entries.push(entry);
      continue;
    }
    groups.push({ key: entry.key, entries: [entry] });
  }
  return groups;
}

/** The distinctive argument a collapsed row should show for a known tool. */
export function summarizeToolInput(label: string, input: unknown): string | null {
  if (input === null || input === undefined || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (label === "search_contract" && typeof record.query === "string") {
    const query = record.query.trim();
    return query === "" ? null : query;
  }
  if (label === "read_contract_block" && typeof record.blockId === "string") {
    return record.blockId;
  }
  if (label === "get_evidence" && Array.isArray(record.evidenceIds)) {
    return record.evidenceIds.length === 0 ? null : `${record.evidenceIds.length} 条证据`;
  }
  if (label === "submit_finding_proposal" && typeof record.findingType === "string") {
    return getFindingTypeLabel(record.findingType);
  }
  return null;
}

/** Serialize a payload for display without truncation — the scrollable panel handles overflow. */
function payloadText(value: unknown): string | null {
  return formatTracePayload(value, Number.POSITIVE_INFINITY);
}

function Payload({ label, text, tone }: { label: string; text: string; tone?: "error" }) {
  return (
    <div className="trace-payload">
      <span className="trace-payload__label">{label}</span>
      <pre
        className={`trace-payload__body${tone === "error" ? " trace-payload__body--error" : ""}`}
      >
        {text}
      </pre>
    </div>
  );
}

function ArgumentChips({ values }: { values: string[] }) {
  if (values.length === 0) return null;
  const visible = values.slice(0, 4);
  const extra = values.length - visible.length;
  return (
    <span className="trace-step__chips">
      {visible.map((value) => (
        <span key={value} className="trace-step__chip">
          「{value}」
        </span>
      ))}
      {extra > 0 ? <span className="trace-step__chip trace-step__chip--more">+{extra}</span> : null}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  const Icon = open ? DownOutlined : RightOutlined;
  return (
    <span className="trace-step__chevron" aria-hidden>
      <Icon />
    </span>
  );
}

function groupDuration(entries: TraceEntry[]): string | null {
  const durations = entries
    .map((entry) => entry.result?.durationMs ?? entry.step.durationMs)
    .filter((value): value is number => value !== null);
  if (durations.length === 0) return null;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  if (min === max) return formatDuration(min);
  const minLabel = formatDuration(min);
  const maxLabel = formatDuration(max);
  if (minLabel === null || maxLabel === null) return null;
  return `${minLabel}–${maxLabel}`;
}

function groupSummaries(entries: TraceEntry[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of entries) {
    const summary = summarizeToolInput(entry.step.label, entry.step.input);
    if (summary === null || seen.has(summary)) continue;
    seen.add(summary);
    values.push(summary);
  }
  return values;
}

// ── Timing overview bar ───────────────────────────────────────────

interface OverviewBar {
  key: string;
  /** Step the bar jumps to; a generation gap jumps to the step that follows it. */
  entryKey: string;
  memberKeys: string[];
  leftPct: number;
  widthPct: number;
  color: string;
  title: string;
  kind: "gap" | "step";
}

interface OverviewLane {
  id: string;
  label: string;
  bars: OverviewBar[];
}

/**
 * A horizontal swimlane chart showing where time was spent during a run.
 *
 * The wall-clock span is computed from the maximum known *end* time (step
 * timestamp + duration), not the last step's start, so a final completed
 * call that runs past the last timestamp is not clipped.
 *
 * Each turn is one lane. Within a lane:
 * - The model-generation gap (time between the previous step's end and this
 *   step's start) is shown as a muted background bar — this is where the
 *   vast majority of wall-clock time goes, and making it visible is the
 *   single most important improvement over the old Gantt.
 * - Tool calls are colored blocks positioned at their actual start, with
 *   width proportional to their duration. Multiple calls in the same turn
 *   are stacked vertically so parallel execution is visible.
 * - Messages are narrow slivers.
 * - An in-flight call (no result yet) gets a zero-width marker at the right
 *   edge rather than disappearing.
 */
function buildOverviewLanes(groups: TraceGroup[]): OverviewLane[] {
  const entries = groups.flatMap((group) => group.entries);
  if (entries.length < 2) return [];

  const firstAt = new Date(entries[0].step.at).getTime();

  let lastEnd = firstAt;
  for (const entry of entries) {
    const start = new Date(entry.step.at).getTime();
    const dur = entry.result?.durationMs ?? entry.step.durationMs ?? 0;
    lastEnd = Math.max(lastEnd, start + dur);
  }
  const span = Math.max(lastEnd - firstAt, 1);

  const lanes: OverviewLane[] = [];
  let currentLane: OverviewLane | null = null;
  let prevEnd = firstAt;

  for (const group of groups) {
    const entry = group.entries[0];
    const { step, result } = entry;
    const start = new Date(step.at).getTime();
    const groupEnd = Math.max(
      ...group.entries.map((item) => {
        const itemStart = new Date(item.step.at).getTime();
        return itemStart + (item.result?.durationMs ?? item.step.durationMs ?? 0);
      }),
    );

    if (step.kind === "STAGE") {
      if (
        step.label === "RUN_STARTED" ||
        step.label === "RUN_COMPLETED" ||
        step.label === "RUN_FAILED"
      ) {
        continue;
      }
      currentLane = { id: entry.key, label: getTraceStageLabel(step.label), bars: [] };
      lanes.push(currentLane);
      prevEnd = start;
      continue;
    }

    if (currentLane === null) {
      currentLane = { id: "run", label: "运行", bars: [] };
      lanes.push(currentLane);
    }

    const gap = start - prevEnd;
    if (gap > 100) {
      const gapLeft = ((prevEnd - firstAt) / span) * 100;
      const gapWidth = (gap / span) * 100;
      currentLane.bars.push({
        key: `${entry.key}-gap`,
        entryKey: entry.key,
        memberKeys: [entry.key],
        leftPct: gapLeft,
        widthPct: Math.max(gapWidth, 0.5),
        color: "#fde68a",
        title: `模型生成 ${(gap / 1000).toFixed(1)}s`,
        kind: "gap",
      });
    }

    const dur = result?.durationMs ?? step.durationMs ?? groupEnd - start;
    const leftPct = ((start - firstAt) / span) * 100;
    const widthPct = Math.max((dur / span) * 100, dur > 0 ? 0.8 : 0);
    const isError = group.entries.some(
      (item) => item.result?.isError === true || item.step.isError,
    );
    const color =
      step.kind === "TOOL_CALL" || step.kind === "TOOL_RESULT"
        ? isError
          ? "#ff4d4f"
          : "#722ed1"
        : step.kind === "MESSAGE"
          ? "#13c2c2"
          : "#d9d9d9";
    const summaries = groupSummaries(group.entries);
    const durationLabel = groupDuration(group.entries) ?? formatDuration(dur) ?? "-";
    const offsetLabel = `+${((start - firstAt) / 1000).toFixed(2)}s`;
    const countLabel =
      step.kind === "MESSAGE"
        ? "模型输出"
        : group.entries.length > 1
          ? `${step.label} ×${group.entries.length}`
          : step.label;
    const summaryLabel = summaries.length === 0 ? null : summaries.join("、");
    const title =
      summaryLabel === null
        ? `${countLabel} · ${durationLabel} · ${offsetLabel}`
        : `${countLabel} · ${summaryLabel} · ${durationLabel} · ${offsetLabel}`;

    currentLane.bars.push({
      key: entry.key,
      entryKey: entry.key,
      memberKeys: group.entries.map((item) => item.key),
      leftPct,
      widthPct: widthPct > 0 ? widthPct : 0.5,
      color,
      title,
      kind: "step",
    });

    prevEnd = Math.max(prevEnd, groupEnd);
  }

  return lanes;
}

function TimingOverview({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: TraceGroup[];
  selectedKey: string | null;
  onSelect: (entryKey: string) => void;
}) {
  const lanes = buildOverviewLanes(groups);
  if (lanes.length === 0) return null;

  return (
    <div className="trace-overview">
      {lanes.map((lane) => (
        <div key={lane.id} className="trace-overview__lane">
          {lane.bars.map((bar) => {
            const tiny = bar.widthPct < 2;
            const selected = selectedKey !== null && bar.memberKeys.includes(selectedKey);
            return (
              <Tooltip key={bar.key} title={bar.title} mouseEnterDelay={0.1}>
                <button
                  type="button"
                  className={`trace-overview__hit${selected ? " trace-overview__hit--selected" : ""}${bar.kind === "gap" ? " trace-overview__hit--gap" : ""}`}
                  style={{
                    left: `${bar.leftPct}%`,
                    width: tiny ? 24 : `${bar.widthPct}%`,
                    marginLeft: tiny ? -12 : 0,
                  }}
                  aria-label={bar.title}
                  aria-pressed={selected}
                  onClick={() => onSelect(bar.entryKey)}
                >
                  <span
                    className="trace-overview__bar"
                    style={{
                      width: tiny ? `${Math.max((bar.widthPct / 24) * 100, 12)}%` : "100%",
                      background: bar.color,
                    }}
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function StepPayloads({ entry, expanded }: { entry: TraceEntry; expanded: boolean }) {
  const { step, result } = entry;
  if (!expanded) return null;

  if (step.kind === "MESSAGE") {
    const text = payloadText(step.output);
    return text === null ? null : (
      <div id={`${entry.key}-panel`}>
        <Payload label="内容" text={text} />
      </div>
    );
  }

  if (step.kind === "TOOL_RESULT" && result === null) {
    const output = payloadText(step.output);
    if (output === null) return null;
    return (
      <div id={`${entry.key}-panel`} className="trace-step__body">
        <Payload
          label={step.isError ? "错误" : "返回"}
          text={output}
          tone={step.isError ? "error" : undefined}
        />
      </div>
    );
  }

  const input = payloadText(step.input);
  const output = payloadText(result?.output);
  if (input === null && output === null) return null;
  return (
    <div id={`${entry.key}-panel`} className="trace-step__body">
      {input === null ? null : <Payload label="入参" text={input} />}
      {output === null ? null : (
        <Payload
          label={result?.isError ? "错误" : "返回"}
          text={output}
          tone={result?.isError ? "error" : undefined}
        />
      )}
    </div>
  );
}

function hasExpandablePayload(entry: TraceEntry): boolean {
  const { step, result } = entry;
  if (step.kind === "MESSAGE") return payloadText(step.output) !== null;
  if (step.kind === "TOOL_RESULT" && result === null) return payloadText(step.output) !== null;
  return payloadText(step.input) !== null || payloadText(result?.output) !== null;
}

function railClass(entry: TraceEntry): string {
  if (entry.step.kind === "STAGE") {
    return `trace-rail trace-rail--${entry.step.label.toLowerCase()}`;
  }
  if (entry.result?.isError === true || entry.step.isError) return "trace-rail trace-rail--error";
  if (entry.step.kind === "MESSAGE") return "trace-rail trace-rail--message";
  if (entry.step.kind === "TOOL_CALL" || entry.step.kind === "TOOL_RESULT") {
    return "trace-rail trace-rail--tool";
  }
  return "trace-rail";
}

function StageRow({
  entry,
  origin,
  selected,
}: {
  entry: TraceEntry;
  origin: string;
  selected: boolean;
}) {
  const duration = formatDuration(entry.step.durationMs);
  return (
    <li
      id={stepDomId(entry.key)}
      className={`trace-stage trace-stage--${entry.step.label.toLowerCase()}${selected ? " trace-row--selected" : ""}`}
    >
      <span className="trace-offset">{formatTraceOffset(origin, entry.step.at)}</span>
      <span className={railClass(entry)} aria-hidden="true" />
      <div className="trace-step__main">
        <span className="trace-stage__label">{getTraceStageLabel(entry.step.label)}</span>
        {duration === null ? null : <span className="trace-stage__duration">{duration}</span>}
      </div>
    </li>
  );
}

function ToolOrMessageRow({
  entry,
  origin,
  expanded,
  selected,
  nested,
  onToggle,
}: {
  entry: TraceEntry;
  origin: string;
  expanded: boolean;
  selected: boolean;
  nested?: boolean;
  onToggle: () => void;
}) {
  const { step, result } = entry;
  const expandable = hasExpandablePayload(entry);
  const isError = result?.isError === true || step.isError;
  const duration = formatDuration(result?.durationMs ?? step.durationMs);
  const summary = summarizeToolInput(step.label, step.input);
  const kindLabel =
    step.kind === "MESSAGE"
      ? traceStepKindLabels.MESSAGE
      : step.kind === "TOOL_RESULT"
        ? traceStepKindLabels.TOOL_RESULT
        : traceStepKindLabels.TOOL_CALL;
  const tagColor = step.kind === "MESSAGE" ? "blue" : isError ? "red" : "geekblue";

  const head = (
    <>
      {nested ? (
        <span className="trace-offset trace-offset--inline">
          {formatTraceOffset(origin, step.at)}
        </span>
      ) : null}
      <Tag color={tagColor}>{kindLabel}</Tag>
      {step.kind === "MESSAGE" ? null : <b className="trace-step__tool">{step.label}</b>}
      {summary === null ? null : <ArgumentChips values={[summary]} />}
      {step.kind === "MESSAGE" && step.tokens !== null ? (
        <span className="trace-step__meta">
          输入 {step.tokens.input.toLocaleString("en-US")} · 输出{" "}
          {step.tokens.output.toLocaleString("en-US")}
        </span>
      ) : null}
      {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
      {step.kind === "TOOL_CALL" && result === null ? (
        <span className="trace-step__meta">等待返回…</span>
      ) : null}
      {expandable ? <Chevron open={expanded} /> : null}
    </>
  );

  const body = <StepPayloads entry={entry} expanded={expanded} />;
  const className = `trace-step ${step.kind === "MESSAGE" ? "trace-step--message" : "trace-step--tool"}${isError ? " trace-step--error" : ""}${selected ? " trace-row--selected" : ""}`;

  if (nested) {
    return (
      <div id={stepDomId(entry.key)} className={`${className} trace-step--nested`}>
        {expandable ? (
          <button
            type="button"
            className="trace-step__head trace-step__head--toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`${entry.key}-panel`}
          >
            {head}
          </button>
        ) : (
          <div className="trace-step__head">{head}</div>
        )}
        {body}
      </div>
    );
  }

  return (
    <li id={stepDomId(entry.key)} className={className}>
      <span className="trace-offset">{formatTraceOffset(origin, step.at)}</span>
      <span className={railClass(entry)} aria-hidden="true" />
      <div className="trace-step__main">
        {expandable ? (
          <button
            type="button"
            className="trace-step__head trace-step__head--toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`${entry.key}-panel`}
          >
            {head}
          </button>
        ) : (
          <div className="trace-step__head">{head}</div>
        )}
        {body}
      </div>
    </li>
  );
}

function ToolGroupRow({
  group,
  origin,
  groupExpanded,
  expanded,
  selectedKey,
  onToggleGroup,
  onToggleEntry,
}: {
  group: TraceGroup;
  origin: string;
  groupExpanded: boolean;
  expanded: ReadonlySet<string>;
  selectedKey: string | null;
  onToggleGroup: () => void;
  onToggleEntry: (key: string) => void;
}) {
  const first = group.entries[0];
  const selected = group.entries.some((entry) => entry.key === selectedKey);
  const duration = groupDuration(group.entries);
  const summaries = groupSummaries(group.entries);
  const waiting = group.entries.some((entry) => entry.result === null);
  const isError = group.entries.some((entry) => entry.result?.isError === true);

  return (
    <li
      className={`trace-step trace-step--tool trace-step--group${isError ? " trace-step--error" : ""}${selected ? " trace-row--selected" : ""}`}
    >
      <span className="trace-offset">{formatTraceOffset(origin, first.step.at)}</span>
      <span className={railClass(first)} aria-hidden="true" />
      <div className="trace-step__main">
        <button
          type="button"
          className="trace-step__head trace-step__head--toggle"
          onClick={onToggleGroup}
          aria-expanded={groupExpanded}
        >
          <Tag color={isError ? "red" : "geekblue"}>{traceStepKindLabels.TOOL_CALL}</Tag>
          <b className="trace-step__tool">{first.step.label}</b>
          <span className="trace-step__count">×{group.entries.length}</span>
          <ArgumentChips values={summaries} />
          {duration === null ? null : <span className="trace-step__meta">{duration}</span>}
          {waiting ? <span className="trace-step__meta">等待返回…</span> : null}
          <Chevron open={groupExpanded} />
        </button>
        {groupExpanded
          ? group.entries.map((entry) => (
              <ToolOrMessageRow
                key={entry.key}
                entry={entry}
                origin={origin}
                expanded={expanded.has(entry.key)}
                selected={selectedKey === entry.key}
                nested
                onToggle={() => onToggleEntry(entry.key)}
              />
            ))
          : null}
      </div>
    </li>
  );
}

export function AgentTraceTimeline({
  steps,
  defaultExpanded = false,
}: {
  steps: AgentTraceStep[];
  /** Start with every payload open — used when the trace is opened to inspect it. */
  defaultExpanded?: boolean;
}) {
  const entries = useMemo(() => toTraceEntries(steps), [steps]);
  const groups = useMemo(() => groupTraceEntries(entries), [entries]);

  const collapsibleKeys = useMemo(() => {
    const keys: string[] = [];
    for (const group of groups) {
      if (group.entries.length > 1) keys.push(groupExpandKey(group));
      for (const entry of group.entries) {
        if (
          entry.step.kind === "TOOL_CALL" ||
          entry.step.kind === "TOOL_RESULT" ||
          entry.step.kind === "MESSAGE"
        ) {
          keys.push(entry.key);
        }
      }
    }
    return keys;
  }, [groups]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpanded ? collapsibleKeys : []),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Nested group rows only exist after the group opens, so `expanded` is an
  // intentional trigger — without it the first click on a grouped tool would
  // try to scroll to a node that is not in the document yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expanded is an intentional post-mount trigger, not a value the effect reads.
  useEffect(() => {
    if (selectedKey === null) return;
    const node = document.getElementById(stepDomId(selectedKey));
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedKey, expanded]);

  if (steps.length === 0) {
    return <p className="trace-empty">本次运行没有可展示的轨迹步骤。</p>;
  }

  const origin = steps[0].at;
  const allExpanded = collapsibleKeys.length > 0 && collapsibleKeys.every((k) => expanded.has(k));

  const toggleEntry = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(collapsibleKeys));
    }
  };

  const focusEntry = (entryKeyToFocus: string) => {
    setSelectedKey(entryKeyToFocus);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(entryKeyToFocus);
      const group = groups.find((item) =>
        item.entries.some((entry) => entry.key === entryKeyToFocus),
      );
      if (group !== undefined && group.entries.length > 1) {
        next.add(groupExpandKey(group));
      }
      return next;
    });
  };

  return (
    <div className="trace-timeline-wrap">
      <div className="trace-timeline-toolbar">
        <span className="trace-timeline-toolbar__label">执行时序</span>
        <div className="trace-timeline-legend">
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#fde68a" }} />
            模型生成
          </span>
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#722ed1" }} />
            工具调用
          </span>
          <span className="trace-timeline-legend__item">
            <span className="trace-timeline-legend__swatch" style={{ background: "#13c2c2" }} />
            模型输出
          </span>
        </div>
        {collapsibleKeys.length > 0 ? (
          <Button type="link" size="small" onClick={toggleAll}>
            {allExpanded ? "全部收起" : "全部展开"}
          </Button>
        ) : null}
      </div>
      <TimingOverview groups={groups} selectedKey={selectedKey} onSelect={focusEntry} />
      <ol className="trace-timeline">
        {groups.map((group) => {
          const [entry] = group.entries;
          if (entry.step.kind === "STAGE") {
            return (
              <StageRow
                key={group.key}
                entry={entry}
                origin={origin}
                selected={selectedKey === entry.key}
              />
            );
          }
          if (group.entries.length > 1) {
            return (
              <ToolGroupRow
                key={group.key}
                group={group}
                origin={origin}
                groupExpanded={expanded.has(groupExpandKey(group))}
                expanded={expanded}
                selectedKey={selectedKey}
                onToggleGroup={() => toggleEntry(groupExpandKey(group))}
                onToggleEntry={toggleEntry}
              />
            );
          }
          return (
            <ToolOrMessageRow
              key={group.key}
              entry={entry}
              origin={origin}
              expanded={expanded.has(entry.key)}
              selected={selectedKey === entry.key}
              onToggle={() => toggleEntry(entry.key)}
            />
          );
        })}
      </ol>
    </div>
  );
}
