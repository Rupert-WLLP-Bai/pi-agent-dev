import type { AgentRunSummary } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Alert, Button, Empty, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { getAgentRuns } from "../api";
import {
  agentRunStateLabels,
  agentRunStateTagColors,
  formatAgentRuntime,
  formatDuration,
  getAgentRunState,
  shortAuditId,
} from "../audit-presentation";
import { TokenUsage } from "../components/token-usage";

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

/** Who the contract is between, as the contract names them. */
const describeParties = (parties: ReadonlyArray<{ label: string; name: string }>): string =>
  parties.length === 0
    ? "未识别到合同主体"
    : parties.map((party) => `${party.label} ${party.name}`).join(" · ");

/**
 * Index of recent Agent Runs. A run is only meaningful with the case it
 * audited, so each row links into that case's trace.
 */
export default function AuditRunsPage() {
  const navigate = useNavigate();
  const runsQuery = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => getAgentRuns(),
    // A run in flight produces new steps while the page is open. Only the
    // newest run of each case can be truly running — older unfinished runs
    // were superseded by a retry and are interrupted.
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      const latestPerCase = new Set<string>();
      for (const run of runs) {
        if (!latestPerCase.has(run.auditCaseId)) latestPerCase.add(run.auditCaseId);
      }
      return runs.some(
        (run) => getAgentRunState(run, run.caseStatus, latestPerCase.has(run.id)) === "RUNNING",
      )
        ? 2000
        : false;
    },
  });

  // The newest run of each case (first occurrence in the desc-by-createdAt list).
  const latestRunPerCase = new Set<string>();
  for (const run of runsQuery.data ?? []) {
    if (!latestRunPerCase.has(run.auditCaseId)) latestRunPerCase.add(run.auditCaseId);
  }

  const columns: ColumnsType<AgentRunSummary> = [
    {
      title: "合同",
      dataIndex: "contractTitle",
      render: (_value, record) => (
        <div className="table-primary">
          <span className="table-title">{record.contractTitle ?? "未命名合同"}</span>
          <span className="table-sub">{describeParties(record.parties)}</span>
        </div>
      ),
    },
    {
      title: "审计 ID",
      key: "auditId",
      width: 118,
      render: (_value, record) => (
        <Tooltip title={record.auditCaseId}>
          <span className="mono">{shortAuditId(record.auditCaseId)}</span>
        </Tooltip>
      ),
    },
    {
      title: "运行状态",
      key: "state",
      width: 110,
      render: (_value, record) => {
        const state = getAgentRunState(record, record.caseStatus, latestRunPerCase.has(record.id));
        return <Tag color={agentRunStateTagColors[state]}>{agentRunStateLabels[state]}</Tag>;
      },
    },
    {
      title: "Agent 运行时",
      key: "runtime",
      width: 120,
      render: (_value, record) => (
        <span className="mono">{formatAgentRuntime(record.provider, record.version)}</span>
      ),
    },
    {
      title: "模型",
      key: "model",
      width: 150,
      render: (_value, record) => <span className="mono">{record.model}</span>,
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
      width: 230,
      render: (_value, record) => <TokenUsage usage={record.usage} />,
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
              search: { runId: record.id },
            })
          }
        >
          查看轨迹
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
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
          scroll={{ x: "max-content" }}
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
    </div>
  );
}
