import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { RuleListItem } from "@contract-audit/api";
import { Alert, Button, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ALL_RULE_STATUSES,
  contractTypeOptions,
  describeLastValidation,
  filterRules,
  type RuleFilters,
  ruleVersionStatusLabels,
  ruleVersionStatusTagColors,
} from "../rule-presentation";

export interface RuleTableProps {
  rules: RuleListItem[];
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  filters: RuleFilters;
  onFiltersChange: (filters: RuleFilters) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
}

const toneColor: Record<"success" | "error" | "none", string | undefined> = {
  success: "#12692F",
  error: "#A51F1F",
  none: undefined,
};

/**
 * The 规则管理 table. Columns are fixed by the design: a rule's identity, the
 * version currently in force, whether it has been validated, and who published
 * it — never a status that only the version means.
 */
export function RuleTable({
  rules,
  loading,
  refreshing,
  error,
  filters,
  onFiltersChange,
  onRefresh,
  onCreate,
  onOpen,
}: RuleTableProps) {
  const filtered = filterRules(rules, filters);

  const columns: ColumnsType<RuleListItem> = [
    {
      title: "规则名",
      key: "name",
      render: (_value, record) => (
        <div className="table-primary">
          <span className="table-title">{record.name}</span>
          <span className="table-sub">{record.description || "—"}</span>
        </div>
      ),
    },
    {
      title: "规则代码",
      dataIndex: "code",
      width: 210,
      render: (value: string) => <span className="mono">{value}</span>,
    },
    {
      title: "适用合同类型",
      dataIndex: "contractType",
      width: 130,
    },
    {
      title: "当前版本",
      key: "currentVersion",
      width: 100,
      render: (_value, record) =>
        record.currentVersion === null ? (
          "—"
        ) : (
          <span className="mono">v{record.currentVersion}</span>
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_value, record) =>
        record.status === null ? (
          "—"
        ) : (
          <Tag color={ruleVersionStatusTagColors[record.status]}>
            {ruleVersionStatusLabels[record.status]}
          </Tag>
        ),
    },
    {
      title: "最近验证",
      key: "lastValidation",
      width: 190,
      render: (_value, record) => {
        const validation = describeLastValidation(record);
        return <span style={{ color: toneColor[validation.tone] }}>{validation.text}</span>;
      },
    },
    {
      title: "发布人",
      key: "publishedBy",
      width: 120,
      render: (_value, record) => record.publishedBy ?? "—",
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_value, record) => (
        <Button type="link" size="small" onClick={() => onOpen(record.id)}>
          打开
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            规则管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理确定性审查规则及其版本；发布前必须通过案例验证。
          </Typography.Text>
        </div>
        <Space className="page-head-actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={refreshing}
            aria-label="刷新"
          >
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新建规则
          </Button>
        </Space>
      </div>

      <Space className="queue-toolbar" wrap>
        <Input
          className="queue-search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索规则名 / 规则代码"
          aria-label="搜索规则名 / 规则代码"
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        />
        <Select
          value={filters.status}
          style={{ width: 140 }}
          aria-label="状态"
          onChange={(status) => onFiltersChange({ ...filters, status })}
          options={ALL_RULE_STATUSES.map((status) => ({
            value: status,
            label: status === "ALL" ? "全部状态" : ruleVersionStatusLabels[status],
          }))}
        />
        <Select
          value={filters.contractType}
          style={{ width: 160 }}
          aria-label="合同类型"
          onChange={(contractType) => onFiltersChange({ ...filters, contractType })}
          options={contractTypeOptions(rules).map((type) => ({ value: type, label: type }))}
        />
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="无法加载规则列表"
          description={error.message}
          action={<Button onClick={onRefresh}>重试</Button>}
        />
      ) : (
        <Table<RuleListItem>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          scroll={{ x: "max-content" }}
          pagination={false}
          onRow={(record) => ({
            onClick: () => onOpen(record.id),
            style: { cursor: "pointer" },
          })}
          locale={{ emptyText: <Empty description="暂无规则" /> }}
        />
      )}
    </div>
  );
}
