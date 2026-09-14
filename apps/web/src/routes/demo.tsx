import type { DemoWorldView, RuleListItem, SeededScenarioView } from "@contract-audit/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { App as AntApp, Button, Card, Col, Row, Space, Statistic, Tag, Typography } from "antd";
import { getDemoWorld, listRules, seedDemoWorld } from "../api";
import { AuditStateBadge } from "../components/audit-state-badge";
import { RULE_MATRIX_LIMIT, summarizeRules } from "../demo-presentation";
import { ruleRuntimeLabels } from "../rule-presentation";

function ScenarioCard({ scenario }: { scenario: SeededScenarioView }) {
  return (
    <Card
      title={
        <Space>
          <span>{scenario.title}</span>
          {scenario.featured ? <Tag color="red">主演示</Tag> : null}
        </Space>
      }
      extra={<Typography.Text type="secondary">{scenario.verifies}</Typography.Text>}
    >
      <Typography.Paragraph style={{ marginBottom: 12 }}>{scenario.story}</Typography.Paragraph>
      {scenario.cases.length === 0 ? (
        <Typography.Text type="secondary">尚未灌入</Typography.Text>
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {scenario.cases.map((item) => (
            <div
              key={item.caseId}
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <div>
                <Link to="/audit-cases/$id" params={{ id: item.caseId }}>
                  {item.title}
                </Link>
                <div>
                  <Typography.Text type="secondary">{item.summary}</Typography.Text>
                </div>
              </div>
              <AuditStateBadge auditCase={item} />
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}

/** 演示概览: typical stories plus a one-click seed into the live queues. */
export default function DemoPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const rulesQuery = useQuery({ queryKey: ["rules"], queryFn: listRules });
  const worldQuery = useQuery({ queryKey: ["demo-world"], queryFn: getDemoWorld });
  const rules = rulesQuery.data ?? [];
  const stats = summarizeRules(rules);
  const world: DemoWorldView | undefined = worldQuery.data;

  const seedMutation = useMutation({
    mutationFn: () => seedDemoWorld({ reset: true }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      message.success(`已灌入 ${result.planted} 条演示案件`);
    },
    onError: (error: Error) => message.error(error.message),
  });

  const featured = world?.scenarios.filter((scenario) => scenario.featured) ?? [];
  const rest = world?.scenarios.filter((scenario) => !scenario.featured) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            演示概览
          </Typography.Title>
          <Typography.Text type="secondary">
            一键灌入典型案件（通过 / 单点问题 / 复合问题按约 60% / 25% / 15%
            填充），用来走通队列、复核、整改和跨案关联。
          </Typography.Text>
        </div>
        <Space className="page-head-actions">
          <Button
            type="primary"
            loading={seedMutation.isPending}
            onClick={() => seedMutation.mutate()}
          >
            {world && world.seededCaseCount > 0 ? "重置并重灌" : "灌入演示数据"}
          </Button>
          <Link to="/audit-cases">
            <Button>开始演示</Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic title="规则总数" value={stats.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title={ruleRuntimeLabels.enabled} value={stats.enabled} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已验证" value={stats.validated} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已灌入案件" value={world?.seededCaseCount ?? 0} />
          </Card>
        </Col>
      </Row>

      {featured.map((scenario) => (
        <div key={scenario.id} style={{ marginTop: 16 }}>
          <ScenarioCard scenario={scenario} />
        </div>
      ))}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {rest.map((scenario) => (
          <Col key={scenario.id} xs={24} lg={12}>
            <ScenarioCard scenario={scenario} />
          </Col>
        ))}
      </Row>

      <Card title="规则矩阵" extra={<Link to="/rules">查看全部</Link>} style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">
          预览前 {RULE_MATRIX_LIMIT} 条运行中的规则。
        </Typography.Text>
        <ul>
          {rules.slice(0, RULE_MATRIX_LIMIT).map((rule: RuleListItem) => (
            <li key={rule.id}>
              {rule.name} <span className="mono">{rule.code}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
