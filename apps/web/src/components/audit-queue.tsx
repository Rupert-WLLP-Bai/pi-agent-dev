import { useMemo, useState } from "react";
import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Result,
  Segmented,
  Skeleton,
  Space,
  Table,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AuditCase } from "@contract-audit/audit/model";
import {
  deriveQueueStats,
  filterAndSortCases,
  getAuditStageLabel,
  getAvailableCaseActions,
  shortAuditId,
  type AuditLifecycleFilter,
} from "../audit-presentation";
import { useMediaQuery } from "../hooks/use-media-query";
import { AuditStateBadge } from "./audit-state-badge";

export interface AuditQueueProps {
  cases: AuditCase[];
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

// Short label for UUID-style IDs; already-short IDs (fixtures, slugs) render in full.
const recordLabel = (id: string): string => `合同审计 ${shortAuditId(id)}`;

interface RecordActionProps {
  auditCase: AuditCase;
  action: AuditQueueProps["action"];
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

function RecordActions({ auditCase, action, onOpen, onCancel, onRetry }: RecordActionProps) {
  const allowed = getAvailableCaseActions(auditCase);
  const cancelling = action?.id === auditCase.id && action.type === "CANCEL";
  const retrying = action?.id === auditCase.id && action.type === "RETRY";
  return (
    <Space size="small" wrap>
      <Button size="small" onClick={() => onOpen(auditCase.id)}>查看</Button>
      {allowed.includes("CANCEL") && (
        <Popconfirm
          title="取消该审计？"
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
          title="重试该审计？"
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

interface RecordItemProps extends RecordActionProps {
  onOpen: (id: string) => void;
}

function AuditRecordItem({ auditCase, action, onOpen, onCancel, onRetry }: RecordItemProps) {
  return (
    <li className="audit-record">
      <div className="audit-record__head">
        <Button type="link" className="queue-record-link" onClick={() => onOpen(auditCase.id)}>
          {recordLabel(auditCase.id)}
        </Button>
        <AuditStateBadge auditCase={auditCase} />
      </div>
      <dl className="audit-record__meta">
        <div>
          <dt>阶段</dt>
          <dd>{getAuditStageLabel(auditCase.stage)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatTimestamp(auditCase.updatedAt)}</dd>
        </div>
      </dl>
      <RecordActions
        auditCase={auditCase}
        action={action}
        onOpen={onOpen}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    </li>
  );
}

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
  const isMobile = useMediaQuery("(max-width: 767px)");

  const stats = useMemo(() => deriveQueueStats(cases), [cases]);
  const filteredCases = useMemo(
    () => filterAndSortCases(cases, filter, search),
    [cases, filter, search],
  );

  const initialLoading = loading && cases.length === 0;
  const initialError = error !== null && cases.length === 0 && !loading;
  const summary: Array<{ key: string; label: string; value: number }> = [
    { key: "awaiting-review", label: "待复核", value: stats.awaitingReview },
    { key: "processing", label: "处理中", value: stats.processing },
    { key: "abnormal", label: "异常", value: stats.abnormal },
    { key: "completed-today", label: "今日完成", value: stats.completedToday },
  ];

  return (
    <section className="queue">
      <div className="queue-header">
        <div>
          <Typography.Title level={2} className="queue-title">审计队列</Typography.Title>
          <Typography.Text type="secondary">
            按最近更新排序，优先处理待复核与异常审计。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined aria-hidden="true" />} loading={refreshing} onClick={onRefresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={onCreate}>
            新建审计
          </Button>
        </Space>
      </div>
      <p className="queue-refreshed" role="status" aria-live="polite">
        最近更新：{refreshedAt ? formatTimestamp(refreshedAt) : "尚未加载"}
      </p>

      <div className="queue-summary">
        {summary.map((item) => (
          <div key={item.key} className="queue-summary__item">
            <span className="queue-summary__value">{item.value}</span>
            <span className="queue-summary__label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="queue-surface">
        {initialLoading ? (
          <div className="queue-skeleton" aria-busy="true">
            <Skeleton active title={false} paragraph={{ rows: 5 }} />
          </div>
        ) : initialError ? (
          <Result
            status="error"
            title="无法加载审计队列"
            subTitle={error?.message}
            extra={<Button type="primary" onClick={onRefresh}>重新加载</Button>}
          />
        ) : cases.length === 0 ? (
          <Empty description="暂无审计记录">
            <Button type="primary" onClick={onCreate}>新建审计</Button>
          </Empty>
        ) : (
          <>
            <div className="queue-toolbar">
              <Input
                className="queue-search"
                placeholder="搜索任务 ID"
                allowClear
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Segmented
                options={lifecycleOptions}
                value={filter}
                onChange={(value) => setFilter(value as AuditLifecycleFilter)}
              />
            </div>
            {filteredCases.length === 0 ? (
              <Empty description="没有匹配的审计记录" />
            ) : isMobile ? (
              <ul className="audit-records-mobile" aria-label="审计记录">
                {filteredCases.map((auditCase) => (
                  <AuditRecordItem
                    key={auditCase.id}
                    auditCase={auditCase}
                    action={action}
                    onOpen={onOpen}
                    onCancel={onCancel}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
            ) : (
              <Table<AuditCase>
                className="queue-table"
                rowKey="id"
                dataSource={filteredCases}
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                columns={[
                  {
                    title: "审计任务",
                    dataIndex: "id",
                    render: (id: string, record) => (
                      <Button
                        type="link"
                        className="queue-record-link"
                        onClick={() => onOpen(record.id)}
                      >
                        {recordLabel(id)}
                      </Button>
                    ),
                  },
                  {
                    title: "状态",
                    key: "state",
                    render: (_, record) => <AuditStateBadge auditCase={record} />,
                  },
                  {
                    title: "阶段",
                    dataIndex: "stage",
                    render: (stage: AuditCase["stage"]) => getAuditStageLabel(stage),
                  },
                  {
                    title: "创建时间",
                    dataIndex: "createdAt",
                    render: (value: string) => formatTimestamp(value),
                  },
                  {
                    title: "更新时间",
                    dataIndex: "updatedAt",
                    render: (value: string) => formatTimestamp(value),
                  },
                  {
                    title: "操作",
                    key: "actions",
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
          </>
        )}
      </div>
    </section>
  );
}
