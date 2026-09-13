import { ENGINE_RULE_CODES } from "@contract-audit/audit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { App as AntApp, Form, Input, Modal, Select } from "antd";
import { useState } from "react";
import { createRule, disableRule, enableRule, listRules } from "../api";
import { RuleTable } from "../components/rule-table";
import type { RuleFilters } from "../rule-presentation";

interface NewRuleFormValues {
  code: string;
  name: string;
  contractType: string;
  description?: string;
}

const EMPTY_STANCES = {
  preferred: "",
  acceptableRetreat: "",
  unacceptable: "",
  exceptionApproval: "",
};

/** 规则管理: the rule index, with search/filters and a create modal. */
export default function RulesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState<RuleFilters>({
    search: "",
    status: "ALL",
    contractType: "ALL",
  });
  const [form] = Form.useForm<NewRuleFormValues>();

  const rulesQuery = useQuery({ queryKey: ["rules"], queryFn: listRules });

  const createMutation = useMutation({
    mutationFn: createRule,
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
      message.success("规则已创建");
      setCreateOpen(false);
      form.resetFields();
      void navigate({ to: "/rules/$id", params: { id: detail.rule.id } });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => disableRule(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
      message.success("规则已停用");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const enableMutation = useMutation({
    mutationFn: enableRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
      message.success("规则已启用");
    },
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <>
      <RuleTable
        rules={rulesQuery.data ?? []}
        loading={rulesQuery.isLoading}
        refreshing={rulesQuery.isFetching}
        error={rulesQuery.isError ? rulesQuery.error : null}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={() => void rulesQuery.refetch()}
        onCreate={() => setCreateOpen(true)}
        onOpen={(id) => void navigate({ to: "/rules/$id", params: { id } })}
        onDisable={(id, reason) => disableMutation.mutate({ id, reason })}
        onEnable={(id) => enableMutation.mutate(id)}
      />

      <Modal
        title="新建规则"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form<NewRuleFormValues>
          form={form}
          layout="vertical"
          initialValues={{ contractType: "全部", description: "" }}
          onFinish={(values) =>
            createMutation.mutate({
              code: values.code.trim(),
              name: values.name.trim(),
              contractType: values.contractType.trim(),
              description: values.description?.trim() ?? "",
              params: {},
              stances: EMPTY_STANCES,
            })
          }
        >
          <Form.Item
            name="name"
            label="规则名"
            rules={[{ required: true, message: "请输入规则名" }]}
          >
            <Input placeholder="例如 预付款上限规则" />
          </Form.Item>
          <Form.Item
            name="code"
            label="规则代码"
            rules={[{ required: true, message: "请选择规则代码" }]}
          >
            <Select
              className="mono"
              placeholder="选择引擎规则代码"
              showSearch
              options={ENGINE_RULE_CODES.map((code) => ({
                value: code,
                label: code,
                disabled: (rulesQuery.data ?? []).some((rule) => rule.code === code),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="contractType"
            label="适用合同类型"
            rules={[{ required: true, message: "请输入适用合同类型" }]}
          >
            <Input placeholder="例如 采购类；不区分则填写 全部" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="这条规则审查什么，以及触发条件" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
