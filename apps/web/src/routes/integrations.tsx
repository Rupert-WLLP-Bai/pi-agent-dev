import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import type { ApiHealth } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, Result, Row, Skeleton, Space, Statistic, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { getApiHealth } from "../api";

interface IntegrationCard {
  key: string;
  name: string;
  icon: ReactNode;
  /** The integration's readiness, straight from the health payload. */
  ok: boolean;
  okLabel: string;
  failLabel: string;
  description: string;
}

/**
 * One card per external dependency. The API reports credential *presence* only,
 * so this page can never render a secret — only whether one is configured.
 */
function integrationCards(health: ApiHealth): IntegrationCard[] {
  return [
    {
      key: "database",
      name: "PostgreSQL",
      icon: <DatabaseOutlined />,
      ok: health.database,
      okLabel: "已连接",
      failLabel: "未连接",
      description: "审计案件、快照与规则版本的持久化存储。",
    },
    {
      key: "dispatcher",
      name: "Dispatcher",
      icon: <CloudServerOutlined />,
      ok: health.dispatcher,
      okLabel: "运行中",
      failLabel: "已停止",
      description: "DB 认领循环，把 PENDING 案件推进到智能体运行。",
    },
    {
      key: "qcc",
      name: "企查查（QCC）",
      icon: <ApiOutlined />,
      ok: health.qccConfigured,
      okLabel: "已配置",
      failLabel: "未配置",
      description: "主体核验与风险扫描所用的 bearer token 是否就绪。",
    },
    {
      key: "llm",
      name: "模型（LLM）",
      icon: <RobotOutlined />,
      ok: health.llmConfigured,
      okLabel: "已配置",
      failLabel: "未配置",
      description: "真实智能体所用的 LLM 密钥是否就绪。",
    },
  ];
}

const agentModeLabels = {
  pi: { label: "真实智能体", color: "blue" },
  fake: { label: "模拟智能体", color: "gold" },
} as const;

/** 集成健康: the runtime's external dependencies at a glance. */
export default function IntegrationsPage() {
  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    refetchInterval: 30_000,
  });
  const health = healthQuery.data;

  if (healthQuery.isLoading) {
    return (
      <div className="page">
        <Typography.Title level={3}>集成健康</Typography.Title>
        <Card>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
      </div>
    );
  }

  if (health === undefined) {
    return (
      <div className="page">
        <Card>
          <Result
            status="warning"
            title="无法加载集成健康"
            subTitle="未能从 /api/health 读取服务状态，请确认 API 是否可访问。"
          />
        </Card>
      </div>
    );
  }

  const mode = agentModeLabels[health.agentMode];

  return (
    <div className="page">
      <Space direction="vertical" size={4}>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          集成健康
        </Typography.Title>
        <Space size={8} wrap>
          <Typography.Text type="secondary">每 30 秒自动刷新</Typography.Text>
          <Tag color={mode.color}>智能体模式：{mode.label}</Tag>
        </Space>
      </Space>

      {health.status === "unavailable" && (
        <Alert
          type="warning"
          showIcon
          message="部分集成不可用"
          description="下列集成中至少一项未就绪，请检查对应服务进程或环境变量。"
        />
      )}

      <Row gutter={[16, 16]}>
        {integrationCards(health).map((card) => (
          <Col key={card.key} xs={24} sm={12} xl={6}>
            <Card
              className="kpi-card"
              title={
                <Space size={8}>
                  {card.icon}
                  {card.name}
                </Space>
              }
              extra={<Tag color={card.ok ? "green" : "red"}>{card.ok ? "正常" : "异常"}</Tag>}
            >
              <Statistic
                value={card.ok ? card.okLabel : card.failLabel}
                valueStyle={{ color: card.ok ? "#0f7b3f" : "#b91c1c" }}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                {card.description}
              </Typography.Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
