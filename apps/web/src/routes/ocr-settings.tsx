import { SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { PageHead, PageHeadActions, PageQueryBody } from "../components/page-status";
import {
  fetchVisionModels,
  getOcrSettings,
  type OcrProvider,
  type OcrSettingsUpdateInput,
  probeOcrSettings,
  saveOcrSettings,
  testOcrSettings,
  type VisionModel,
} from "../ocr-api";

interface OcrSettingsFormValues {
  provider: OcrProvider;
  vlmEndpoint: string;
  vlmApiKey: string;
  vlmModel: string;
  vlmFallbackModel: string;
  mineruEndpoint: string;
  maxPages: number;
  scale: number;
  jpegQuality: number;
  concurrency: number;
  requestTimeoutMs: number;
}

const OCR_QUERY_KEY = ["ocr-settings"];

/** Relative time for the last probe stamp, an absolute local time otherwise. */
const relativeTime = (value: string): string => {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
};

/**
 * The provider cards an operator picks between. `mineru` is offered because
 * its endpoint is configurable ahead of deployment — the readiness line under
 * the form is what says whether it actually works right now, and it comes from
 * a live probe rather than from the selector.
 */
const PROVIDERS: { value: OcrProvider; label: string; description: string }[] = [
  {
    value: "off",
    label: "关闭",
    description: "不识别扫描件；无文本层的 PDF 会报无法识别，而不是猜内容。",
  },
  {
    value: "vlm",
    label: "视觉模型",
    description: "把每页渲染成图片，发送到 OpenAI 兼容视觉接口逐行转录。",
  },
  {
    value: "mineru",
    label: "MinerU",
    description: "调用 MinerU 4.x 服务的 /v1/file_parse，返回版面结构化内容。",
  },
];

/** 集成健康's disposition of the recognizer, derived from the live probe. */
type Readiness = { ok: boolean; detail: string | null; pending: boolean };

/**
 * OCR 识别: the recognizer scanned contracts are read through.
 *
 * Everything here is a single saved row: the selector picks the engine, the
 * fields that apply to it are shown, and saving makes the *next* PDF parse use
 * them — no restart. The key field is a password input whose stored state is
 * reported as a masked hint, so a credential can never be rendered.
 */
export default function OcrSettingsPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<OcrSettingsFormValues>();
  const [models, setModels] = useState<VisionModel[]>([]);
  const [readiness, setReadiness] = useState<Readiness>({
    ok: false,
    detail: null,
    pending: true,
  });

  // Watched so the applicable fields and the model fetch can react to them.
  const provider = Form.useWatch("provider", form);
  const endpointValue = Form.useWatch("vlmEndpoint", form);
  const apiKeyValue = Form.useWatch("vlmApiKey", form);

  const settingsQuery = useQuery({ queryKey: OCR_QUERY_KEY, queryFn: getOcrSettings });
  const settings = settingsQuery.data;

  useEffect(() => {
    if (settings === undefined) return;
    form.setFieldsValue({
      provider: settings.provider,
      vlmEndpoint: settings.vlmEndpoint,
      // Never prefill the key field: the stored value is a mask, and a filled
      // password input would invite an accidental resave of the mask itself.
      vlmApiKey: "",
      vlmModel: settings.vlmModel,
      vlmFallbackModel: settings.vlmFallbackModel ?? "",
      mineruEndpoint: settings.mineruEndpoint,
      maxPages: settings.maxPages,
      scale: settings.scale,
      jpegQuality: settings.jpegQuality,
      concurrency: settings.concurrency,
      requestTimeoutMs: settings.requestTimeoutMs,
    });
    setModels([]);
  }, [settings, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: OCR_QUERY_KEY });

  const saveMutation = useMutation({
    mutationFn: (input: OcrSettingsUpdateInput) => saveOcrSettings(input),
    onSuccess: (saved) => {
      message.success(
        saved.source === "stored" ? "OCR 设置已保存，下一次解析即生效" : "OCR 设置已保存",
      );
      void invalidate();
      // Refresh the readiness line against what was just saved.
      setReadiness({ ok: false, detail: null, pending: true });
      void probeOcrSettings()
        .then((probe) => setReadiness({ ok: probe.ok, detail: probe.detail, pending: false }))
        .catch((error: Error) =>
          setReadiness({ ok: false, detail: error.message, pending: false }),
        );
    },
    onError: (error: Error) => message.error(error.message),
  });

  const testMutation = useMutation({
    mutationFn: testOcrSettings,
    onSuccess: (result) => {
      if (result.ok) message.success(`连接成功，耗时 ${result.latencyMs} ms`);
      else message.error(result.error ?? "连接失败");
      setReadiness({ ok: result.ok, detail: result.error, pending: false });
      void invalidate();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const modelsMutation = useMutation({
    mutationFn: fetchVisionModels,
    onSuccess: (list) => {
      setModels(list);
      if (list.length === 0) message.info("该接口未返回任何模型");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const submitting = saveMutation.isPending;

  // The draft fetch needs the endpoint, and a key unless one is already stored
  // — an explicitly empty key means the endpoint is called unauthenticated.
  const storedKey = settings?.vlmApiKeyConfigured ?? false;
  const canFetchModels =
    provider === "vlm" &&
    (endpointValue ?? "").trim().length > 0 &&
    ((apiKeyValue ?? "").trim().length > 0 || storedKey);

  const handleSubmit = (values: OcrSettingsFormValues) => {
    const apiKey = values.vlmApiKey?.trim() ?? "";
    saveMutation.mutate({
      provider: values.provider,
      vlmEndpoint: values.vlmEndpoint.trim(),
      // An empty key keeps the stored credential.
      ...(apiKey ? { vlmApiKey: apiKey } : {}),
      vlmModel: values.vlmModel.trim(),
      vlmFallbackModel: values.vlmFallbackModel.trim() || null,
      mineruEndpoint: values.mineruEndpoint.trim(),
      maxPages: values.maxPages,
      scale: values.scale,
      jpegQuality: values.jpegQuality,
      concurrency: values.concurrency,
      requestTimeoutMs: values.requestTimeoutMs,
    });
  };

  const handleFetchModels = () => {
    const apiKey = (apiKeyValue ?? "").trim();
    modelsMutation.mutate({
      endpoint: (endpointValue ?? "").trim(),
      // Omitted means "use the stored key"; an explicit empty string means the
      // endpoint takes no credential at all.
      ...(apiKey ? { apiKey } : {}),
    });
  };

  const readinessTag = () => {
    if (readiness.pending) return <Tag>检测中…</Tag>;
    return readiness.ok ? <Tag color="success">就绪</Tag> : <Tag color="warning">未就绪</Tag>;
  };

  const selectedProvider = PROVIDERS.find((entry) => entry.value === provider);

  const initialLoading = settingsQuery.isLoading && settings === undefined;
  const initialError = settingsQuery.isError && settings === undefined;

  return (
    <div className="page">
      <PageHead
        title="OCR 识别"
        description="配置扫描件合同使用哪个识别引擎；保存后下一次 PDF 解析即生效，无需重启。"
        actions={
          <PageHeadActions
            refreshing={settingsQuery.isFetching && !settingsQuery.isLoading}
            onRefresh={() => void settingsQuery.refetch()}
          />
        }
      />

      <PageQueryBody
        initialLoading={initialLoading}
        initialError={initialError}
        errorMessage={settingsQuery.error?.message ?? "加载 OCR 设置失败"}
        onRetry={() => void settingsQuery.refetch()}
      >
        {settings !== undefined && (
          <>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="配置来源">
                  {settings.source === "stored" ? (
                    <Tag color="blue">已保存（重启后保留）</Tag>
                  ) : (
                    <Tag>环境变量（尚未保存）</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="当前状态">{readinessTag()}</Descriptions.Item>
                <Descriptions.Item label="密钥">
                  {settings.vlmApiKeyConfigured ? (
                    <span className="mono">{settings.vlmApiKeyHint ?? "已配置"}</span>
                  ) : (
                    "未配置"
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="最近检测">
                  {settings.lastCheckedAt === null ? (
                    "-"
                  ) : (
                    <Space size={6}>
                      <span>{relativeTime(settings.lastCheckedAt)}</span>
                      {settings.lastCheckOk === false ? (
                        <Tooltip title={settings.lastCheckError ?? "连接失败"}>
                          <Tag color="error">失败</Tag>
                        </Tooltip>
                      ) : (
                        <Tag color="success">正常</Tag>
                      )}
                    </Space>
                  )}
                </Descriptions.Item>
              </Descriptions>
              {!readiness.pending && readiness.detail !== null && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {readiness.detail}
                </Typography.Text>
              )}
            </Card>

            <Card>
              <Form<OcrSettingsFormValues>
                form={form}
                layout="vertical"
                validateTrigger="onBlur"
                scrollToFirstError={{ focus: true }}
                initialValues={{
                  provider: "off",
                  maxPages: 40,
                  scale: 2,
                  jpegQuality: 85,
                  concurrency: 3,
                  requestTimeoutMs: 120000,
                }}
                onFinish={handleSubmit}
              >
                <Form.Item label="识别引擎" name="provider" required>
                  <Radio.Group optionType="button" buttonStyle="solid" disabled={submitting}>
                    {PROVIDERS.map((entry) => (
                      <Radio.Button key={entry.value} value={entry.value}>
                        {entry.label}
                      </Radio.Button>
                    ))}
                  </Radio.Group>
                </Form.Item>
                {selectedProvider !== undefined && (
                  <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                    {selectedProvider.description}
                  </Typography.Text>
                )}

                {provider === "vlm" && (
                  <>
                    <Form.Item
                      label="视觉模型接口地址"
                      name="vlmEndpoint"
                      extra="OpenAI 兼容的基础地址，通常以 /v1 结尾。"
                      rules={[{ required: true, message: "请输入视觉模型接口地址" }]}
                    >
                      <Input
                        className="mono"
                        placeholder="http://127.0.0.1:18091/v1"
                        disabled={submitting}
                      />
                    </Form.Item>

                    <Form.Item label="视觉模型" required>
                      <Space.Compact style={{ width: "100%" }}>
                        <Form.Item
                          name="vlmModel"
                          noStyle
                          rules={[{ required: true, message: "请输入模型" }]}
                        >
                          <Input
                            className="mono"
                            placeholder="例如 qwen3-vl"
                            disabled={submitting}
                          />
                        </Form.Item>
                        <Button
                          onClick={handleFetchModels}
                          loading={modelsMutation.isPending}
                          disabled={!canFetchModels || submitting}
                        >
                          获取模型列表
                        </Button>
                      </Space.Compact>
                      {settings?.vlmApiKeyConfigured === true && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          留空将使用已存储的密钥获取列表。
                        </Typography.Text>
                      )}
                      {models.length > 0 && (
                        <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
                          {models.map((model) => (
                            <Tag
                              key={model.id}
                              style={{ cursor: "pointer" }}
                              onClick={() => form.setFieldValue("vlmModel", model.id)}
                            >
                              {model.id}
                              {model.maxInput !== null && (
                                <span className="table-sub"> 输入上限 {model.maxInput}</span>
                              )}
                            </Tag>
                          ))}
                        </Space>
                      )}
                    </Form.Item>

                    <Form.Item
                      label="备用模型"
                      name="vlmFallbackModel"
                      extra="主模型因输出长度截断时改用该模型重试；留空表示不重试。"
                    >
                      <Input
                        className="mono"
                        placeholder="例如 qwen3-vl-max"
                        disabled={submitting}
                      />
                    </Form.Item>

                    <Form.Item
                      label="API Key"
                      name="vlmApiKey"
                      extra={
                        settings?.vlmApiKeyConfigured === true
                          ? "留空表示保留已存储的密钥。"
                          : "该接口不需要鉴权时可留空。"
                      }
                    >
                      <Input.Password
                        autoComplete="off"
                        placeholder={
                          settings?.vlmApiKeyConfigured === true ? "留空保留现有密钥" : "sk-…"
                        }
                        disabled={submitting}
                      />
                    </Form.Item>
                  </>
                )}

                {provider === "mineru" && (
                  <>
                    <Form.Item
                      label="MinerU 接口地址"
                      name="mineruEndpoint"
                      extra="MinerU 4.x 服务根地址（不含 /v1），例如 http://127.0.0.1:8000。"
                      rules={[{ required: true, message: "请输入 MinerU 接口地址" }]}
                    >
                      <Input
                        className="mono"
                        placeholder="http://127.0.0.1:8000"
                        disabled={submitting}
                      />
                    </Form.Item>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      title="MinerU 需要自行部署"
                      description={
                        "适配器按 MinerU 4.x 已验证的 HTTP 契约实现（POST /v1/file_parse）。" +
                        "地址可以先行配置；是否真正可用由上方“当前状态”的实时探测决定，" +
                        "未连接可用实例时会如实报告未就绪，不会假装识别成功。"
                      }
                    />
                  </>
                )}

                <Form.Item label="单份合同最多识别页数" name="maxPages">
                  <InputNumber min={1} max={1000} style={{ width: "100%" }} disabled={submitting} />
                </Form.Item>
                <Form.Item label="渲染倍率" name="scale" extra="低于 2 时小字号汉字的笔画会粘连。">
                  <InputNumber
                    min={0.5}
                    max={4}
                    step={0.5}
                    style={{ width: "100%" }}
                    disabled={submitting}
                  />
                </Form.Item>
                <Form.Item label="JPEG 质量" name="jpegQuality">
                  <InputNumber min={30} max={100} style={{ width: "100%" }} disabled={submitting} />
                </Form.Item>
                <Form.Item
                  label="并发页数"
                  name="concurrency"
                  extra="视觉模型每页一个请求，按此并发发出。"
                >
                  <InputNumber min={1} max={16} style={{ width: "100%" }} disabled={submitting} />
                </Form.Item>
                <Form.Item label="请求超时（毫秒）" name="requestTimeoutMs">
                  <InputNumber
                    min={1000}
                    max={600000}
                    step={1000}
                    style={{ width: "100%" }}
                    disabled={submitting}
                  />
                </Form.Item>

                <Space>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SaveOutlined />}
                    loading={submitting}
                  >
                    保存
                  </Button>
                  <Button
                    onClick={() => testMutation.mutate()}
                    loading={testMutation.isPending}
                    disabled={submitting}
                  >
                    测试连接
                  </Button>
                </Space>
              </Form>
            </Card>
          </>
        )}
      </PageQueryBody>
    </div>
  );
}
