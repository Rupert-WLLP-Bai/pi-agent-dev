import { useState } from "react";
import { Form, Input, InputNumber, Drawer, Button, Segmented, Space } from "antd";
import type { CreateAuditCaseInput } from "../api";
import { demoContracts } from "../demo-contracts";

export interface NewAuditDrawerProps {
  open: boolean;
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (input: CreateAuditCaseInput) => void;
}

interface NewAuditFormValues {
  contractText: string;
  policyLimitPercent: number;
}

export function NewAuditDrawer({
  open,
  submitting,
  submitError,
  onClose,
  onSubmit,
}: NewAuditDrawerProps) {
  const [form] = Form.useForm<NewAuditFormValues>();
  const [sampleId, setSampleId] = useState(demoContracts[0]!.id);
  const sample = demoContracts.find((item) => item.id === sampleId) ?? demoContracts[0]!;

  const handleSubmit = (values: NewAuditFormValues) => {
    onSubmit({
      contractText: values.contractText.trim(),
      policyLimitRatio: values.policyLimitPercent / 100,
    });
  };

  return (
    <Drawer
      title="新建审计"
      open={open}
      onClose={onClose}
      size="min(520px, 100vw)"
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
              htmlType="submit"
              form="new-audit-form"
              loading={submitting}
            >
              开始审计
            </Button>
          </Space>
        </div>
      }
    >
      <Form<NewAuditFormValues>
        id="new-audit-form"
        form={form}
        layout="vertical"
        validateTrigger="onBlur"
        scrollToFirstError={{ focus: true }}
        initialValues={{ contractText: "", policyLimitPercent: 30 }}
        onFinish={handleSubmit}
      >
        <Form.Item
          label="合同文本"
          name="contractText"
          validateTrigger="onBlur"
          extra="粘贴合同全文，系统会抽取预付款条款并对照制度上限。"
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                if (!value?.trim()) throw new Error("请输入合同文本");
              },
            },
          ]}
        >
          <Input.TextArea
            rows={6}
            showCount
            placeholder="粘贴需要审计的合同文本"
            disabled={submitting}
          />
        </Form.Item>

        <Form.Item
          label="制度允许的预付款上限"
          name="policyLimitPercent"
          rules={[
            { required: true, message: "请输入预付款上限" },
            {
              type: "number",
              min: 0,
              max: 100,
              message: "上限必须在 0 到 100 之间",
            },
          ]}
        >
          <InputNumber
            min={0}
            max={100}
            precision={0}
            suffix="%"
            style={{ width: "100%" }}
            disabled={submitting}
          />
        </Form.Item>

        <div className="demo-contract-picker">
          <Segmented
            size="small"
            value={sampleId}
            onChange={(value) => setSampleId(String(value))}
            disabled={submitting}
            options={demoContracts.map((item) => ({ value: item.id, label: item.shortLabel }))}
          />
          <Button
            onClick={() => form.setFieldValue("contractText", sample.text)}
            disabled={submitting}
          >
            加载演示合同
          </Button>
        </div>
        <p className="demo-contract-summary">{sample.summary}</p>

        {submitError && (
          <div role="alert" style={{ marginTop: 16, color: "#b91c1c" }}>
            {submitError}
          </div>
        )}
      </Form>
    </Drawer>
  );
}
