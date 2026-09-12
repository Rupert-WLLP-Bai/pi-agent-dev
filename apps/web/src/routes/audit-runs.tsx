import type { AgentRunSummary } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Alert, Button, Empty, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { getAgentRuns } from "../api";
import {
  agentRunStateLabels,
  agentRunStateTones,
  describeTokenUsage,
  formatDuration,
  getAgentRunState,
  shortAuditId,
} from "../audit-presentation";

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

/**
 * Index of recent Agent Runs. A run is only meaningful with the case it
 * audited, so each row links into that case's trace.
 */
export default function AuditRunsPage() {
  const navigate = useNavigate();
  const runsQuery = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => getAgentRuns(),
    // A run in flight produces new steps while the page is open.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((run) => getAgentRunState(run, run.caseStatus) === "RUNNING")
        ? 2000
        : false,
  });

  const columns: ColumnsType<AgentRunSummary> = [
    {
      title: "合同",
      dataIndex: "contractTitle",
      render: (_value, record) => (
        <div className="table-primary">
          {record.contractTitle ?? "未命名合同"}
          <span className="table-sub">审计 ID {shortAuditId(record.auditCaseId)}</span>
        </div>
      ),
    },
    {
      title: "运行状态",
      key: "state",
      width: 110,
      render: (_value, record) => {
        const state = getAgentRunState(record, record.caseStatus);
        return <Tag color={agentRunStateTones[state]}>{agentRunStateLabels[state]}</Tag>;
      },
    },
    {
      title: "模型",
      key: "model",
      width: 220,
      render: (_value, record) => (
        <span className="mono">
          {record.provider} / {record.model}@{record.version}
        </span>
      ),
    },
    {
      title: "轨迹步骤",
      dataIndex: "stepCount",
      width: 100,
      align: "right",
      render: (value: number) => value.toLocaleString("en-US"),
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      width: 100,
      align: "right",
      render: (value: number | null) => formatDuration(value) ?? "—",
    },
    {
      title: "Token",
      key: "usage",
      width: 260,
      render: (_value, record) => describeTokenUsage(record.usage) ?? "—",
    },
    {
      title: "开始时间",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => formatTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_value, record) => (
        <Button
          type="link"
          size="small"
          onClick={() =>
            void navigate({
              to: "/audit-cases/$id/trace",
              params: { id: record.auditCaseId },
            })
          }
        >
          查看轨迹
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            运行轨迹
          </Typography.Title>
          <Typography.Text type="secondary">
            每次智能体运行都会留下完整轨迹：调用了哪些工具、传入了什么、返回了什么。
          </Typography.Text>
        </div>
        <Button onClick={() => void runsQuery.refetch()} loading={runsQuery.isFetching}>
          刷新
        </Button>
      </div>

      {runsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="无法加载运行记录"
          description={runsQuery.error.message}
          action={<Button onClick={() => void runsQuery.refetch()}>重试</Button>}
        />
      ) : (
        <Table<AgentRunSummary>
          rowKey="id"
          columns={columns}
          dataSource={runsQuery.data ?? []}
          loading={runsQuery.isLoading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                description={
                  <span>
                    还没有运行记录。到 <Link to="/audit-cases">审计队列</Link> 发起一次审计。
                  </span>
                }
              />
            ),
          }}
        />
      )}
    </>
  );
}
