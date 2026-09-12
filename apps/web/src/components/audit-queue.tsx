import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Result,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import {
  CopyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import type { AuditCase } from "@contract-audit/audit/model";
import {
  deriveQueueStats,
  filterAndSortCases,
  getAuditStageLabel,
  getAvailableCaseActions,
  shortAuditId,
  subjectRedLineLabel,
  type AuditLifecycleFilter,
} from "../audit-presentation";
import { AuditStateBadge } from "./audit-state-badge";

export interface AuditQueueCase extends AuditCase {
  contractTitle?: string | null;
  findingCount?: number;
  highestSeverity?: "LOW" | "MEDIUM" | "HIGH" | null;
  /** Optional so list rows predating the subject-risk aggregate still render. */
  subjectRedLineCount?: number;
}

export interface AuditQueueProps {
  cases: AuditQueueCase[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  action: { id: string; type: "CANCEL" | "RETRY" } | null;
  refreshedAt: Date | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onCreate: () => void;
}

const lifecycleOptions: Array<{ value: AuditLifecycleFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "AWAITING_REVIEW", label: "待复核" },
  { value: "PROCESSING", label: "处理中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "CANCELLED", label: "已取消" },
  { value: "ABNORMAL", label: "异常" },
];

const formatTimestamp = (value: string | Date): string =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

const relativeTime = (value: string | Date): string => {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatTimestamp(value);
};

function RecordActions({
  auditCase,
  action,
  onOpen,
  onCancel,
  onRetry,
}: {
  auditCase: AuditQueueCase;
  action: AuditQueueProps["action"];
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const allowed = getAvailableCaseActions(auditCase);
  const cancelling = action?.id === auditCase.id && action.type === "CANCEL";
  const retrying = action?.id === auditCase.id && action.type === "RETRY";
  return (
    <Space size="small">
      <Button size="small" onClick={() => onOpen(auditCase.id)}>打开</Button>
      {allowed.includes("CANCEL") && (
        <Popconfirm
          title="取消该审计案件？"
          description="已完成的审计工作不会回滚。"
          okText="确认取消"
          cancelText="返回"
          okButtonProps={{ danger: true }}
          onConfirm={() => onCancel(auditCase.id)}
        >
          <Button size="small" danger loading={cancelling}>取消</Button>
        </Popconfirm>
      )}
      {allowed.includes("RETRY") && (
        <Popconfirm
          title="重试该审计案件？"
          description="将重新排队并从头执行审计。"
          okText="确认重试"
          cancelText="返回"
          onConfirm={() => onRetry(auditCase.id)}
        >
          <Button size="small" loading={retrying}>重试</Button>
        </Popconfirm>
      )}
    </Space>
  );
}

const summaryIcons: Record<string, React.ReactNode> = {
  "待复核": <WarningOutlined />,
  "处理中": <ClockCircleOutlined />,
  "异常": <ExclamationCircleOutlined />,
  "今日完成": <CheckCircleOutlined />,
};

export function AuditQueue({
  cases,
  loading,
  refreshing,
  error,
  action,
  refreshedAt,
  onOpen,
  onRefresh,
  onCancel,
  onRetry,
  onCreate,
}: AuditQueueProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AuditLifecycleFilter>("ALL");

  const stats = useMemo(() => deriveQueueStats(cases), [cases]);
  const filteredCases = useMemo(
    () => filterAndSortCases(cases, filter, search),
    [cases, filter, search],
  );

  const initialLoading = loading && cases.length === 0;
  const initialError = error !== null && cases.length === 0 && !loading;

  const summaryCards = [
    { key: "awaiting-review", label: "待复核", value: stats.awaitingReview, cls: "warn" },
    { key: "processing", label: "处理中", value: stats.processing, cls: "info" },
    { key: "abnormal", label: "异常", value: stats.abnormal, cls: "danger" },
    { key: "completed-today", label: "今日完成", value: stats.completedToday, cls: "success" },
  ];

  return (
    <section className="queue-page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>审计队列</Typography.Title>
          <Typography.Text type="secondary">按最近更新排序，优先处理待复核、异常和未闭环高风险案件。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新建审计</Button>
        </Space>
      </div>

      <div className="queue-summary">
        {summaryCards.map((item) => (
          <Card key={item.key} className={`queue-summary-card ${item.cls}`} size="small">
            <div>
              <b className="tnum">{item.value}</b>
              <span>{item.label}</span>
            </div>
            <span className="queue-summary-icon">{summaryIcons[item.label]}</span>
          </Card>
        ))}
      </div>

      {initialLoading ? (
        <Card><Skeleton active paragraph={{ rows: 5 }} /></Card>
      ) : initialError ? (
        <Result
          status="error"
          title="无法加载审计队列"
          subTitle={error?.message}
          extra={<Button type="primary" onClick={onRefresh}>重新加载</Button>}
        />
      ) : cases.length === 0 ? (
        <Card>
          <Empty description="暂无审计记录">
            <Button type="primary" onClick={onCreate}>新建审计</Button>
          </Empty>
        </Card>
      ) : (
        <Card size="small" className="queue-table">
          <div className="queue-toolbar">
            <Input.Search
              className="queue-search"
              placeholder="搜索合同名称 / 审计 ID / 来源记录 ID"
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Segmented
              options={lifecycleOptions}
              value={filter}
              onChange={(value) => setFilter(value as AuditLifecycleFilter)}
            />
          </div>
          {filteredCases.length === 0 ? (
            <Empty description="没有匹配的审计记录" />
          ) : (
            <Table<AuditQueueCase>
              rowKey="id"
              dataSource={filteredCases}
              scroll={{ x: 968 }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              columns={[
                {
                  title: "合同",
                  key: "contract",
                  render: (_, record) => (
                    <div>
                      <div className="contract-title">
                        {record.contractTitle ?? "未命名合同"}
                      </div>
                      <div className="contract-sub">
                        {record.contractTitle ? `来源 · ${record.sourceRecordId.slice(0, 8)}…` : "需要设置合同名称"}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "审计 ID",
                  key: "id",
                  width: 160,
                  render: (_, record) => (
                    <div className="id-line">
                      <span className="mono" style={{ fontSize: 12 }}>{shortAuditId(record.id)}</span>
                      <Tooltip title="复制审计 ID">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          aria-label="复制审计 ID"
                          onClick={() => void navigator.clipboard.writeText(record.id)}
                        />
                      </Tooltip>
                    </div>
                  ),
                },
                {
                  title: "风险",
                  key: "risk",
                  width: 118,
                  render: (_, record) => {
                    const severity = record.highestSeverity ?? null;
                    const count = record.findingCount ?? 0;
                    const subjectCount = record.subjectRedLineCount ?? 0;
                    return (
                      <div className="risk-stack">
                        {severity !== null && count > 0 ? (
                          <span className={`risk-cell risk-${severity === "HIGH" ? "high" : severity === "MEDIUM" ? "medium" : "low"}`}>
                            <span className="risk-dot" />
                            {severity === "HIGH" ? "高" : severity === "MEDIUM" ? "中" : "低"} · {count}
                          </span>
                        ) : (
                          <span style={{ color: "#98A2B3" }}>—</span>
                        )}
                        {subjectCount > 0 && (
                          <span className="risk-cell risk-subject">
                            <SafetyCertificateOutlined className="risk-subject-icon" />
                            {subjectRedLineLabel} · {subjectCount}
                          </span>
                        )}
                      </div>
                    );
                  },
                },
                {
                  title: "状态 / 阶段",
                  key: "state",
                  width: 140,
                  render: (_, record) => (
                    <div>
                      <AuditStateBadge auditCase={record} />
                      <div className="contract-sub">{getAuditStageLabel(record.stage)}</div>
                    </div>
                  ),
                },
                {
                  title: "更新时间",
                  key: "updated",
                  width: 140,
                  render: (_, record) => (
                    <div>
                      <div>{relativeTime(record.updatedAt)}</div>
                      <div className="contract-sub">{formatTimestamp(record.updatedAt)}</div>
                    </div>
                  ),
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 140,
                  render: (_, record) => (
                    <RecordActions
                      auditCase={record}
                      action={action}
                      onOpen={onOpen}
                      onCancel={onCancel}
                      onRetry={onRetry}
                    />
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}
    </section>
  );
}
