import type { RuleCode } from "@contract-audit/audit/model";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, Card, Empty, List, Space, Spin, Tag, Typography } from "antd";
import { getContract, listContracts } from "../api";
import { getRuleCodeLabel } from "../audit-presentation";

export default function ContractsListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts"],
    queryFn: listContracts,
  });

  if (isLoading) return <Spin />;
  if (error) return <Alert type="error" message="加载合同列表失败" showIcon />;

  return (
    <div className="page-stack">
      <Typography.Title level={3}>合同中心</Typography.Title>
      <Typography.Paragraph type="secondary">
        一份 Contract 可累积多个 Contract Revision；此处查看版本链与相邻版本的 finding diff。
      </Typography.Paragraph>
      {data?.length === 0 ? (
        <Empty description="尚无合同，新建审计时会自动创建 Contract" />
      ) : (
        <List
          dataSource={data}
          renderItem={(item) => (
            <List.Item>
              <Link to="/contracts/$id" params={{ id: item.id }}>
                {item.title}
              </Link>
              <Space>
                <Tag>{item.revisionCount} 个版本</Tag>
                {item.latestVersion !== null ? (
                  <Tag color="blue">最新 v{item.latestVersion}</Tag>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

export function ContractDetailPage({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["contract", id],
    queryFn: () => getContract(id),
  });

  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="error" message="加载合同详情失败" showIcon />;

  return (
    <div className="page-stack">
      <Typography.Title level={3}>{data.contract.title}</Typography.Title>
      <Typography.Text type="secondary">
        创建于 {new Date(data.contract.createdAt).toLocaleString()}
      </Typography.Text>

      <Card title="版本与审计">
        <List
          dataSource={data.revisions}
          renderItem={(row) => (
            <List.Item
              actions={
                row.auditCaseId
                  ? [
                      <Link key="case" to="/audit-cases/$id" params={{ id: row.auditCaseId }}>
                        打开案件
                      </Link>,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                title={`${row.revision.label ?? `v${row.revision.version}`} · ${row.caseStatus ?? "无案件"}`}
                description={`${row.findingPins.length} 条链头 finding`}
              />
            </List.Item>
          )}
        />
      </Card>

      {data.diffs.length > 0 ? (
        <Card title="相邻版本对比">
          {data.diffs.map((entry) => (
            <div key={`${entry.fromVersion}-${entry.toVersion}`} style={{ marginBottom: 16 }}>
              <Typography.Text strong>
                v{entry.fromVersion} → v{entry.toVersion}
              </Typography.Text>
              <div>
                新增：
                {entry.diff.introduced.length === 0
                  ? "无"
                  : entry.diff.introduced
                      .map((pin) => getRuleCodeLabel(pin.ruleCode as RuleCode))
                      .join("、")}
              </div>
              <div>
                已消除：
                {entry.diff.resolved.length === 0
                  ? "无"
                  : entry.diff.resolved
                      .map((pin) => getRuleCodeLabel(pin.ruleCode as RuleCode))
                      .join("、")}
              </div>
              <div>
                遗留：
                {entry.diff.persisting.length === 0
                  ? "无"
                  : entry.diff.persisting
                      .map((pin) => getRuleCodeLabel(pin.ruleCode as RuleCode))
                      .join("、")}
              </div>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
