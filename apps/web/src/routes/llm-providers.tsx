import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import {
  activateLlmProvider,
  createLlmProvider,
  deleteLlmProvider,
  type LlmProvider,
  type LlmProviderUpdateInput,
  listLlmProviderModels,
  listLlmProviders,
  testLlmProvider,
  updateLlmProvider,
} from "../api";

interface ProviderFormValues {
  name: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  maxInput: number;
  maxOutput: number;
  enabled: boolean;
}

const PROVIDER_QUERY_KEY = ["llm-providers"];

/** "3 分钟前" for a recent stamp, an absolute local time otherwise. */
const relativeTime = (value: string): string => {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
};

/**
 * 模型服务: the OpenAI-compatible endpoints an audit can run against. The
 * operator adds, edits and deletes providers here and picks which one is
 * active; the API never returns a key, only whether one is stored and a masked
 * hint, so this page cannot render a secret.
 */
export default function LlmProvidersPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<ProviderFormValues>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | null>(null);
  const [models, setModels] = useState<string[]>([]);

  // Watched so the 获取模型列表 button can gate on the fields the probe needs.
  const endpointValue = Form.useWatch("endpoint", form);
  const apiKeyValue = Form.useWatch("apiKey", form);
  const selectedModel = Form.useWatch("model", form);

  const providersQuery = useQuery({ queryKey: PROVIDER_QUERY_KEY, queryFn: listLlmProviders });
  const providers = providersQuery.data ?? [];

  const invalidateProviders = () => queryClient.invalidateQueries({ queryKey: PROVIDER_QUERY_KEY });

  const openCreate = () => {
    setEditing(null);
    setModels([]);
    form.resetFields();
    form.setFieldsValue({ enabled: true, maxInput: 8192, maxOutput: 2048 });
    setDrawerOpen(true);
  };

  const openEdit = (provider: LlmProvider) => {
    setEditing(provider);
    setModels([]);
    form.setFieldsValue({
      name: provider.name,
      endpoint: provider.endpoint,
      model: provider.model,
      apiKey: "",
      maxInput: provider.maxInput,
      maxOutput: provider.maxOutput,
      enabled: provider.enabled,
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    setModels([]);
    form.resetFields();
  };

  const createMutation = useMutation({
    mutationFn: createLlmProvider,
    onSuccess: () => {
      message.success("模型服务已新增");
      closeDrawer();
      void invalidateProviders();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: LlmProviderUpdateInput }) =>
      updateLlmProvider(id, input),
    onSuccess: () => {
      message.success("模型服务已更新");
      closeDrawer();
      void invalidateProviders();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLlmProvider,
    onSuccess: () => {
      message.success("模型服务已删除");
      void invalidateProviders();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const activateMutation = useMutation({
    mutationFn: activateLlmProvider,
    onSuccess: (provider) => {
      message.success(`已切换到「${provider.name}」`);
      void invalidateProviders();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const testMutation = useMutation({
    mutationFn: testLlmProvider,
    onSuccess: (result) => {
      // A reachable endpoint can still refuse the request; both outcomes are
      // reported to the operator, the failure with the server's own text.
      if (result.ok) message.success(`连接成功，耗时 ${result.latencyMs} ms`);
      else message.error(result.error ?? "连接失败");
      void invalidateProviders();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const modelsMutation = useMutation({
    mutationFn: listLlmProviderModels,
    onSuccess: (list) => {
      setModels(list);
      if (list.length === 0) message.info("该接口未返回任何模型");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const submitting = createMutation.isPending || updateMutation.isPending;

  // Probing a saved provider uses its stored key, so it is only possible once a
  // provider exists; there is no draft-probe endpoint.
  const canFetchModels =
    editing !== null &&
    (endpointValue ?? "").trim().length > 0 &&
    ((apiKeyValue ?? "").trim().length > 0 || editing.apiKeyConfigured);

  const handleSubmit = (values: ProviderFormValues) => {
    const apiKey = values.apiKey?.trim() ?? "";
    const base = {
      name: values.name.trim(),
      endpoint: values.endpoint.trim(),
      model: values.model.trim(),
      maxInput: values.maxInput,
      maxOutput: values.maxOutput,
      enabled: values.enabled,
    };
    if (editing) {
      // An omitted or empty key keeps the stored credential.
      updateMutation.mutate({
        id: editing.id,
        input: { ...base, ...(apiKey ? { apiKey } : {}) },
      });
    } else {
      // Opening a provider requires a key; the API rejects a create without one.
      createMutation.mutate({ ...base, apiKey });
    }
  };

  const handleFetchModels = () => {
    if (editing) modelsMutation.mutate(editing.id);
  };

  const columns: ColumnsType<LlmProvider> = [
    {
      title: "名称",
      key: "name",
      render: (_value, record) => (
        <div className="table-primary">
          <span className="table-title">{record.name}</span>
          <span className="table-sub">{record.apiKeyHint ?? "未配置密钥"}</span>
        </div>
      ),
    },
    {
      title: "接口地址",
      key: "endpoint",
      render: (_value, record) => (
        <div className="table-primary">
          <span className="mono">{record.endpoint}</span>
          <span className="table-sub">{record.model}</span>
        </div>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 110,
      render: (_value, record) =>
        record.isActive ? (
          <Tag color="success">当前</Tag>
        ) : (
          <Tag color={record.enabled ? "success" : "default"}>
            {record.enabled ? "启用" : "停用"}
          </Tag>
        ),
    },
    {
      title: "最近检测",
      key: "lastCheck",
      width: 200,
      render: (_value, record) => {
        if (record.lastCheckedAt === null) return "-";
        return (
          <Space size={6} align="center">
            <span>{relativeTime(record.lastCheckedAt)}</span>
            {record.lastCheckOk === false ? (
              <Tooltip title={record.lastCheckError ?? "连接失败"}>
                <Tag color="error">失败</Tag>
              </Tooltip>
            ) : (
              <Tag color="success">正常</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 270,
      render: (_value, record) => (
        <Space size={2}>
          <Button
            type="link"
            size="small"
            loading={testMutation.isPending && testMutation.variables === record.id}
            onClick={() => testMutation.mutate(record.id)}
          >
            测试连接
          </Button>
          {!record.isActive && (
            <Button type="link" size="small" onClick={() => activateMutation.mutate(record.id)}>
              设为当前
            </Button>
          )}
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除模型服务"
            description="删除后，当前路由到该服务的审计将回退到下一个启用的模型服务。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            模型服务
          </Typography.Title>
          <Typography.Text type="secondary">
            配置审计所用的 OpenAI 兼容接口，并切换当前生效的模型服务。
          </Typography.Text>
        </div>
        <Space className="page-head-actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void providersQuery.refetch()}
            loading={providersQuery.isFetching}
          >
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增模型服务
          </Button>
        </Space>
      </div>

      {providersQuery.isError && (
        <Alert
          type="error"
          showIcon
          title="无法加载模型服务"
          description={providersQuery.error?.message ?? "加载模型服务失败"}
          action={<Button onClick={() => void providersQuery.refetch()}>重试</Button>}
        />
      )}

      {!providersQuery.isError && providers.length === 0 && !providersQuery.isLoading ? (
        <Card>
          <Empty description="尚未配置模型服务">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增模型服务
            </Button>
          </Empty>
        </Card>
      ) : (
        <Table<LlmProvider>
          rowKey="id"
          columns={columns}
          dataSource={providers}
          loading={providersQuery.isLoading}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无模型服务" /> }}
        />
      )}

      <Drawer
        title={editing ? "编辑模型服务" : "新增模型服务"}
        open={drawerOpen}
        onClose={closeDrawer}
        size="min(560px, 100vw)"
        destroyOnHidden
        keyboard={!submitting}
        mask={{ closable: !submitting }}
        closable={!submitting}
        footer={
          <div className="drawer-footer">
            <Space>
              <Button onClick={closeDrawer} disabled={submitting}>
                取消
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                form="llm-provider-form"
                loading={submitting}
              >
                {editing ? "保存" : "创建"}
              </Button>
            </Space>
          </div>
        }
      >
        <Form<ProviderFormValues>
          id="llm-provider-form"
          form={form}
          layout="vertical"
          validateTrigger="onBlur"
          scrollToFirstError={{ focus: true }}
          initialValues={{ enabled: true, maxInput: 8192, maxOutput: 2048 }}
          onFinish={handleSubmit}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="例如 生产环境 GPT" disabled={submitting} />
          </Form.Item>

          <Form.Item
            label="接口地址"
            name="endpoint"
            extra="OpenAI 兼容的基础地址，通常以 /v1 结尾。"
            rules={[{ required: true, message: "请输入接口地址" }]}
          >
            <Input className="mono" placeholder="https://api.openai.com/v1" disabled={submitting} />
          </Form.Item>

          <Form.Item label="模型" required>
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="model" noStyle rules={[{ required: true, message: "请输入模型" }]}>
                <Input className="mono" placeholder="例如 gpt-4o-mini" disabled={submitting} />
              </Form.Item>
              <Button
                onClick={handleFetchModels}
                loading={modelsMutation.isPending}
                disabled={!canFetchModels || submitting}
              >
                获取模型列表
              </Button>
            </Space.Compact>
            {!editing && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                保存后可获取模型列表。
              </Typography.Text>
            )}
            {models.length > 0 && (
              <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
                {models.map((model) => (
                  <Tag
                    key={model}
                    color={selectedModel === model ? "blue" : undefined}
                    style={{ cursor: "pointer" }}
                    onClick={() => form.setFieldValue("model", model)}
                  >
                    {model}
                  </Tag>
                ))}
              </Space>
            )}
          </Form.Item>

          <Form.Item
            label="API Key"
            name="apiKey"
            extra={editing ? "留空表示保留已存储的密钥。" : "兼容接口不校验密钥时可留空。"}
          >
            <Input.Password
              autoComplete="off"
              placeholder={editing ? "留空保留现有密钥" : "sk-…"}
              disabled={submitting}
            />
          </Form.Item>

          <Form.Item label="最大输入 tokens" name="maxInput">
            <InputNumber min={1} style={{ width: "100%" }} disabled={submitting} />
          </Form.Item>

          <Form.Item label="最大输出 tokens" name="maxOutput">
            <InputNumber min={1} style={{ width: "100%" }} disabled={submitting} />
          </Form.Item>

          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch disabled={submitting} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
