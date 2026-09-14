import { InfoCircleOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { tokenUsageBreakdown } from "../audit-presentation";

const format = (value: number): string => value.toLocaleString("en-US");

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span className="token-usage__row">
      <span className="token-usage__row-label">{label}</span>
      <span className="token-usage__row-value">{value}</span>
    </span>
  );
}

/**
 * A run's token spend as one line — prompt in, completion out, cache share —
 * with the full breakdown behind the info affordance. The tooltip hangs off the
 * whole readout rather than the icon alone, so the hover target is the text a
 * reader is already looking at.
 */
export function TokenUsage({ usage }: { usage: Record<string, number> | null }) {
  const breakdown = tokenUsageBreakdown(usage);
  if (breakdown === null) return <span className="token-usage token-usage--empty">-</span>;

  const { input, output, total, cacheRead, cacheWrite, cacheRate } = breakdown;
  const cache = `${(cacheRate ?? 0).toFixed(2)}%缓存`;

  const details = (
    <span className="token-usage__details">
      <Detail label="输入（含缓存）" value={format(input)} />
      <Detail label="输出" value={format(output)} />
      <Detail label="合计" value={format(total)} />
      <Detail label="缓存读" value={format(cacheRead)} />
      <Detail label="缓存写" value={format(cacheWrite)} />
      <Detail label="缓存命中率" value={`${(cacheRate ?? 0).toFixed(2)}%`} />
    </span>
  );

  return (
    <Tooltip title={details} placement="top" rootClassName="token-usage-tip">
      <span className="token-usage">
        <span className="token-usage__part token-usage__part--in">
          {format(input)}
          <span aria-hidden="true">↑</span>
        </span>
        <span className="token-usage__part token-usage__part--out">
          {format(output)}
          <span aria-hidden="true">↓</span>
        </span>
        <span
          className={
            cacheRead > 0 ? "token-usage__cache token-usage__cache--hit" : "token-usage__cache"
          }
        >
          {cache}
        </span>
        <InfoCircleOutlined className="token-usage__info" aria-hidden="true" />
        {/* The breakdown is a hover affordance; state it outright for readers
            that never see the tooltip. */}
        <span className="sr-only">
          输入 {format(input)}，输出 {format(output)}，{cache}，合计 {format(total)} token
        </span>
      </span>
    </Tooltip>
  );
}
