import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { RemediationBoard, RemediationCard } from "@contract-audit/api";
import type { RemediationStatus } from "@contract-audit/audit/model";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Result,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import type { AuditTone } from "../audit-presentation";
import { shortAuditId } from "../audit-presentation";
import {
  describeAdvance,
  formatRemediationDue,
  formatRemediationSummary,
  remediationColumnFlags,
  remediationSeverityLabels,
  remediationSeverityTones,
  remediationStatusLabels,
  remediationStatusTones,
} from "../remediation-presentation";

export interface RemediationUpdateRequest {
  owner?: string | null;
  dueAt?: string | null;
  progressNote?: string | null;
  status?: "in_progress" | "awaiting_review";
}

export interface RemediationBoardProps {
  board: RemediationBoard | undefined;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  updating: boolean;
  onRefresh: () => void;
  onUpdate: (id: string, input: RemediationUpdateRequest) => void;
  /** Rejects with the API's reason when the close is refused. */
  onClose: (id: string, closedBy: string) => Promise<void>;
  onOpenCase: (caseId: string) => void;
}

const toneColors: Record<AuditTone, string> = {
  neutral: "default",
  info: "blue",
  warning: "orange",
  danger: "red",
  success: "green",
};

/** `YYYY-MM-DD` (a date input's value) → the ISO instant the API stores. */
const dueDraftToIso = (value: string): string | null =>
  value.trim() === "" ? null : new Date(`${value}T00:00:00`).toISOString();

/** The `YYYY-MM-DD` a date input shows for a stored instant, read in local time. */
const dueDraftFromCard = (card: RemediationCard): string => {
  if (card.dueAt === null) return "";
  const due = new Date(card.dueAt);
  const month = String(due.getMonth() + 1).padStart(2, "0");
  const day = String(due.getDate()).padStart(2, "0");
  return `${due.getFullYear()}-${month}-${day}`;
};

