import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  RobotOutlined,
  ScanOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ApiHealth } from "@contract-audit/api";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Col,
  Descriptions,
  Result,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import { getApiHealth } from "../api";

/** One entry of `ApiHealth.connections`, keyed by dependency. */
type Connection = ApiHealth["connections"][keyof ApiHealth["connections"]];

/**
 * The disposition of a dependency. `unconfigured` is distinct from `down`: a
 * dependency that was never wired (no endpoint, no credentials) is not a fault
 * the operator can fix by restarting a process.
 */
type ConnectionStatus = "ok" | "down" | "unconfigured";

interface ConnectionCard {
  key: keyof ApiHealth["connections"];
  name: string;
  icon: ReactNode;
}

/**
 * The seven dependencies, in the order an operator scans them: primary storage
 * first, then the degradable side services, then the agent's own dependencies.
 */
const connectionCards: ConnectionCard[] = [
  { key: "database", name: "后端数据库", icon: <DatabaseOutlined /> },
  { key: "objectStore", name: "对象存储", icon: <CloudServerOutlined /> },
  { key: "redis", name: "Redis", icon: <ThunderboltOutlined /> },
  { key: "llm", name: "模型服务", icon: <RobotOutlined /> },
  { key: "qcc", name: "企查查", icon: <ApiOutlined /> },
  { key: "ocr", name: "OCR 识别", icon: <ScanOutlined /> },
  { key: "dispatcher", name: "审计调度器", icon: <SyncOutlined /> },
];

const connectionStatusMeta: Record<ConnectionStatus, { label: string; color: string }> = {
  ok: { label: "正常", color: "green" },
  down: { label: "不可用", color: "red" },
  unconfigured: { label: "未配置", color: "default" },
};

/**
 * Reads a dependency's disposition without ever assuming the payload carries
 * one: a missing connection is 未配置, not a crash.
 */
function connectionStatus(connection: Connection | undefined): ConnectionStatus {
  if (connection === undefined) return "unconfigured";
  const unconfigured =
    connection.target === "未配置" ||
    (!connection.ok && (connection.detail?.includes("未配置") ?? false));
  if (unconfigured) return "unconfigured";
  return connection.ok ? "ok" : "down";
}

const agentModeLabels = {
  pi: { label: "真实智能体", color: "blue" },
  fake: { label: "模拟智能体", color: "gold" },
} as const;

/** The page header every route shares; the agent-mode tag rides on the right. */
function PageHead({ mode }: { mode?: { label: string; color: string } }) {
  return (
    <div className="page-head">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          集成健康
        </Typography.Title>
        <Typography.Text type="secondary">
          逐项列出后端数据库、对象存储、Redis、模型服务、企查查、OCR
          识别与审计调度器实际连到的地址；每 30 秒自动刷新。
        </Typography.Text>
      </div>
      <div className="page-head-actions">
        {mode !== undefined && <Tag color={mode.color}>智能体模式：{mode.label}</Tag>}
      </div>
    </div>
  );
}

/** 集成健康: the runtime's external dependencies, and where each one points. */
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
        <PageHead />
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      </div>
    );
  }

  if (health === undefined) {
    return (
      <div className="page">
        <PageHead />
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

  const mode = agentModeLabels[health.agentMode] ?? agentModeLabels.fake;

  return (
    <div className="page">
      <PageHead mode={mode} />

      {health.status === "unavailable" && (
        <Alert
          type="warning"
          showIcon
          title="部分集成不可用"
          description="下列集成中至少一项未就绪，请对照每张卡片上的连接地址检查对应服务进程或环境变量。"
        />
      )}

      <Row gutter={[16, 16]}>
        {connectionCards.map((card) => {
          const connection = health.connections?.[card.key];
          const status = connectionStatus(connection);
          const meta = connectionStatusMeta[status];
          const target = connection?.target ?? "未配置";
          const detail = connection?.detail ?? null;
          return (
            <Col key={card.key} xs={24} sm={12} xl={8}>
              <Card
                className="kpi-card"
                title={
                  <Space size={8}>
                    {card.icon}
                    {card.name}
                  </Space>
                }
                extra={<Tag color={meta.color}>{meta.label}</Tag>}
              >
                <Typography.Paragraph
                  className="mono"
                  style={{
                    marginTop: 0,
                    marginBottom: detail === null ? 0 : 6,
                    wordBreak: "break-all",
                  }}
                >
                  {target}
                </Typography.Paragraph>
                {detail !== null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {detail}
                  </Typography.Text>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card title="运行配置">
        <Descriptions size="small" column={{ xs: 1, sm: 3 }} colon={false}>
          <Descriptions.Item label="智能体模式">{mode.label}</Descriptions.Item>
          <Descriptions.Item label="企查查凭证">
            <Tag color={health.qccConfigured ? "green" : "default"}>
              {health.qccConfigured ? "已配置" : "未配置"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="模型凭证">
            <Tag color={health.llmConfigured ? "green" : "default"}>
              {health.llmConfigured ? "已配置" : "未配置"}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
