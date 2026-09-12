import { useEffect, useState } from "react";
import { Card, Col, Empty, Row, Spin, Statistic, Tooltip, Typography } from "antd";
import { ArrowUpOutlined } from "@ant-design/icons";
import { getAuditOverview } from "../api";
import { getFindingTypeLabel, severityLabels } from "../audit-presentation";
import type { AuditOverview } from "@contract-audit/api";

const CHART_WIDTH = 620;
const CHART_HEIGHT = 160;

interface ChartPaths {
  dailyLine: string;
  totalLine: string;
  area: string;
}

/** Maps the 30-day series into SVG polyline points inside the chart box. */
function buildChartPaths(dailyCounts: Array<{ count: number }>): ChartPaths {
  if (dailyCounts.length === 0) {
    return { dailyLine: "", totalLine: "", area: "" };
  }
  const step = CHART_WIDTH / Math.max(dailyCounts.length - 1, 1);
  const cumulative: number[] = [];
  let running = 0;
  for (const day of dailyCounts) {
    running += day.count;
    cumulative.push(running);
  }
  const peak = Math.max(1, ...cumulative);
  const dailyPoints: string[] = [];
  const totalPoints: string[] = [];
  for (let index = 0; index < dailyCounts.length; index += 1) {
    const x = (index * step).toFixed(1);
    const dailyY = (CHART_HEIGHT - (dailyCounts[index].count / peak) * (CHART_HEIGHT - 12)).toFixed(1);
    const totalY = (CHART_HEIGHT - (cumulative[index] / peak) * (CHART_HEIGHT - 12)).toFixed(1);
    dailyPoints.push(`${x},${dailyY}`);
    totalPoints.push(`${x},${totalY}`);
  }
  return {
    dailyLine: dailyPoints.join(" "),
    totalLine: totalPoints.join(" "),
    area: `0,${CHART_HEIGHT} ${totalPoints.join(" ")} ${CHART_WIDTH},${CHART_HEIGHT}`,
  };
}

const relativeTime = (value: string): string => {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
};

/** Ratio as a percentage, or an explicit "no data" before the denominator exists. */
const percentOf = (part: number, total: number): string => {
  if (total === 0) return "暂无数据";
  return `${((part / total) * 100).toFixed(1)}%`;
};

const todoTagColors: Record<string, string> = {
  "高风险": "#b91c1c",
  "中风险": "#a16207",
  "低风险": "#0B5C99",
  "待复核": "#0B5C99",
};