export function RemediationKanban({
  board,
  loading,
  refreshing,
  error,
  updating,
  onRefresh,
  onUpdate,
  onClose,
  onOpenCase,
}: RemediationBoardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const now = Date.now();
  const cards = board?.columns.flatMap((column) => column.items) ?? [];
  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const selectedStatus =
    board?.columns.find((column) => column.items.some((item) => item.id === selectedId))?.status ??
    null;

  // Seed the editors when a card is opened. Keyed on the id alone, so a refetch
  // that follows a save does not overwrite what the operator is still typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeding is an intentional one-shot on open; drafts are the source of truth afterwards.
  useEffect(() => {
    if (selectedId === null) return;
    const card = cards.find((item) => item.id === selectedId);
    if (!card) return;
    setOwnerDraft(card.owner ?? "");
    setDueDraft(dueDraftFromCard(card));
    setNoteDraft("");
    setReviewer("");
    setCloseError(null);
  }, [selectedId]);

  const initialLoading = loading && board === undefined;
  const initialError = error !== null && board === undefined && !loading;

  const saveDraft = () => {
    if (selected === null) return;
    onUpdate(selected.id, {
      owner: ownerDraft.trim() === "" ? null : ownerDraft.trim(),
      dueAt: dueDraftToIso(dueDraft),
      progressNote: noteDraft.trim() === "" ? null : noteDraft.trim(),
    });
  };

  const advance = () => {
    if (selected === null || selectedStatus === null) return;
    const { next } = describeAdvance(selectedStatus);
    if (next !== "in_progress" && next !== "awaiting_review") return;
    onUpdate(selected.id, { status: next });
  };

  const confirmClose = async () => {
    if (selected === null) return;
    setClosing(true);
    setCloseError(null);
    try {
      await onClose(selected.id, reviewer.trim());
      setCloseOpen(false);
      setSelectedId(null);
    } catch (closeFailure) {
      setCloseError(closeFailure instanceof Error ? closeFailure.message : "关闭整改项失败");
    } finally {
      setClosing(false);
    }
  };

  const advanceState = selectedStatus === null ? null : describeAdvance(selectedStatus);
  const selfClose = selected !== null && selected.owner !== null && reviewer.trim() === selected.owner;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            整改跟踪
          </Typography.Title>
          <Typography.Text type="secondary">
            看板只用于阶段流转；打开卡片查看详情，关闭需由复核人确认。
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
          刷新
        </Button>
      </div>

      {initialLoading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : initialError ? (
        <Result
          status="error"
          title="无法加载整改看板"
          subTitle={error?.message}
          extra={
            <Button type="primary" onClick={onRefresh}>
              重新加载
            </Button>
          }
        />
      ) : board === undefined || board.total === 0 ? (
        <Card>
          <Empty description="暂无整改项：在复核中心确认风险后会自动生成" />
        </Card>
      ) : (
        <div className="remediation-board">
          {board.columns.map((column) => (
            <div key={column.status} className="remediation-column">
              <div className="remediation-column__head">
                <span
                  className={`remediation-flag remediation-flag--${remediationStatusTones[column.status]}`}
                  aria-hidden="true"
                />
                <span className="remediation-column__title">
                  {remediationStatusLabels[column.status]}
                </span>
                <span className="remediation-column__count">{column.count}</span>
                <span className="remediation-column__note">
                  {remediationColumnFlags[column.status]}
                </span>
              </div>
              <div className="remediation-column__cards">
                {column.items.length === 0 ? (
                  <div className="remediation-column__empty">暂无</div>
                ) : (
                  column.items.map((card) => {
                    const due = formatRemediationDue(card, column.status, now);
                    return (
                      <button
                        type="button"
                        key={card.id}
                        className="remediation-card"
                        data-case-id={card.caseId}
                        onClick={() => setSelectedId(card.id)}
                      >
                        <span className="remediation-card__title">{card.contractTitle}</span>
                        <span className="remediation-card__summary">
                          {formatRemediationSummary(card.summary)}
                        </span>
                        <span className="remediation-card__meta">
                          <Tag color={toneColors[remediationSeverityTones[card.severity]]}>
                            {remediationSeverityLabels[card.severity]}
                          </Tag>
                          <span className="remediation-card__owner">
                            {card.owner ?? "未指派责任人"}
                          </span>
                        </span>
                        <span
                          className={
                            due.overdue
                              ? "remediation-due remediation-due--overdue"
                              : "remediation-due"
                          }
                        >
                          {due.overdue ? (
                            <WarningOutlined aria-hidden="true" />
                          ) : (
                            <ClockCircleOutlined aria-hidden="true" />
                          )}
                          {due.label}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Drawer
        title="整改项详情"
        width={480}
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        destroyOnHidden
      >
        {selected !== null && selectedStatus !== null && (
          <div className="remediation-drawer">
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="合同名称">{selected.contractTitle}</Descriptions.Item>
              <Descriptions.Item label="风险摘要">{selected.summary}</Descriptions.Item>
              <Descriptions.Item label="风险等级">
                <Tag color={toneColors[remediationSeverityTones[selected.severity]]}>
                  {remediationSeverityLabels[selected.severity]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="当前状态">
                <Tag color={toneColors[remediationStatusTones[selectedStatus]]}>
                  {remediationStatusLabels[selectedStatus]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="审计案件">
                <span className="mono">{shortAuditId(selected.caseId)}</span>
              </Descriptions.Item>
            </Descriptions>

            <div className="remediation-editor">
              <label htmlFor="remediation-owner">责任人</label>
              <Input
                id="remediation-owner"
                value={ownerDraft}
                maxLength={32}
                placeholder="填写责任人姓名"
                onChange={(event) => setOwnerDraft(event.target.value)}
              />
              <label htmlFor="remediation-due">截止时间</label>
              <Input
                id="remediation-due"
                type="date"
                value={dueDraft}
                onChange={(event) => setDueDraft(event.target.value)}
              />
              <label htmlFor="remediation-note">进度说明</label>
              <Input.TextArea
                id="remediation-note"
                value={noteDraft}
                rows={3}
                maxLength={500}
                placeholder="记录整改过程中的进展或阻塞"
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <Button onClick={saveDraft} loading={updating}>
                保存
              </Button>
            </div>

            <Space wrap className="remediation-actions">
              <Tooltip
                title={
                  advanceState?.next === null
                    ? "待复核阶段请使用关闭操作；已关闭的整改项不可再流转"
                    : undefined
                }
              >
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  disabled={advanceState === null || advanceState.next === null}
                  loading={updating}
                  onClick={advance}
                >
                  {advanceState?.label ?? "推进"}
                </Button>
              </Tooltip>
              {selectedStatus === "awaiting_review" && (
                <Button
                  danger
                  icon={<CheckCircleOutlined />}
                  onClick={() => {
                    setReviewer("");
                    setCloseError(null);
                    setCloseOpen(true);
                  }}
                >
                  关闭整改项
                </Button>
              )}
              <Button icon={<LinkOutlined />} onClick={() => onOpenCase(selected.caseId)}>
                打开审计案件
              </Button>
            </Space>
          </div>
        )}
      </Drawer>

      <Modal
        title="关闭整改项 — 复核人确认"
        open={closeOpen}
        okText="确认关闭"
        okButtonProps={{ danger: true, disabled: reviewer.trim() === "" }}
        confirmLoading={closing}
        onCancel={() => setCloseOpen(false)}
        onOk={() => void confirmClose()}
      >
        <Typography.Paragraph type="secondary">
          关闭表示复核人已确认整改完成。责任人不能自行关闭。
        </Typography.Paragraph>
        {selfClose && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="复核人与责任人为同一人"
            description="责任人不能自行关闭；请由另一位复核人确认。"
          />
        )}
        {closeError !== null && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={closeError} />
        )}
        <Input
          aria-label="复核人"
          value={reviewer}
          maxLength={32}
          placeholder="填写复核人姓名"
          onChange={(event) => setReviewer(event.target.value)}
        />
      </Modal>
    </section>
  );
}
