import {
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ReviewQueueItem } from "@contract-audit/api";
import type { ReviewPriority } from "@contract-audit/audit/ports";
import {
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Modal,
  Result,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import type { AuditTone } from "../audit-presentation";
import { shortAuditId } from "../audit-presentation";
import { readOperator, writeOperator } from "../operator";
import {
  filterReviewQueue,
  formatRemaining,
  priorityLabels,
  priorityTones,
  queueFilterOptions,
  type ReviewQueueFilter,
  remainingMs,
  reviewSeverityLabels,
  reviewSeverityTones,
  sortReviewQueue,
} from "../review-presentation";

export interface AssignRequest {
  assignee?: string | null;
  priority?: ReviewPriority;
}

export interface ReviewCenterProps {
  items: ReviewQueueItem[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  assigning: boolean;
  onOpen: (caseId: string) => void;
  onRefresh: () => void;
  onAssign: (caseIds: string[], input: AssignRequest) => void;
}

const toneColors: Record<AuditTone, string> = {
  neutral: "default",
  info: "blue",
  warning: "orange",
  danger: "red",
  success: "green",
};

export function ReviewCenter({
  items,
  loading,
  refreshing,
  error,
  assigning,
  onOpen,
  onRefresh,
  onAssign,
}: ReviewCenterProps) {
  const [operator, setOperator] = useState<string>(readOperator);
  const [filter, setFilter] = useState<ReviewQueueFilter>("ALL");
  const [search, setSearch] = useState("");
  // Rows are keyed by finding, but an assignment acts on the case behind it.
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");

  useEffect(() => {
    writeOperator(operator);
  }, [operator]);

  // A case's SLA clock keeps running while the page is open, so the countdown is
  // recomputed on render from the deadline rather than trusting the fetch-time
  // remainingMs. `now` is captured once per render for a stable list.
  const now = Date.now();
  const visibleItems = sortReviewQueue(filterReviewQueue(items, { filter, operator, search }, now));

  const selectedSet = new Set(selectedFindingIds);
  const selectedCaseIds = [
    ...new Set(items.filter((item) => selectedSet.has(item.findingId)).map((item) => item.caseId)),
  ];
  const initialLoading = loading && items.length === 0;
  const initialError = error !== null && items.length === 0 && !loading;

  const runAssign = (input: AssignRequest) => {
    onAssign(selectedCaseIds, input);
    setSelectedFindingIds([]);
  };

  const batchMenu = {
    items: [
      { key: "transfer", label: "批量转交" },
      {
        key: "priority",
        label: "批量设置优先级",
        children: [
          { key: "priority:high", label: "高优先级" },
          { key: "priority:normal", label: "中优先级" },
          { key: "priority:low", label: "低优先级" },
        ],
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "transfer") {
        setTransferTo("");
        setTransferOpen(true);
        return;
      }
      if (key.startsWith("priority:")) {
        runAssign({ priority: key.slice("priority:".length) as ReviewPriority });
      }
    },
  };

  const columns = [
    {
      title: "合同与发现",
      key: "finding",
      render: (_: unknown, record: ReviewQueueItem) => (
        <div className="table-primary">
          <span className="table-title" title={record.contractTitle}>
            {record.contractTitle}
          </span>
          <span className="table-sub" title={record.title}>
            {record.title}
            <span className="mono" style={{ marginLeft: 8, fontSize: 11 }}>
              {shortAuditId(record.caseId)}
            </span>
          </span>
        </div>
      ),
    },
    {
      title: "风险",
      key: "risk",
      width: 172,
      render: (_: unknown, record: ReviewQueueItem) => (
        <Space size={4} wrap>
          {record.severity !== null && (
            <Tag color={toneColors[reviewSeverityTones[record.severity]]}>
              {reviewSeverityLabels[record.severity]}
            </Tag>
          )}
          {record.evidenceConflict && (
            <Tag color="volcano" icon={<SafetyCertificateOutlined />}>
              证据冲突
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: "责任人",
      key: "assignee",
      width: 148,
      render: (_: unknown, record: ReviewQueueItem) => (
        <div>
          <div className="table-title" title={record.assignee ?? "未指派"}>
            {record.assignee ?? "未指派"}
          </div>
          {record.priority !== null && (
            <Tag color={toneColors[priorityTones[record.priority]]} style={{ marginTop: 4 }}>
              {priorityLabels[record.priority]}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: "剩余时间",
      key: "due",
      width: 148,
      render: (_: unknown, record: ReviewQueueItem) => {
        const remaining = formatRemaining(remainingMs(record, now));
        return (
          <Tooltip
            title={`截止 ${new Date(record.dueAt).toLocaleString("zh-CN", { hour12: false })}`}
          >
            <span className={remaining.overdue ? "review-due review-due--overdue" : "review-due"}>
              {remaining.overdue && <WarningOutlined aria-hidden="true" />} {remaining.label}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_: unknown, record: ReviewQueueItem) => (
        <Space size="small" onClick={(event) => event.stopPropagation()}>
          {record.assignee !== operator && (
            <Button
              size="small"
              loading={assigning && selectedSet.has(record.findingId)}
              onClick={() => onAssign([record.caseId], { assignee: operator })}
            >
              受理
            </Button>
          )}
          <Button size="small" onClick={() => onOpen(record.caseId)}>
            打开
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            复核中心
          </Typography.Title>
          <Typography.Text type="secondary">
            按 SLA 与风险排序；证据冲突优先于高风险但证据充分的事项。
          </Typography.Text>
        </div>
        <Space>
          <Input
            addonBefore="当前操作人"
            aria-label="当前操作人"
            value={operator}
            maxLength={32}
            style={{ width: 220 }}
            onChange={(event) => setOperator(event.target.value)}
          />
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      {initialLoading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Card>
      ) : initialError ? (
        <Result
          status="error"
          title="无法加载复核队列"
          subTitle={error?.message}
          extra={
            <Button type="primary" onClick={onRefresh}>
              重新加载
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <Card>
          <Empty description="暂无待复核事项" />
        </Card>
      ) : (
        <Card size="small" className="queue-table">
          <div className="queue-toolbar">
            <Input.Search
              className="queue-search"
              placeholder="搜索合同名称 / 发现 / 审计 ID"
              allowClear
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented
              options={[...queueFilterOptions]}
              value={filter}
              onChange={(value) => setFilter(value as ReviewQueueFilter)}
            />
          </div>

          {selectedFindingIds.length > 0 && (
            <div className="review-batch-toolbar">
              <span>已选 {selectedFindingIds.length} 项</span>
              <Space size="small">
                <Dropdown menu={batchMenu} trigger={["click"]}>
                  <Button icon={<SwapOutlined />}>批量操作</Button>
                </Dropdown>
                {/* Confirming a risk or calling a false positive stays a
                    per-finding decision: batch actions only route work. */}
                <Button type="text" onClick={() => setSelectedFindingIds([])}>
                  取消选择
                </Button>
              </Space>
            </div>
          )}

          {visibleItems.length === 0 ? (
            <Empty description="没有匹配的复核事项">
              <Space>
                <Button
                  onClick={() => {
                    setFilter("ALL");
                    setSearch("");
                  }}
                >
                  清除筛选
                </Button>
              </Space>
            </Empty>
          ) : (
            <Table<ReviewQueueItem>
              rowKey="findingId"
              dataSource={visibleItems}
              scroll={{ x: 860 }}
              rowSelection={{
                selectedRowKeys: selectedFindingIds,
                onChange: (keys) => setSelectedFindingIds(keys.map(String)),
              }}
              onRow={(record) => ({
                onClick: () => onOpen(record.caseId),
                style: { cursor: "pointer" },
              })}
              pagination={{
                pageSize: 20,
                hideOnSinglePage: true,
                showTotal: (total) => `共 ${total} 条`,
              }}
              columns={columns}
            />
          )}
        </Card>
      )}

      <Modal
        title="批量转交"
        open={transferOpen}
        okText="确认转交"
        cancelText="返回"
        confirmLoading={assigning}
        onCancel={() => setTransferOpen(false)}
        onOk={() => {
          runAssign({ assignee: transferTo.trim() === "" ? null : transferTo.trim() });
          setTransferOpen(false);
        }}
      >
        <p style={{ color: "#667085" }}>转交后事项将出现在对方队列中；留空表示退回共享队列。</p>
        <Input
          aria-label="转交责任人"
          placeholder="输入责任人姓名"
          value={transferTo}
          maxLength={32}
          onChange={(event) => setTransferTo(event.target.value)}
        />
      </Modal>
    </section>
  );
}
