import { useEffect, useRef, useState } from "react";

export interface TrendDatum {
  date: string;
  count: number;
  cumulative: number;
}

interface Point {
  x: number;
  y: number;
}

const PAD = { top: 14, right: 14, bottom: 26, left: 46 };

/**
 * Monotone cubic interpolation (Fritsch–Carlson). A plain Catmull-Rom spline
 * overshoots between points, drawing a bulge the data never had; this stays
 * inside each segment's own range, so a flat stretch stays flat.
 */
export function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const deltaX = points[i + 1].x - points[i].x;
    dx.push(deltaX);
    slope.push(deltaX === 0 ? 0 : (points[i + 1].y - points[i].y) / deltaX);
  }

  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      // A local extremum: a zero tangent keeps the curve from overshooting it.
      tangent.push(0);
      continue;
    }
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    tangent.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
  }
  tangent.push(slope[n - 2]);

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c1x = points[i].x + dx[i] / 3;
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
    d +=
      ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)},` +
      ` ${c2x.toFixed(2)} ${c2y.toFixed(2)},` +
      ` ${points[i + 1].x.toFixed(2)} ${points[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/**
 * Axis values from zero to a round top, so the gridline labels read as whole
 * numbers instead of fractions of the peak.
 */
export function axisTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rawStep = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  return ticks;
}

/**
 * Daily volume and running total over one window, as two smoothed lines. Both
 * share one value axis: a second axis would let the pairing imply a
 * relationship the numbers do not support.
 */
export function TrendChart({
  series,
  rangeLabel,
  formatDay,
}: {
  series: TrendDatum[];
  rangeLabel: string;
  formatDay: (date: string) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ticks = axisTicks(Math.max(...series.map((d) => d.cumulative), 0));
  const topValue = ticks[ticks.length - 1] ?? 1;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = 168;
  const height = plotH + PAD.top + PAD.bottom;
  const stepX = series.length > 1 ? plotW / (series.length - 1) : 0;

  const xAt = (index: number) => PAD.left + index * stepX;
  const yAt = (value: number) => PAD.top + plotH - (value / topValue) * plotH;

  const points = series.map((datum, index) => ({ x: xAt(index), y: yAt(datum.cumulative) }));
  const linePath = monotonePath(points);
  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${PAD.top + plotH} L ${points[0].x.toFixed(2)} ${PAD.top + plotH} Z`;

  const dailyPath = monotonePath(
    series.map((datum, index) => ({ x: xAt(index), y: yAt(datum.count) })),
  );
  const hasActivity = series.some((datum) => datum.count > 0);
  const hovered = hover === null ? null : (series[hover] ?? null);
  const hoverX = hover === null ? 0 : xAt(hover);
  const labelIndexes =
    series.length <= 1 ? [0] : [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <div className="trend-chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`近 ${rangeLabel} 每日新增与累计案件趋势`}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const max = series.length - 1;
            if (box.width === 0 || max < 0) return;
            const ratio = (event.clientX - box.left - PAD.left) / plotW;
            setHover(Math.max(0, Math.min(max, Math.round(ratio * max))));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Gridlines sit behind the data and carry the value labels. */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke={tick === 0 ? "#cbd5e1" : "#eef2f7"}
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yAt(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="trend-chart__axis-label"
              >
                {tick}
              </text>
            </g>
          ))}

          <defs>
            <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0B6BB5" stopOpacity="0.28" />
              <stop offset="70%" stopColor="#0B6BB5" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#0B6BB5" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g className="trend-chart__series">
            <path d={areaPath} fill="url(#trend-area)" />
            <path
              d={dailyPath}
              fill="none"
              stroke="#E39A2B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={linePath}
              fill="none"
              stroke="#0B6BB5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {hovered !== null && (
              <>
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={hoverX}
                  cy={yAt(hovered.cumulative)}
                  r="4.5"
                  fill="#fff"
                  stroke="#0B6BB5"
                  strokeWidth="2.5"
                />
                <circle
                  cx={hoverX}
                  cy={yAt(hovered.count)}
                  r="3.5"
                  fill="#fff"
                  stroke="#E39A2B"
                  strokeWidth="2"
                />
              </>
            )}
          </g>

          {labelIndexes.map((index) => (
            <text
              key={index}
              x={xAt(index)}
              y={height - 8}
              textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"}
              className="trend-chart__axis-label"
            >
              {series[index] === undefined ? "" : formatDay(series[index].date)}
            </text>
          ))}

          {!hasActivity && (
            <text
              x={PAD.left + plotW / 2}
              y={PAD.top + plotH / 2}
              textAnchor="middle"
              className="trend-chart__empty"
            >
              近 {rangeLabel}没有新增案件
            </text>
          )}
        </svg>
      )}

      {hovered !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(92, Math.max(8, (hoverX / Math.max(width, 1)) * 100))}%`,
          }}
        >
          <b>{formatDay(hovered.date)}</b>
          <span>当日新增 {hovered.count}</span>
          <span>累计 {hovered.cumulative}</span>
        </div>
      )}
    </div>
  );
}
