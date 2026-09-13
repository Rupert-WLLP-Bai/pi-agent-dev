import { DeleteOutlined, PlayCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { AuditActionLog, RuleDetail, ValidationRunRecord } from "@contract-audit/api";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import type { RuleParams } from "../rule-presentation";
import {
  describePublishGate,
  describeRuleIo,
  failedValidationCases,
  formatRuleTime,
  goldenCaseTypeLabels,
  parseParamValue,
  ruleActionLabels,
  ruleRuntimeLabels,
  ruleVersionStatusLabels,
  ruleVersionStatusTagColors,
  summarizeValidation,
  validationOutcomeText,
  validationRunStatusLabels,
  validationRunStatusTagColors,
} from "../rule-presentation";

type RuleStances = RuleDetail["versions"][number]["stances"];
type RuleVersion = RuleDetail["versions"][number];
type ValidationCaseResult = ValidationRunRecord["details"][number];

export interface RuleEditorProps {
  detail: RuleDetail;
  /** The most recent run this editor has observed, if any. */
  validationRun: ValidationRunRecord | null;
  /** The rule's governance trail, rendered read-only in 操作记录. */
  actions: AuditActionLog[];
  savingInfo: boolean;
  savingDraft: boolean;
  validating: boolean;
  publishing: boolean;
  onSaveInfo: (input: { name: string; contractType: string; description: string }) => void;
  onSaveDraft: (input: { params: RuleParams; stances: RuleStances }) => void;
  onValidate: () => void;
  onPublish: () => void;
}

interface ParamRow {
  key: string;
  value: string;
}

const rowsFromParams = (params: RuleParams): ParamRow[] =>
  Object.entries(params).map(([key, value]) => ({ key, value: String(value) }));

const paramsFromRows = (rows: ParamRow[]): RuleParams => {
  const params: RuleParams = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length > 0) params[key] = parseParamValue(row.value);
  }
  return params;
};

const EMPTY_STANCES: RuleStances = {
  preferred: "",
  acceptableRetreat: "",
  unacceptable: "",
  exceptionApproval: "",
};

const STANCE_FIELDS: Array<{ key: keyof RuleStances; label: string; hint: string }> = [
  { key: "preferred", label: "首选", hint: "最理想的条款立场" },
  { key: "acceptableRetreat", label: "可退让", hint: "可接受但需要审批的退让空间" },
  { key: "unacceptable", label: "不可接受", hint: "触碰即视为风险的底线" },
  { key: "exceptionApproval", label: "例外审批", hint: "突破底线所需的审批条件" },
];

/**
 * The five-zone rule editor. Basic info edits the rule; 审查逻辑 and 条款立场
 * edit the open draft's parameters and stances; 验证案例 runs the golden-set
 * gate; 发布记录 publishes a green draft and shows what came before.
 */
