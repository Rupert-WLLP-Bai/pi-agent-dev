import type { RuleListItem } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { listRules } from "../api";
import { RULE_MATRIX_LIMIT, summarizeRules } from "../demo-presentation";
import { ruleRuntimeLabels } from "../rule-presentation";

/**
 * The matrix preview columns. Status is the rule's runtime toggle — whether a
 * new audit case will run it — not a version's lifecycle status.
 */
const columns: ColumnsType<RuleListItem> = [
  {
    title: "规则",
    dataIndex: "name",
    key: "name",
  },
  {
    title: "代码",
    dataIndex: "code",
    key: "code",
    render: (code: string) => <span className="mono">{code}</span>,
  },
  {
    title: "状态",
    key: "status",
    render: (_value, rule) =>
      rule.enabled !== false ? (
        <Tag color="green">{ruleRuntimeLabels.enabled}</Tag>
      ) : (
        <Tag>{ruleRuntimeLabels.disabled}</Tag>
      ),
  },
];

/** 演示概览: the rule registry as the engine currently holds it. */
export default function DemoPage() {
  const rulesQuery = useQuery({ queryKey: ["rules"], queryFn: listRules });
  const rules = rulesQuery.data ?? [];
  const stats = summarizeRules(rules);

  return (
    <div className="page">
      <Typography.Title level={3}>演示概览</Typography.Title>

      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card>
            <Statistic title="规则总数" value={stats.total} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title={ruleRuntimeLabels.enabled} value={stats.enabled} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="已验证" value={stats.validated} />
          </Card>
        </Col>
      </Row>

      <Card title="规则矩阵" extra={<Link to="/rules">查看全部</Link>} style={{ marginTop: 16 }}>
        <Table<RuleListItem>
          dataSource={rules.slice(0, RULE_MATRIX_LIMIT)}
          rowKey="id"
          loading={rulesQuery.isLoading}
          pagination={false}
          columns={columns}
        />
      </Card>

      <Space style={{ marginTop: 16 }}>
        <Link to="/audit-cases">
          <Button type="primary">开始演示</Button>
        </Link>
        <Link to="/rules">
          <Button>规则管理</Button>
        </Link>
        <Link to="/audit-runs">
          <Button>运行轨迹</Button>
        </Link>
      </Space>
    </div>
  );
}
