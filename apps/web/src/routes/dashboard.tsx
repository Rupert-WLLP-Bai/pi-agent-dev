import { ArrowUpOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AuditOverview } from "@contract-audit/api";
import type { Severity } from "@contract-audit/audit/model";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  Col,
  Empty,
  Result,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuditOverview } from "../api";
import type { AuditLifecycleFilter } from "../audit-presentation";
import { getFindingTypeLabel, severityLabels } from "../audit-presentation";
import { TrendChart } from "../components/trend-chart";

const RANGE_OPTIONS = [
  { value: 7, label: "7 天" },
  { value: 14, label: "14 天" },
  { value: 30, label: "30 天" },
];

const PENDING_FILTERS: Array<{ value: Severity | "ALL"; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

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

/** Day label for a `YYYY-MM-DD` bucket key; an unrecognised key shows as-is. */
const formatDay = (value: string): string => {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value);
  return match === null ? value : `${Number(match[1])}月${Number(match[2])}日`;
};

const todoTagColors: Record<string, string> = {
  高风险: "#b91c1c",
  中风险: "#a16207",
  低风险: "#0B5C99",
  待复核: "#0B5C99",
};

interface Kpi {
  title: string;
  value: number | string;
  suffix: string;
  delta: string;
  up: boolean;
  color: string;
  /** Where a click lands, so every number has its records one click away. */
  to: "/audit-cases" | "/audit-runs";
  lifecycle?: AuditLifecycleFilter;
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [rangeDays, setRangeDays] = useState(30);
  const [pendingSeverity, setPendingSeverity] = useState<Severity | "ALL">("ALL");

