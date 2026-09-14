import type { SubjectVerificationListItem } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, Button, Empty, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { listSubjectVerifications } from "../api";
import { getSubjectStatusLabel, shortAuditId } from "../audit-presentation";

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

const statusColor = (status: SubjectVerificationListItem["status"]): string =>
  status === "RESOLVED"
    ? "green"
    : status === "AMBIGUOUS"
      ? "orange"
      : status === "UNRESOLVED"
        ? "red"
        : "default";

/**
 * 外部核验. The append-only record of how each Contract Party was resolved
 * against the external provider, newest capture first. Read-only: an earlier
 * decision can always be traced back to the answer it rested on.
 */
export default function VerificationPage() {
  const verificationsQuery = useQuery({
    queryKey: ["subject-verifications"],
    queryFn: () => listSubjectVerifications(),
  });

  const columns: ColumnsType<SubjectVerificationListItem> = [
    {
      title: "主体名",
      dataIndex: "subjectName",
      render: (value: string) => (
        <div className="table-primary">
          <span className="table-title" title={value}>
            {value}
          </span>
        </div>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_value, record) => (
        <Tag color={statusColor(record.status)}>{getSubjectStatusLabel(record.status)}</Tag>
      ),
    },
    {
      title: "提供方",
      dataIndex: "provider",
      width: 160,
      render: (value: string | null) => <span className="mono">{value ?? "-"}</span>,
    },
    {
      title: "采集时间",
      dataIndex: "capturedAt",
      width: 180,
      render: (value: string) => formatTime(value),
    },
    {
      title: "过期时间",
      dataIndex: "expiresAt",
      width: 180,
      render: (value: string | null) => (value ? formatTime(value) : "-"),
    },
    {
      title: "案件",
      key: "case",
      width: 220,
      render: (_value, record) => (
        <Link to="/audit-cases/$id" params={{ id: record.auditCaseId }}>
          {record.contractTitle ?? shortAuditId(record.auditCaseId)}
        </Link>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            外部核验
          </Typography.Title>
          <Typography.Text type="secondary">
            合同主体在外部数据源上的核验记录，按采集时间倒序。
          </Typography.Text>
        </div>
        <Button
          onClick={() => void verificationsQuery.refetch()}
          loading={verificationsQuery.isFetching}
        >
          刷新
        </Button>
      </div>

      {verificationsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="无法加载核验记录"
          description={verificationsQuery.error.message}
          action={<Button onClick={() => void verificationsQuery.refetch()}>重试</Button>}
        />
      ) : (
        <Table<SubjectVerificationListItem>
          rowKey="id"
          columns={columns}
          dataSource={verificationsQuery.data ?? []}
          loading={verificationsQuery.isLoading}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                description={
                  <span>
                    还没有核验记录。到 <Link to="/audit-cases">审计队列</Link> 发起一次审计。
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
