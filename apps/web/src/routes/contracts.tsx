import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ContractDetailView, ContractListItem } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, Card, Empty, Result, Skeleton, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiRequestError, getContract, listContracts } from "../api";
import { getRuleCodeLabel } from "../audit-presentation";
import { AuditStateBadge } from "../components/audit-state-badge";

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

// Wire shapes are owned by the API's contract route schemas and re-exported
// through the Eden app: there is no second, hand-maintained copy of the payload.
type RevisionRow = ContractDetailView["revisions"][number];
type DiffRow = ContractDetailView["diffs"][number];

/** Localized rule names for a diff bucket, or 无 when the bucket is empty. */
const describePins = (pins: Array<{ ruleCode: string }>): string =>
  pins.length === 0 ? "无" : pins.map((pin) => getRuleCodeLabel(pin.ruleCode)).join("、");

const listColumns = (onOpen: (id: string) => void): ColumnsType<ContractListItem> => [
  {
    title: "合同",
    dataIndex: "title",
    render: (_value, record) => (
      <div className="table-primary">
        <Link
          className="table-title"
          to="/contracts/$id"
          params={{ id: record.id }}
          title={record.title}
        >
          {record.title}
        </Link>
      </div>
    ),
  },
  {
    title: "最新版本",
    key: "latestVersion",
    width: 120,
    render: (_value, record) =>
      record.latestVersion === null ? (
        <Tag>暂无版本</Tag>
      ) : (
        <Tag color="blue">最新 v{record.latestVersion}</Tag>
      ),
  },
  {
    title: "版本数",
    dataIndex: "revisionCount",
    width: 100,
    render: (value: number) => <span className="tnum">{value} 个版本</span>,
  },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    width: 180,
    render: (value: string) => formatTime(value),
  },
  {
    title: "操作",
    key: "actions",
    width: 100,
    render: (_value, record) => (
      <Button type="link" size="small" onClick={() => onOpen(record.id)}>
        查看详情
      </Button>
    ),
  },
];

/** 合同中心: the contract index, each row a door into its revision history. */
export default function ContractsListPage() {
  const navigate = useNavigate();
  const contractsQuery = useQuery({ queryKey: ["contracts"], queryFn: listContracts });

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            合同中心
          </Typography.Title>
          <Typography.Text type="secondary">
            按合同查看全部版本、关联的审计案件和相邻版本风险变化。
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void contractsQuery.refetch()}
          loading={contractsQuery.isFetching}
        >
          刷新
        </Button>
      </div>

      {contractsQuery.isError ? (
        <Result
          status="error"
          title="无法加载合同列表"
          subTitle={contractsQuery.error.message}
          extra={
            <Button type="primary" onClick={() => void contractsQuery.refetch()}>
              重新加载
            </Button>
          }
        />
      ) : contractsQuery.isLoading ? (
        <Card size="small" aria-busy="true">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <Card size="small">
          <Table<ContractListItem>
            rowKey="id"
            columns={listColumns((id) => void navigate({ to: "/contracts/$id", params: { id } }))}
            dataSource={contractsQuery.data ?? []}
            pagination={false}
            scroll={{ x: 760 }}
            locale={{
              emptyText: <Empty description="尚无合同；新建审计时会自动创建合同。" />,
            }}
          />
        </Card>
      )}
    </section>
  );
}

export function ContractDetailPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const detailQuery = useQuery({ queryKey: ["contract", id], queryFn: () => getContract(id) });
  const detail = detailQuery.data;

  const revisionColumns: ColumnsType<RevisionRow> = [
    {
      title: "合同版本",
      key: "version",
      width: 160,
      render: (_value, record) => record.revision.label ?? `v${record.revision.version}`,
    },
    {
      title: "审计状态",
      key: "auditStatus",
      width: 140,
      render: (_value, record) => {
        if (!record.auditCaseId) return <Tag>无审计案件</Tag>;
        if (!record.caseStatus) return <Tag>状态未知</Tag>;
        return (
          <AuditStateBadge
            auditCase={{
              status: record.caseStatus,
              stage: record.caseStage ?? record.caseStatus,
            }}
          />
        );
      },
    },
    {
      title: "当前风险",
      key: "risk",
      width: 120,
      render: (_value, record) => <span className="tnum">{record.findingPins.length} 条</span>,
    },
    {
      title: "创建时间",
      key: "createdAt",
      width: 180,
      render: (_value, record) => formatTime(record.revision.createdAt),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_value, record) => {
        const caseId = record.auditCaseId;
        if (!caseId) return null;
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              onClick={() => void navigate({ to: "/audit-cases/$id", params: { id: caseId } })}
            >
              打开案件
            </Button>
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              href={`/api/audit-cases/${caseId}/report.docx`}
            >
              审查报告
            </Button>
          </Space>
        );
      },
    },
  ];

  const diffColumns: ColumnsType<DiffRow> = [
    {
      title: "版本变化",
      key: "versions",
      width: 120,
      render: (_value, record) => `v${record.fromVersion} → v${record.toVersion}`,
    },
    {
      title: "新增风险",
      key: "introduced",
      width: 200,
      render: (_value, record) => describePins(record.diff.introduced),
    },
    {
      title: "已消除风险",
      key: "resolved",
      width: 220,
      render: (_value, record) => describePins(record.diff.resolved),
    },
    {
      title: "持续存在",
      key: "persisting",
      width: 220,
      render: (_value, record) => describePins(record.diff.persisting),
    },
  ];

  if (detailQuery.isLoading) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton active paragraph={{ rows: 8 }} title={{ width: "40%" }} />
      </div>
    );
  }

  if (detailQuery.isError || detail === undefined) {
    const error = detailQuery.error;
    const notFound = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <Result
            status="404"
            title="合同不存在"
            subTitle="该合同可能已删除或链接无效。"
            extra={
              <Button type="primary" onClick={() => void navigate({ to: "/contracts" })}>
                返回合同中心
              </Button>
            }
          />
        ) : (
          <Result
            status="error"
            title="无法加载合同详情"
            subTitle={error?.message}
            extra={
              <Space>
                <Button type="primary" onClick={() => void detailQuery.refetch()}>
                  重新加载
                </Button>
                <Button onClick={() => void navigate({ to: "/contracts" })}>返回合同中心</Button>
              </Space>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <Space orientation="vertical" size={2}>
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => void navigate({ to: "/contracts" })}
          >
            ← 返回合同中心
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {detail.contract.title}
          </Typography.Title>
          <Typography.Text type="secondary">
            创建于 {formatTime(detail.contract.createdAt)}
          </Typography.Text>
        </Space>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void detailQuery.refetch()}
          loading={detailQuery.isFetching}
        >
          刷新
        </Button>
      </div>

      <Card title="合同版本与审计" size="small">
        <Table<RevisionRow>
          rowKey={(row) => row.revision.id}
          columns={revisionColumns}
          dataSource={detail.revisions}
          pagination={false}
          scroll={{ x: 820 }}
          locale={{ emptyText: "暂无合同版本" }}
        />
      </Card>

      {detail.diffs.length > 0 ? (
        <Card title="相邻版本风险变化" size="small">
          <Table<DiffRow>
            rowKey={({ fromVersion, toVersion }) => `${fromVersion}-${toVersion}`}
            columns={diffColumns}
            dataSource={detail.diffs}
            pagination={false}
            scroll={{ x: 760 }}
          />
        </Card>
      ) : null}
    </div>
  );
}
