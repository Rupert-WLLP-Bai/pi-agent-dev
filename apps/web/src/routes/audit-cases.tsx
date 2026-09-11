import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, Card, Form, Input, Space, Table, Typography, message } from "antd";
import { createAuditCase, getAuditCases } from "../api";
import type { AuditCase } from "@contract-audit/audit/model";

const demoContract = "乙方签订后支付合同金额的70%作为预付款。";

export default function AuditCasesList() {
  const [contractText, setContractText] = useState("");
  const [policyLimitRatio, setPolicyLimitRatio] = useState(0.3);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const casesQuery = useQuery({ queryKey: ["audit-cases"], queryFn: getAuditCases });
  const createMutation = useMutation({
    mutationFn: (text: string) => createAuditCase({ contractText: text, policyLimitRatio }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["audit-cases"] });
      void navigate({ to: "/audit-cases/$id", params: { id } });
    },
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <Typography.Title level={2}>合同审计</Typography.Title>
      <Card title="开始新的审计" style={{ marginBottom: 24 }}>
        <Form onFinish={() => createMutation.mutate(contractText)} layout="vertical">
          <Form.Item label="合同文本" required>
            <Input.TextArea rows={4} value={contractText} onChange={(event) => setContractText(event.target.value)} placeholder="粘贴需要审计的合同文本" />
          </Form.Item>
          <Space>
            <Button onClick={() => setContractText(demoContract)}>加载演示合同</Button>
            <Button type="primary" htmlType="submit" loading={createMutation.isPending} disabled={!contractText.trim()}>开始审计</Button>
          </Space>
          <Form.Item label="制度允许的预付款上限">
            <Input
              type="number"
              min={0}
              max={100}
              value={Math.round(policyLimitRatio * 100)}
              onChange={(event) => {
                const percent = Number(event.target.value);
                setPolicyLimitRatio(!Number.isNaN(percent) ? percent / 100 : 0.3);
              }}
              suffix="%"
            />
          </Form.Item>
        </Form>
      </Card>
      <Card title="审计记录">
        <Table<AuditCase>
          rowKey="id"
          loading={casesQuery.isLoading}
          dataSource={casesQuery.data ?? []}
          locale={{ emptyText: "暂无审计记录" }}
          columns={[
            { title: "ID", dataIndex: "id", render: (id: string) => `${id.slice(0, 8)}…` },
            { title: "状态", dataIndex: "status" },
            { title: "阶段", dataIndex: "stage" },
            { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
            { title: "操作", key: "actions", render: (_, record) => <Button onClick={() => void navigate({ to: "/audit-cases/$id", params: { id: record.id } })}>查看</Button> },
          ]}
        />
      </Card>
    </main>
  );
}
