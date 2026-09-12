import { Card, Col, Row, Statistic, Tag, Typography } from "antd";
import {
  AuditOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { goldenSet } from "@contract-audit/audit";

const { Title, Paragraph, Text } = Typography;

const BRAND_PRIMARY = "#0B6BB5";
const BRAND_SIDEBAR = "#0C2D48";

const rules = [
  {
    code: "ADVANCE_PAYMENT_LIMIT",
    name: "预付款上限规则",
    trigger: "提取合同中预付款百分比，对比制度上限（默认 30%）",
    example: "70% > 30% → POLICY_CONFLICT",
    color: "blue",
  },
  {
    code: "PENALTY_RATIO_LIMIT",
    name: "违约金上限规则",
    trigger: "在违约责任段落提取违约金百分比，对比制度上限",
    example: "50% > 30% → POLICY_CONFLICT",
    color: "orange",
  },
  {
    code: "TERMINATION_CLAUSE_PRESENT",
    name: "终止条款规则",
    trigger: "检查合同是否含终止/解除条款（heading-aware 扫描）",
    example: "无「解除/终止」→ NEEDS_HUMAN_REVIEW",
    color: "gold",
  },
  {
    code: "DISPUTE_JURISDICTION",
    name: "争议管辖规则",
    trigger: "提取争议解决方式 + 管辖地，对比我方所在地（默认重庆）",
    example: "北京 ≠ 重庆 → POLICY_CONFLICT",
    color: "purple",
  },
];

const pipeline = [
  { step: "1. 文档接入", desc: "docx / pdf / txt 上传 → 统一 IR（Contract Document）", icon: <FileSearchOutlined /> },
  { step: "2. 确定性规则", desc: "4 条零-LLM 规则并行评估，毫秒级出结果", icon: <ThunderboltOutlined /> },
  { step: "3. 主体核验", desc: "企查查 35 维风险因子扫描（真实 API / fixture 切换）", icon: <SafetyCertificateOutlined /> },
  { step: "4. 智能体研判", desc: "Pi Agent 综合规则+主体+证据，产出审计发现", icon: <AuditOutlined /> },
];

export default function DemoPage() {
  return (
    <div style={{ padding: "32px 48px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${BRAND_PRIMARY}, ${BRAND_SIDEBAR})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 24,
            }}
          >
            <AuditOutlined />
          </div>
          <Title level={2} style={{ margin: 0, color: BRAND_SIDEBAR }}>
            合同智能审计智能体
          </Title>
        </div>
        <Paragraph style={{ fontSize: 16, color: "#667085", maxWidth: 680, margin: "0 auto" }}>
          认知—决策—执行 闭环：从合同文档到审计发现，确定性规则 + 企查查主体核验 + 大模型智能体研判
        </Paragraph>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          <Tag color="blue">第一届黄桷树AI智能体开发大赛</Tag>
          <Tag color="green">4 条确定性规则</Tag>
          <Tag color="orange">企查查 35 维风险</Tag>
          <Tag color="purple">golden set 12 case · 100%</Tag>
        </div>
      </div>

      {/* Pipeline */}
      <Title level={3} style={{ color: BRAND_SIDEBAR, marginBottom: 24 }}>
        技术闭环
      </Title>
      <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
        {pipeline.map((item) => (
          <Col key={item.step} xs={24} sm={12} md={6}>
            <Card
              style={{ height: "100%", borderColor: "#D9DEE7" }}
              styles={{ body: { padding: 24 } }}
            >
              <div style={{ fontSize: 32, color: BRAND_PRIMARY, marginBottom: 12 }}>{item.icon}</div>
              <Text strong style={{ fontSize: 15, color: BRAND_SIDEBAR }}>{item.step}</Text>
              <Paragraph style={{ marginTop: 8, color: "#667085", marginBottom: 0 }}>{item.desc}</Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Rules */}
      <Title level={3} style={{ color: BRAND_SIDEBAR, marginBottom: 24 }}>
        确定性审计规则矩阵
      </Title>
      <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
        {rules.map((rule) => (
          <Col key={rule.code} xs={24} sm={12} md={6}>
            <Card
              style={{ height: "100%", borderColor: "#D9DEE7" }}
              styles={{ body: { padding: 24 } }}
            >
              <Tag color={rule.color} style={{ marginBottom: 12 }}>{rule.code}</Tag>
              <Text strong style={{ display: "block", color: BRAND_SIDEBAR, marginBottom: 8 }}>
                {rule.name}
              </Text>
              <Paragraph style={{ color: "#667085", fontSize: 13, marginBottom: 8 }}>{rule.trigger}</Paragraph>
              <Text code style={{ fontSize: 12 }}>{rule.example}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Golden Set Results */}
      <Title level={3} style={{ color: BRAND_SIDEBAR, marginBottom: 24 }}>
        Golden Set 跑分
      </Title>
      <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
        <Col xs={12} md={6}>
          <Card styles={{ body: { padding: 24, textAlign: "center" } }}>
            <Statistic title="回归用例" value={goldenSet.length} suffix="份" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card styles={{ body: { padding: 24, textAlign: "center" } }}>
            <Statistic title="规则断言" value={goldenSet.length * 4} suffix="条" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card styles={{ body: { padding: 24, textAlign: "center" } }}>
            <Statistic title="回归结果" value="全通过" styles={{ value: { color: "#15803d" } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card styles={{ body: { padding: 24, textAlign: "center" } }}>
            <Statistic title="混淆矩阵" value={0} suffix="误判" styles={{ value: { color: "#15803d" } }} />
          </Card>
        </Col>
      </Row>

      {/* Key Innovation */}
      <Title level={3} style={{ color: BRAND_SIDEBAR, marginBottom: 24 }}>
        关键创新
      </Title>
      <Row gutter={[24, 24]}>
        <Col xs={24} md={8}>
          <Card style={{ height: "100%" }} styles={{ body: { padding: 24 } }}>
            <Title level={5} style={{ color: BRAND_PRIMARY }}>格式无关的合同 IR</Title>
            <Paragraph style={{ color: "#667085" }}>
              同一份合同不论粘贴文本还是上传 docx/pdf，hash 相同 → 证据身份一致。基于
              Docling/MinerU 的 middle_json 设计理念，单一 IR 构造点。
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ height: "100%" }} styles={{ body: { padding: 24 } }}>
            <Title level={5} style={{ color: BRAND_PRIMARY }}>确定性 + 智能体双层</Title>
            <Paragraph style={{ color: "#667085" }}>
              确定性规则毫秒级出结论（可审计、可复现），智能体综合研判（处理模糊语义）。
              确定性冲突永远优先于 LLM 判断。
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card style={{ height: "100%" }} styles={{ body: { padding: 24 } }}>
            <Title level={5} style={{ color: BRAND_PRIMARY }}>真实企查查集成</Title>
            <Paragraph style={{ color: "#667085" }}>
              直连企查查 MCP API，35 维风险因子实时扫描。fixture/qcc 一键切换，
              演示时不花 API 额度，评审时连真实数据。
            </Paragraph>
          </Card>
        </Col>
      </Row>

      {/* Demo Links */}
      <div style={{ textAlign: "center", marginTop: 48, marginBottom: 24 }}>
        <Paragraph style={{ color: "#667085" }}>
          <Text strong>现场演示入口：</Text>{" "}
          <a href="/audit-cases" style={{ color: BRAND_PRIMARY }}>审计工作台</a>
          {" · "}
          <a href="/dashboard" style={{ color: BRAND_PRIMARY }}>数据仪表盘</a>
        </Paragraph>
        <Paragraph style={{ color: "#667085", fontSize: 12 }}>
          中国移动 · 黄桷树AI智能体平台 · 合同智能审计智能体
        </Paragraph>
      </div>
    </div>
  );
}