  const load = useCallback(() => {
    setLoading(true);
    getAuditOverview()
      .then((data) => {
        setOverview(data);
        setUpdatedAt(new Date());
        setError(null);
      })
      .catch(() => setError("统计加载失败，请刷新重试"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: overview?.pendingReview.length ?? 0 };
    for (const item of overview?.pendingReview ?? []) {
      const key = item.highestSeverity ?? "NONE";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [overview]);

  if (error) {
    return (
      <div className="page">
        <Card>
          <Result
            status="error"
            title={error}
            extra={
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
                重试
              </Button>
            }
          />
        </Card>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
        <Spin />
      </div>
    );
  }

  const weeklyNew = overview.dailyCounts.slice(-7).reduce((sum, day) => sum + day.count, 0);
  // The running total is the window's own: switching to 7 days must show what
  // those 7 days accumulated, not the tail of a 30-day climb.
  let running = 0;
  const series = overview.dailyCounts.slice(-rangeDays).map((day) => {
    running += day.count;
    return { date: day.date, count: day.count, cumulative: running };
  });
  const riskTypes = [...overview.findingsByType].sort((left, right) => right.count - left.count);
  const riskTotal = overview.chainHeadFindings;
  const medianSeconds =
    overview.medianAgentDurationMs === null ? null : overview.medianAgentDurationMs / 1000;
  const reviewedTotal = overview.acceptedFindings + overview.rejectedFindings;

  const kpis: Kpi[] = [
    {
      title: "审计案件总量",
      value: overview.totalCases,
      suffix: "",
      delta: `近 7 天新增 ${weeklyNew} 件`,
      up: weeklyNew > 0,
      color: "#0B6BB5",
      to: "/audit-cases",
    },
    {
      title: "待复核案件",
      value: overview.awaitingReview,
      suffix: "",
      delta: "点击打开待复核队列",
      up: false,
      color: "#a16207",
      to: "/audit-cases",
      lifecycle: "AWAITING_REVIEW",
    },
    {
      title: "自动审查中位耗时",
      value: medianSeconds === null ? "—" : medianSeconds.toFixed(1),
      suffix: medianSeconds === null ? "" : " 秒",
      delta: `成功运行 ${overview.successfulAgentRuns} 次`,
      up: false,
      color: "#15803d",
      to: "/audit-runs",
    },
    {
      title: "已确认风险",
      value: overview.acceptedFindings,
      suffix: "",
      delta: `误报判定 ${overview.rejectedFindings} 条`,
      up: false,
      color: "#b91c1c",
      to: "/audit-cases",
      lifecycle: "COMPLETED",
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

  const visiblePending = overview.pendingReview.filter((item) =>
    pendingSeverity === "ALL" ? true : item.highestSeverity === pendingSeverity,
  );

  const kpiCard = (kpi: Kpi) => (
    <Card className="kpi-card" style={{ borderLeft: `3px solid ${kpi.color}` }}>
      <Statistic
        title={kpi.title}
        value={kpi.value}
        suffix={kpi.suffix}
        styles={{ content: { fontSize: 25, fontWeight: 680 } }}
      />
      <div className="kpi-hint">
        {kpi.up && <ArrowUpOutlined style={{ color: "#15803d", marginRight: 4 }} />}
        <span style={{ color: "#667085", fontSize: 12 }}>{kpi.delta}</span>
      </div>
    </Card>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            审计驾驶舱
          </Typography.Title>
          <Typography.Text type="secondary">
            处理规模、审查时效、待办积压和已确认风险，均来自当前数据库。点击任一指标可下钻到对应记录。
          </Typography.Text>
        </div>
        <div className="page-head-actions">
          {updatedAt !== null && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              更新于 {updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
            刷新
          </Button>
        </div>
      </div>

      <Row gutter={[12, 12]} className="dash-kpis">
        {kpis.map((kpi) => (
          <Col key={kpi.title} xs={24} sm={12} xl={6}>
            {kpi.to === "/audit-runs" ? (
              <Link className="kpi-link" to="/audit-runs">
                {kpiCard(kpi)}
              </Link>
            ) : (
              <Link className="kpi-link" to="/audit-cases" search={{ lifecycle: kpi.lifecycle }}>
                {kpiCard(kpi)}
              </Link>
            )}
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} className="dash-row">
        <Col xs={24} lg={15}>
          <Card
            className="dash-fill-card"
            title="审计处理趋势"
            size="small"
            extra={
              <Segmented
                size="small"
                value={rangeDays}
                options={RANGE_OPTIONS}
                onChange={(value) => setRangeDays(value as number)}
              />
            }
          >
            <TrendChart series={series} rangeLabel={`${rangeDays} 天`} formatDay={formatDay} />
            <div className="chart-legend">
              <span>
                <i className="chart-legend__line" />
                累计案件
              </span>
              <span>
                <i className="chart-legend__daily" />
                当日新增
              </span>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            className="dash-fill-card"
            title="风险发现类型"
            size="small"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                共 {riskTotal} 条
              </Typography.Text>
            }
          >
            {riskTotal === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无风险发现" />
            ) : (
              <div className="hbar-list">
                {riskTypes.map((item) => {
                  const pct = (item.count / riskTotal) * 100;
                  return (
                    <Tooltip
                      key={item.findingType}
                      title={`${getFindingTypeLabel(item.findingType)} · ${item.count} 条 · 占全部发现的 ${pct.toFixed(1)}%`}
                    >
                      <div className="hbar-row">
                        <span className="hbar-label">{getFindingTypeLabel(item.findingType)}</span>
                        <div className="hbar-track">
                          <div
                            className="hbar-fill"
                            style={{
                              width: `${Math.max(pct, 4)}%`,
                              background: pct > 60 ? "#C44A4A" : pct > 35 ? "#C58A20" : "#0B6BB5",
                            }}
                          />
                        </div>
                        <b className="hbar-value">{item.count}</b>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="dash-row">
        <Col xs={24} lg={15}>
          <Card className="dash-fill-card" title="质量指标" size="small">
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
          <Card
            className="dash-fill-card"
            title="待我处理"
            size="small"
            extra={
              <Space size={8}>
                <Segmented
                  size="small"
                  value={pendingSeverity}
                  options={PENDING_FILTERS.map((option) => ({
                    value: option.value,
                    label: `${option.label} ${pendingCounts[option.value] ?? 0}`,
                  }))}
                  onChange={(value) => setPendingSeverity(value as Severity | "ALL")}
                />
                <Link to="/reviews">去复核中心</Link>
              </Space>
            }
          >
            {visiblePending.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  overview.pendingReview.length === 0
                    ? "暂无待复核案件"
                    : "该严重级别下暂无待复核案件"
                }
              />
            ) : (
              <div className="todo-list">
                {visiblePending.map((item) => {
                  const tag =
                    item.highestSeverity === null ? "待复核" : severityLabels[item.highestSeverity];
                  const color = todoTagColors[tag] ?? "#0B5C99";
                  return (
                    <Link
                      key={item.id}
                      to="/audit-cases/$id"
                      params={{ id: item.id }}
                      search={{ origin: "reviews" }}
                      className="todo-item"
                    >
                      <b>{item.title ?? "未命名合同"}</b>
                      <span
                        className="todo-tag"
                        style={{ color, background: `${color}15`, border: `1px solid ${color}40` }}
                      >
                        {tag}
                      </span>
                      <time>{relativeTime(item.updatedAt)}</time>
                    </Link>
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
