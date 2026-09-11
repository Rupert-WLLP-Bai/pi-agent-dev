import { Button, Drawer, Form, Input, Space, Typography } from "antd";
import type { FindingRevision } from "@contract-audit/audit/model";

export interface ReviewDrawerProps {
  finding: FindingRevision | null;
  decision: "ACCEPTED" | "REJECTED" | null;
  open: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    findingId: string;
    decision: "ACCEPTED" | "REJECTED";
    reason?: string;
  }) => void;
}

interface ReviewFormValues {
  reason?: string;
}

export function ReviewDrawer({
  finding,
  decision,
  open,
  submitting,
  error,
  onClose,
  onSubmit,
}: ReviewDrawerProps) {
  const rejecting = decision === "REJECTED";

  const handleFinish = (values: ReviewFormValues) => {
    if (!finding || !decision) return;
    const reason = values.reason?.trim();
    onSubmit({
      findingId: finding.id,
      decision,
      ...(reason ? { reason } : {}),
    });
  };

  return (
    <Drawer
      title={rejecting ? "驳回审计建议" : "接受审计建议"}
      open={open}
      onClose={onClose}
      size="min(480px, 100vw)"
      destroyOnHidden
      keyboard={!submitting}
      mask={{ closable: !submitting }}
      closable={!submitting}
      footer={
        <div className="drawer-footer">
          <Space>
            <Button onClick={onClose} disabled={submitting}>取消</Button>
            <Button
              type="primary"
              danger={rejecting}
              htmlType="submit"
              form="review-form"
              loading={submitting}
            >
              {rejecting ? "确认驳回" : "确认接受"}
            </Button>
          </Space>
        </div>
      }
    >
      <Form
        id="review-form"
        layout="vertical"
        onFinish={handleFinish}
        scrollToFirstError={{ focus: true }}
      >
        {finding && (
          <Typography.Paragraph className="review-summary">
            <Typography.Text strong>{rejecting ? "驳回" : "接受"}：</Typography.Text>
            {finding.proposal.rationale}
          </Typography.Paragraph>
        )}
        <Form.Item
          label="复核理由"
          name="reason"
          extra={rejecting ? "驳回时必须说明理由。" : "可选，用于记录接受原因。"}
          rules={
            rejecting
              ? [
                  {
                    validator: async (_, value?: string) => {
                      if (!value?.trim()) throw new Error("请输入驳回理由");
                    },
                  },
                ]
              : []
          }
        >
          <Input.TextArea rows={4} placeholder="说明复核判断依据" disabled={submitting} />
        </Form.Item>
        {error && <div role="alert" className="review-error">{error}</div>}
      </Form>
    </Drawer>
  );
}
