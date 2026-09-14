import { FileTextOutlined, UploadOutlined } from "@ant-design/icons";
import { demoContracts } from "@contract-audit/audit/demo-contracts";
import { useQuery } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Upload,
} from "antd";
import { useState } from "react";
import type { CreateAuditCaseInput, UploadContractFileInput } from "../api";
import { listContracts } from "../api";

export interface NewAuditDrawerProps {
  open: boolean;
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (input: CreateAuditCaseInput) => void;
  onUploadFile: (input: UploadContractFileInput) => void;
}

interface NewAuditFormValues {
  contractText: string;
  policyLimitPercent: number;
}

type InputMode = "paste" | "upload";

const ACCEPTED_EXTENSIONS = [".docx", ".pdf", ".txt", ".md"];

/** Mirrors the API's maxUploadBytes default so oversized files never upload. */
const MAX_UPLOAD_BYTES = 10_485_760;

function isAcceptedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function NewAuditDrawer({
  open,
  submitting,
  submitError,
  onClose,
  onSubmit,
  onUploadFile,
}: NewAuditDrawerProps) {
  const [form] = Form.useForm<NewAuditFormValues>();
  const { message } = AntApp.useApp();
  const [sampleId, setSampleId] = useState(demoContracts[0].id);
  const [mode, setMode] = useState<InputMode>("paste");
  const [file, setFile] = useState<File | null>(null);
  /** Set while the textarea still holds an unedited built-in sample. */
  const [loadedSampleId, setLoadedSampleId] = useState<string | null>(null);
  const [linkedContractId, setLinkedContractId] = useState<string | null>(null);
  const { data: contracts = [] } = useQuery({
    queryKey: ["contracts"],
    queryFn: listContracts,
    enabled: open,
  });
  const sample = demoContracts.find((item) => item.id === sampleId) ?? demoContracts[0];

  const handleSubmit = (values: NewAuditFormValues) => {
    if (mode === "upload") {
      if (file === null) {
        form.setFields([{ name: "contractText", errors: ["请选择合同文件"] }]);
        return;
      }
      onUploadFile({ file, policyLimitRatio: values.policyLimitPercent / 100 });
      return;
    }
    onSubmit({
      contractText: values.contractText.trim(),
      policyLimitRatio: values.policyLimitPercent / 100,
      ...(loadedSampleId === null ? {} : { demoId: loadedSampleId }),
      ...(linkedContractId === null ? {} : { contractId: linkedContractId }),
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
            <Button onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" form="new-audit-form" loading={submitting}>
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
        <Form.Item label="关联已有合同" extra="不选则本次审计会新建一份 Contract。">
          <Select
            allowClear
            placeholder="新建合同"
            disabled={submitting}
            options={contracts.map((item) => ({ value: item.id, label: item.title }))}
            value={linkedContractId ?? undefined}
            onChange={(value) => setLinkedContractId(value ?? null)}
          />
        </Form.Item>

        <Form.Item label="输入方式">
          <Segmented<InputMode>
            value={mode}
            onChange={(value) => setMode(value)}
            disabled={submitting}
            options={[
              { value: "paste", label: "粘贴文本", icon: <FileTextOutlined /> },
              { value: "upload", label: "上传文件", icon: <UploadOutlined /> },
            ]}
          />
        </Form.Item>

        {mode === "paste" ? (
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
              onChange={() => setLoadedSampleId(null)}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label="合同文件"
            extra="支持 .docx、.pdf、.txt；文件解析为统一中间表示后进入同一套审计规则。"
            validateStatus={file === null ? undefined : "success"}
          >
            <Upload
              accept={ACCEPTED_EXTENSIONS.join(",")}
              maxCount={1}
              beforeUpload={(selected) => {
                // Refuse oversized files in the browser so they never reach
                // the API: the server would answer 413 anyway.
                if (selected.size > MAX_UPLOAD_BYTES) {
                  message.error("文件超过 10MB 限制");
                  return Upload.LIST_IGNORE;
                }
                if (isAcceptedFile(selected)) setFile(selected);
                return false;
              }}
              onRemove={() => setFile(null)}
              disabled={submitting}
            >
              <Button icon={<UploadOutlined />} disabled={submitting}>
                选择文件
              </Button>
            </Upload>
          </Form.Item>
        )}

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

        {mode === "paste" && (
          <>
            <div className="demo-contract-picker">
              <Segmented
                size="small"
                value={sampleId}
                onChange={(value) => setSampleId(String(value))}
                disabled={submitting}
                options={demoContracts.map((item) => ({ value: item.id, label: item.shortLabel }))}
              />
              <Button
                onClick={() => {
                  form.setFieldValue("contractText", sample.text);
                  setLoadedSampleId(sample.id);
                }}
                disabled={submitting}
              >
                加载演示合同
              </Button>
            </div>
            <p className="demo-contract-summary">{sample.summary}</p>
          </>
        )}

        {submitError && (
          <div role="alert" style={{ marginTop: 16, color: "#b91c1c" }}>
            {submitError}
          </div>
        )}
      </Form>
    </Drawer>
  );
}
