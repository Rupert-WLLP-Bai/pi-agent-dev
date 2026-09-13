import { PlayCircleOutlined } from "@ant-design/icons";
import type {
  RuleListItem,
  ValidationCaseListItem,
  ValidationRunListItem,
  ValidationRunView,
} from "@contract-audit/api";
import { Alert, Button, Card, Empty, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { goldenCaseTypeLabels } from "../rule-presentation";
import {
  caseResultOutcome,
  describeRunMeta,
  movementDiffEntries,
  summarizeCaseCards,
  type ValidationCaseResult,
  validationCaseTypeLabels,
  validationChangeLabels,
  validationChangeTagColors,
  validationOutcomeLabels,
  validationOutcomeTagColors,
} from "../validation-presentation";

export interface ValidationCenterProps {
  rules: RuleListItem[];
  selectedRuleId: string | null;
  onSelectRule: (id: string) => void;
  cases: ValidationCaseListItem[];
  latestRun: ValidationRunListItem | null;
  runDetail: ValidationRunView | null;
  loading: boolean;
  detailLoading: boolean;
  running: boolean;
  error: Error | null;
  onRun: () => void;
}

/**
 * The results table: each row is a golden case, labelled with the catalog's
 * five-way type where one exists (a case that defers only inside the run's
 * three-way classification still reads as 证据缺失 here).
 */
const resultColumns = (
  caseTypeByName: Map<string, ValidationCaseListItem["caseType"]>,
): ColumnsType<ValidationCaseResult> => [
  { title: "案例", dataIndex: "caseName" },
  {
    title: "类型",
    dataIndex: "caseType",
    width: 100,
    render: (value: ValidationCaseResult["caseType"], record) => {
      const catalogType = caseTypeByName.get(record.caseName);
      return catalogType ? validationCaseTypeLabels[catalogType] : goldenCaseTypeLabels[value];
    },
  },
  {
    title: "结果",
    key: "outcome",
    width: 110,
    render: (_value, record) => {
      const outcome = caseResultOutcome(record);
      return (
        <Tag color={validationOutcomeTagColors[outcome]}>{validationOutcomeLabels[outcome]}</Tag>
      );
    },
  },
  { title: "差异说明", dataIndex: "note", render: (value: string) => value || "—" },
];

/**
 * 案例验证. Header picks a rule, cards summarise the five case shapes, and the
 * table shows what each case did in the newest run. The diff below names only
 * movement (regressions and fixes) — a first run has no baseline to compare.
 */
export function ValidationCenter({
  rules,
  selectedRuleId,
  onSelectRule,
  cases,
  latestRun,
  runDetail,
  loading,
  detailLoading,
  running,
  error,
  onRun,
}: ValidationCenterProps) {
  const cards = summarizeCaseCards(cases);
  const details = runDetail?.details ?? [];
  const movements = runDetail ? movementDiffEntries(runDetail.diff) : [];
  const caseTypeByName = new Map(cases.map((item) => [item.name, item.caseType]));

  return (
    <div className="page">
      <div className="page-head">
        <Space direction="vertical" size={2}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            案例验证
          </Typography.Title>
          <Typography.Text type="secondary">
            用正例、反例、边界例、历史误报和证据缺失案例守护规则质量。
          </Typography.Text>
        </Space>
        <div className="page-head-actions">
          <Select
            aria-label="选择规则"
            style={{ width: 260 }}
            value={selectedRuleId ?? undefined}
            placeholder="选择规则"
            options={rules.map((rule) => ({
              value: rule.id,
              label: `${rule.name}（${rule.code}）`,
            }))}
            onChange={onSelectRule}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            disabled={selectedRuleId === null}
            onClick={onRun}
          >
            按规则版本运行验证
          </Button>
        </div>
      </div>

      {error !== null && (
        <Alert type="error" showIcon message="加载验证数据失败" description={error.message} />
      )}

      <div className="queue-summary">
        {cards.map((card) => (
          <Card key={card.key} size="small" className="queue-summary-card info">
            <div>
              <b className="tnum">{card.total}</b>
              <span>{card.label}</span>
              <div className="validation-chips">
                {card.chips.map((chip) => (
                  <Tag key={chip.text} color={chip.tone === "default" ? undefined : chip.tone}>
                    {chip.text}
                  </Tag>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card size="small" className="validation-panel">
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary">{describeRunMeta(latestRun)}</Typography.Text>
          {cases.length === 0 ? (
            <Empty description="样本不足：该规则还没有验证案例" />
          ) : details.length === 0 ? (
            <Empty description={loading || detailLoading ? "正在加载验证结果" : "尚未运行验证"} />
          ) : (
            <Table<ValidationCaseResult>
              rowKey="caseName"
              size="small"
              loading={detailLoading}
              columns={resultColumns(caseTypeByName)}
              dataSource={details}
              pagination={false}
              scroll={{ x: "max-content" }}
            />
          )}
        </Space>
      </Card>

      <Card size="small" title="回归差异" className="validation-panel">
        {runDetail === null ? (
          <Typography.Text type="secondary">尚未运行验证。</Typography.Text>
        ) : runDetail.previous === null ? (
          <Typography.Text type="secondary">首次运行，无可比对的基线。</Typography.Text>
        ) : movements.length === 0 ? (
          <Typography.Text type="secondary">与上次运行一致，无回归差异。</Typography.Text>
        ) : (
          <Table<ValidationRunView["diff"][number]>
            rowKey="caseName"
            size="small"
            columns={[
              { title: "案例", dataIndex: "caseName" },
              {
                title: "此前",
                dataIndex: "previous",
                width: 100,
                render: (value: ValidationRunView["diff"][number]["previous"]) =>
                  value === null ? "—" : validationOutcomeLabels[value],
              },
              {
                title: "本次",
                dataIndex: "current",
                width: 100,
                render: (value: ValidationRunView["diff"][number]["current"]) =>
                  validationOutcomeLabels[value],
              },
              {
                title: "变化",
                dataIndex: "change",
                width: 110,
                render: (value: ValidationRunView["diff"][number]["change"]) => (
                  <Tag color={validationChangeTagColors[value]}>
                    {validationChangeLabels[value]}
                  </Tag>
                ),
              },
              { title: "说明", dataIndex: "note", render: (value: string) => value || "—" },
            ]}
            dataSource={movements}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Card>
    </div>
  );
}
