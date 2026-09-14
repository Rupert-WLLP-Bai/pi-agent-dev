import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { RuleListItem } from "@contract-audit/api";
import {
  Alert,
  App as AntApp,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";
import {
  ALL_RULE_STATUSES,
  contractTypeOptions,
  describeLastValidation,
  filterRules,
  type RuleFilters,
  ruleRuntimeLabels,
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
  /** Stops a rule; the operator-supplied reason is recorded with the actor. */
  onDisable: (id: string, reason: string) => void;
  /** Puts a stopped rule back in rotation. */
  onEnable: (id: string) => void;
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
  onDisable,
  onEnable,
}: RuleTableProps) {
  const { modal, message } = AntApp.useApp();
  const filtered = filterRules(rules, filters);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(480);

  useEffect(() => {
    if (error) return;
    const host = tableHostRef.current;
    if (!host) return;
    const update = () => setTableScrollY(Math.max(host.clientHeight - 55, 160));
    const observer = new ResizeObserver(update);
    observer.observe(host);
    update();
    return () => observer.disconnect();
  }, [error]);

  /**
   * Stopping a rule is destructive to the next audit's coverage, so the reason
   * is required and confirmed rather than fired on the toggle alone. Returning
   * a rejected promise keeps the dialog open until a reason is entered.
   */
  const confirmDisable = (record: RuleListItem) => {
    let reason = "";
    modal.confirm({
      title: `停用规则「${record.name}」`,
      content: (
        <div className="rule-disable-confirm">
          <Typography.Text type="secondary">
            停用后，新的审计案例将不再包含该规则；已产生的案例保留当时的评估结果。
          </Typography.Text>
          <Input.TextArea
            rows={3}
            aria-label="停用原因"
            placeholder="请填写停用原因（必填）"
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        </div>
      ),
      okText: "停用",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        const trimmed = reason.trim();
        if (trimmed.length === 0) {
          message.error("请填写停用原因");
          return Promise.reject(new Error("停用原因不能为空"));
        }
        onDisable(record.id, trimmed);
        return undefined;
      },
    });
  };

  const columns: ColumnsType<RuleListItem> = [
    {
      title: "规则名",
      key: "name",
      render: (_value, record) => {
        const description = record.description || "-";
        return (
          <div className="table-primary">
            <span className="table-title" title={record.name}>
              {record.name}
            </span>
            <span className="table-sub" title={description}>
              {description}
            </span>
          </div>
        );
      },
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
          "-"
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
          "-"
        ) : (
          <Tag color={ruleVersionStatusTagColors[record.status]}>
            {ruleVersionStatusLabels[record.status]}
          </Tag>
        ),
    },
    {
      title: "运行",
      key: "runtime",
      width: 150,
      render: (_value, record) => {
        const enabled = record.enabled !== false;
        return (
          <Space size={6} onClick={(event) => event.stopPropagation()}>
            <Switch
              size="small"
              checked={enabled}
              aria-label={enabled ? "停用规则" : "启用规则"}
              onChange={(checked) => {
                if (checked) onEnable(record.id);
                else confirmDisable(record);
              }}
            />
            <Tag color={enabled ? "success" : "default"}>
              {enabled ? ruleRuntimeLabels.enabled : ruleRuntimeLabels.disabled}
            </Tag>
          </Space>
        );
      },
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
      render: (_value, record) => record.publishedBy ?? "-",
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
    <div className="page page--fill">
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
          options={contractTypeOptions(rules).map((option) => ({
            value: option.value,
            label: option.label,
          }))}
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
        <div className="page-table-fill" ref={tableHostRef}>
          <Table<RuleListItem>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            scroll={{ x: "max-content", y: tableScrollY }}
            pagination={false}
            onRow={(record) => ({
              onClick: () => onOpen(record.id),
              style: { cursor: "pointer" },
            })}
            locale={{ emptyText: <Empty description="暂无规则" /> }}
          />
        </div>
      )}
    </div>
  );
}