export function RuleEditor({
  detail,
  validationRun,
  actions,
  savingInfo,
  savingDraft,
  validating,
  publishing,
  onSaveInfo,
  onSaveDraft,
  onValidate,
  onPublish,
}: RuleEditorProps) {
  const source: RuleVersion | null = detail.activeDraft ?? detail.versions[0] ?? null;
  const sourceKey = source?.id ?? "";

  const [info, setInfo] = useState({
    name: detail.rule.name,
    contractType: detail.rule.contractType,
    description: detail.rule.description,
  });
  const [paramRows, setParamRows] = useState<ParamRow[]>(() =>
    source ? rowsFromParams(source.params) : [],
  );
  const [stances, setStances] = useState<RuleStances>(source?.stances ?? EMPTY_STANCES);

  if (!source) {
    return (
      <div className="page">
        <Empty description="该规则还没有任何版本" />
      </div>
    );
  }

  const gate = describePublishGate(detail);
  const io = describeRuleIo(detail.rule.code);
  const chips = summarizeValidation(
    validationRun?.summary ?? detail.draftValidationRun?.summary ?? null,
  );
  const failures = failedValidationCases(validationRun ?? detail.draftValidationRun);
  const latestRun = validationRun ?? detail.draftValidationRun;

  const failureColumns: ColumnsType<ValidationCaseResult> = [
    { title: "案例", dataIndex: "caseName" },
    {
      title: "类型",
      dataIndex: "caseType",
      width: 90,
      render: (value: ValidationCaseResult["caseType"]) => goldenCaseTypeLabels[value],
    },
    { title: "期望", dataIndex: "expected", width: 180 },
    { title: "实际", dataIndex: "actual", width: 180 },
    { title: "差异说明", dataIndex: "note" },
  ];

  const versionColumns: ColumnsType<RuleVersion> = [
    {
      title: "版本",
      key: "version",
      width: 90,
      render: (_value, record) => <span className="mono">v{record.version}</span>,
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_value, record) => (
        <Tag color={ruleVersionStatusTagColors[record.status]}>
          {ruleVersionStatusLabels[record.status]}
        </Tag>
      ),
    },
    {
      title: "发布人",
      key: "publishedBy",
      width: 140,
      render: (_value, record) => record.publishedBy ?? "—",
    },
    {
      title: "发布时间",
      key: "publishedAt",
      width: 190,
      render: (_value, record) => formatRuleTime(record.publishedAt) ?? "—",
    },
    {
      title: "最近验证",
      key: "validated",
      width: 120,
      render: (_value, record) =>
        record.id === sourceKey && latestRun ? (
          <Tag color={validationRunStatusTagColors[latestRun.status]}>
            {validationRunStatusLabels[latestRun.status]}
          </Tag>
        ) : (
          "—"
        ),
    },
  ];

  // The governance trail is read-only: it records what already happened, so
  // there is nothing to edit here.
  const actionColumns: ColumnsType<AuditActionLog> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 190,
      render: (value: string) => formatRuleTime(value) ?? "—",
    },
    {
      title: "操作",
      dataIndex: "action",
      width: 100,
      render: (value: string) => ruleActionLabels[value] ?? value,
    },
    { title: "操作人", dataIndex: "actor", width: 140 },
    {
      title: "原因",
      dataIndex: "reason",
      render: (value: string | null) => value ?? "—",
    },
  ];

  const logicTab = (
    <div className="rule-form">
      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          { key: "input", label: "确定性输入", children: <span className="mono">{io.input}</span> },
          {
            key: "output",
            label: "确定性输出",
            children: <span className="mono">{io.output}</span>,
          },
        ]}
      />
      <Typography.Text type="secondary">
        规则逻辑保持确定性 TypeScript；这里维护的是它读取的参数集。
      </Typography.Text>
      {paramRows.length === 0 && (
        <Typography.Text type="secondary">该规则没有参数。</Typography.Text>
      )}
      {paramRows.map((row, index) => (
        <div className="rule-param-row" key={row.key}>
          <Input
            className="mono"
            aria-label={`参数名 ${index + 1}`}
            placeholder="参数名，例如 limitRatio"
            value={row.key}
            onChange={(event) =>
              setParamRows((rows) =>
                rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item,
                ),
              )
            }
          />
          <Input
            className="mono"
            aria-label={`参数值 ${index + 1}`}
            placeholder="参数值，例如 0.3"
            value={row.value}
            onChange={(event) =>
              setParamRows((rows) =>
                rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item,
                ),
              )
            }
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label={`删除参数 ${index + 1}`}
            onClick={() =>
              setParamRows((rows) => rows.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        </div>
      ))}
      <Space>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setParamRows((rows) => [...rows, { key: "", value: "" }])}
        >
          添加参数
        </Button>
        <Button
          type="primary"
          loading={savingDraft}
          onClick={() => onSaveDraft({ params: paramsFromRows(paramRows), stances })}
        >
          保存
        </Button>
      </Space>
    </div>
  );

  const stanceTab = (
    <div className="rule-form">
      {STANCE_FIELDS.map((field) => (
        <div className="rule-field" key={field.key}>
          <Typography.Text strong>{field.label}</Typography.Text>
          <Input.TextArea
            aria-label={field.label}
            placeholder={field.hint}
            rows={2}
            value={stances[field.key]}
            onChange={(event) => setStances({ ...stances, [field.key]: event.target.value })}
          />
        </div>
      ))}
      <Button
        type="primary"
        loading={savingDraft}
        onClick={() => onSaveDraft({ params: paramsFromRows(paramRows), stances })}
      >
        保存
      </Button>
    </div>
  );

  const validationTab = (
    <div className="rule-form">
      <Space wrap>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={validating}
          onClick={onValidate}
        >
          按当前草稿运行验证
        </Button>
        {latestRun && (
          <Typography.Text type="secondary">
            最近运行 {formatRuleTime(latestRun.finishedAt) ?? "—"} ·{" "}
            {validationOutcomeText(latestRun.summary)}
          </Typography.Text>
        )}
      </Space>

      {chips.length > 0 ? (
        <div className="rule-chips">
          {chips.map((chip) => (
            <Tag key={chip.key} color={chip.tone === "error" ? "error" : "success"}>
              {chip.label}{" "}
              {chip.tone === "error"
                ? `${chip.failed} / ${chip.total} 失败`
                : `${chip.passed} / ${chip.total} 通过`}
            </Tag>
          ))}
        </div>
      ) : (
        <Typography.Text type="secondary">尚未运行验证。发布前必须通过案例验证。</Typography.Text>
      )}

      {failures.length > 0 && (
        <Table<ValidationCaseResult>
          rowKey="caseName"
          size="small"
          columns={failureColumns}
          dataSource={failures}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      )}
    </div>
  );

  const historyTab = (
    <div className="rule-form">
      <div className="rule-publish">
        <Tooltip title={gate.reason ?? undefined}>
          <span>
            <Button
              type="primary"
              disabled={!gate.enabled}
              loading={publishing}
              onClick={onPublish}
            >
              发布
            </Button>
          </span>
        </Tooltip>
        <Typography.Text type={gate.enabled ? "success" : "secondary"}>
          {gate.enabled ? "验证通过，可以发布当前草稿。" : gate.reason}
        </Typography.Text>
      </div>
      <Table<RuleVersion>
        rowKey="id"
        size="small"
        columns={versionColumns}
        dataSource={detail.versions}
        pagination={false}
        scroll={{ x: "max-content" }}
      />
    </div>
  );

  const actionsTab = (
    <div className="rule-form">
      {actions.length === 0 ? (
        <Typography.Text type="secondary">尚无操作记录。</Typography.Text>
      ) : (
        <Table<AuditActionLog>
          rowKey="id"
          size="small"
          columns={actionColumns}
          dataSource={actions}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      )}
    </div>
  );

  return (
    <div className="rule-form">
      <Tabs
        items={[
          {
            key: "info",
            label: "基础信息",
            children: (
              <div className="rule-form">
                <div className="rule-field">
                  <Typography.Text type="secondary">运行状态</Typography.Text>
                  <Space size={8} wrap>
                    <Tag color={detail.rule.enabled ? "success" : "default"}>
                      {detail.rule.enabled ? ruleRuntimeLabels.enabled : ruleRuntimeLabels.disabled}
                    </Tag>
                    {!detail.rule.enabled && (
                      <Typography.Text type="secondary">
                        {detail.rule.disabledReason
                          ? `停用原因：${detail.rule.disabledReason}`
                          : "未填写停用原因"}
                        {detail.rule.disabledBy ? ` · ${detail.rule.disabledBy}` : ""}
                        {detail.rule.disabledAt
                          ? ` · ${formatRuleTime(detail.rule.disabledAt) ?? ""}`
                          : ""}
                      </Typography.Text>
                    )}
                  </Space>
                </div>
                <div className="rule-field">
                  <Typography.Text type="secondary">规则代码</Typography.Text>
                  <Input className="mono" value={detail.rule.code} disabled />
                </div>
                <div className="rule-field">
                  <Typography.Text type="secondary">规则名</Typography.Text>
                  <Input
                    aria-label="规则名"
                    value={info.name}
                    onChange={(event) => setInfo({ ...info, name: event.target.value })}
                  />
                </div>
                <div className="rule-field">
                  <Typography.Text type="secondary">适用合同类型</Typography.Text>
                  <Input
                    aria-label="适用合同类型"
                    value={info.contractType}
                    onChange={(event) => setInfo({ ...info, contractType: event.target.value })}
                  />
                </div>
                <div className="rule-field">
                  <Typography.Text type="secondary">描述</Typography.Text>
                  <Input.TextArea
                    aria-label="描述"
                    rows={2}
                    value={info.description}
                    onChange={(event) => setInfo({ ...info, description: event.target.value })}
                  />
                </div>
                <Button type="primary" loading={savingInfo} onClick={() => onSaveInfo(info)}>
                  保存
                </Button>
              </div>
            ),
          },
          { key: "logic", label: "审查逻辑", children: logicTab },
          { key: "stances", label: "条款立场", children: stanceTab },
          { key: "validation", label: "验证案例", children: validationTab },
          { key: "history", label: "发布记录", children: historyTab },
          { key: "actions", label: "操作记录", children: actionsTab },
        ]}
      />

      <Alert
        className="rule-footnote"
        type="info"
        showIcon
        title="未来拓展"
        description="动态 DSL 规则（可视化配置条件表达式）是后续方向；当前版本保持「确定性 TypeScript 逻辑 + 版本化参数集」，以保证每次评估可复现、可回归。"
      />
    </div>
  );
}