export default function DashboardPage() {
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuditOverview()
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setError("统计加载失败，请刷新重试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="dashboard-page">
        <Card>
          <Empty description={error} />
        </Card>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="dashboard-page" style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
        <Spin />
      </div>
    );
  }

  const weeklyNew = overview.dailyCounts.slice(-7).reduce((sum, day) => sum + day.count, 0);
  const paths = buildChartPaths(overview.dailyCounts);
  const riskTypes = [...overview.findingsByType].sort((left, right) => right.count - left.count);
  const riskTotal = overview.chainHeadFindings;
  const medianSeconds = overview.medianAgentDurationMs === null
    ? null
    : overview.medianAgentDurationMs / 1000;
  const reviewedTotal = overview.acceptedFindings + overview.rejectedFindings;

  const kpis = [
    {
      title: "审计案件总量",
      value: overview.totalCases,
      suffix: "",
      delta: `近 7 天新增 ${weeklyNew} 件`,
      up: weeklyNew > 0,
      color: "#0B6BB5",
    },
    {
      title: "待复核案件",
      value: overview.awaitingReview,
      suffix: "",
      delta: "等待人工闭环",
      up: false,
      color: "#a16207",
    },
    {
      title: "自动审查中位耗时",
      value: medianSeconds === null ? "—" : medianSeconds.toFixed(1),
      suffix: medianSeconds === null ? "" : " 秒",
      delta: `成功运行 ${overview.successfulAgentRuns} 次`,
      up: false,
      color: "#15803d",
    },
    {
      title: "已确认风险",
      value: overview.acceptedFindings,
      suffix: "",
      delta: `误报判定 ${overview.rejectedFindings} 条`,
      up: false,
      color: "#b91c1c",
    },
  ];

  const qualityMetrics = [
    {
      label: "风险确认率",
      value: percentOf(overview.acceptedFindings, reviewedTotal),
      note: "人工复核确认为风险的比例：确认 ÷（确认 + 误报）",
    },
    {
      label: "自动审查完成率",
      value: percentOf(overview.reachedReview, overview.totalCases),
      note: "已进入人工复核或完成闭环的案件占比",
    },
    {
      label: "证据引用率",
      value: percentOf(overview.citedFindings, overview.chainHeadFindings),
      note: "当前发现中至少引用一条证据的比例，衡量结论可溯源程度",
    },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>审计驾驶舱</Typography.Title>
          <Typography.Text type="secondary">处理规模、审查时效、待办积压和已确认风险，均来自当前数据库。</Typography.Text>
        </div>
      </div>

      <Row gutter={[12, 12]} className="dash-kpis">
        {kpis.map((kpi) => (
          <Col key={kpi.title} xs={24} sm={12} xl={6}>
            <Card className="kpi-card" style={{ borderLeft: `3px solid ${kpi.color}` }}>
              <Statistic
                title={kpi.title}
                value={kpi.value}
                suffix={kpi.suffix}
                valueStyle={{ fontSize: 25, fontWeight: 680 }}
              />
              <div className="kpi-hint">
                {kpi.up && <ArrowUpOutlined style={{ color: "#15803d", marginRight: 4 }} />}
                <span style={{ color: "#667085", fontSize: 12 }}>{kpi.delta}</span>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={15}>
          <Card title="审计处理趋势" size="small" extra={<Typography.Text type="secondary" style={{ fontSize: 11 }}>近 30 天</Typography.Text>}>
            <div className="line-chart-placeholder">
              <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" style={{ width: "100%", height: CHART_HEIGHT }}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0B6BB5" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#0B6BB5" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon points={paths.area} fill="url(#grad1)" />
                <polyline points={paths.totalLine} fill="none" stroke="#0B6BB5" strokeWidth="2.5" />
                <polyline points={paths.dailyLine} fill="none" stroke="#C57A00" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
            </div>
            <div className="chart-legend">
              <span><i style={{ background: "#0B6BB5" }} />累计案件</span>
              <span><i style={{ background: "#C57A00" }} />当日新增</span>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="风险发现类型" size="small" extra={<Typography.Text type="secondary" style={{ fontSize: 11 }}>按数量降序</Typography.Text>}>
            {riskTotal === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无风险发现" />
            ) : (
              <div className="hbar-list">
                {riskTypes.map((item) => {
                  const pct = (item.count / riskTotal) * 100;
                  return (
                    <div key={item.findingType} className="hbar-row">
                      <span className="hbar-label">{getFindingTypeLabel(item.findingType)}</span>
                      <div className="hbar-track">
                        <div className="hbar-fill" style={{ width: `${Math.max(pct, 4)}%`, background: pct > 60 ? "#C44A4A" : pct > 35 ? "#C58A20" : "#0B6BB5" }} />
                      </div>
                      <b className="hbar-value">{item.count}</b>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} lg={15}>
          <Card title="质量指标" size="small">
            <Row gutter={10}>
              {qualityMetrics.map((metric) => (
                <Col key={metric.label} flex={1}>
                  <Tooltip title={metric.note}>
                    <div className="quality-item">
                      <b>{metric.value}</b>
                      <span>{metric.label}</span>
                    </div>
                  </Tooltip>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="待我处理" size="small">
            {overview.pendingReview.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待复核案件" />
            ) : (
              <div className="todo-list">
                {overview.pendingReview.map((item) => {
                  const tag = item.highestSeverity === null ? "待复核" : severityLabels[item.highestSeverity];
                  const color = todoTagColors[tag] ?? "#0B5C99";
                  return (
                    <div key={item.id} className="todo-item">
                      <b>{item.title ?? "未命名合同"}</b>
                      <span className="todo-tag" style={{ color, background: `${color}15`, border: `1px solid ${color}40` }}>{tag}</span>
                      <time>{relativeTime(item.updatedAt)}</time>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
