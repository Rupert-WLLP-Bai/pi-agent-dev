import type {
  DecisionAdvice,
  DecisionAdviceList,
  DecisionFeedback,
} from "@contract-audit/audit/decision";
import { Alert, Button, Descriptions, Empty, Segmented, Skeleton, Space, Tag, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { getRuleCodeLabel } from "../audit-presentation";
import {
  canSubmitDecisionFeedback,
  DECISION_IN_FLIGHT_STATUSES,
  decisionDataClassificationLabels,
  decisionFeedbackLabels,
  decisionModeLabels,
  decisionProviderLabels,
  decisionStatusLabels,
  decisionTaskTypeLabels,
  describeDecisionAnswer,
  describeDecisionConfidence,
  describeDecisionConflicts,
  describeDecisionEvidence,
  describeDecisionFallbackReason,
  describeDecisionListState,
  describeDecisionProvider,
  describeDecisionUncertainty,
  describeRawProbabilities,
  SHADOW_DISCLAIMER,
} from "../decision-presentation";

/**
 * 辅助决策（影子建议）面板.
 *
 * The component renders whatever the server recorded — an empty list, a
 * disabled mode, a pending/failed/skipped advice, an uncalibrated confidence —
 * and never upgrades a shadow answer into a formal risk. Every feedback control
 * is labelled as evaluation-only.
 *
 * Shapes come from the frozen canonical DTOs, so the props are those types
 * rather than a hand-copied second contract.
 */

export interface DecisionListState {
  mode: DecisionAdviceList["mode"];
  provider: DecisionAdviceList["provider"];
  items: DecisionAdvice[];
}

export interface DecisionDetailState {
  advice: DecisionAdvice;
  feedback: DecisionFeedback[];
}

export interface DecisionAdvicePanelProps {
  /** `undefined` while the list is loading; the panel shows a skeleton. */
  list: DecisionListState | undefined;
  loading: boolean;
  error: Error | null;
  onRefresh: () => void;
  /** The loaded detail for the selected advice; `undefined` while loading. */
  detail: DecisionDetailState | undefined;
  detailLoading: boolean;
  detailError: Error | null;
  onSelect: (decisionId: string) => void;
  onSubmitFeedback: (
    decisionId: string,
    decision: DecisionFeedback["decision"],
    reason: string,
  ) => void;
  submittingFeedback: boolean;
  feedbackError: Error | null;
  /** The name recorded as the feedback actor. */
  actor: string;
}

const statusTone = (status: DecisionAdvice["status"]): string => {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "SKIPPED") return "neutral";
  if (DECISION_IN_FLIGHT_STATUSES[status] === true) return "info";
  return "warning";
};

const tagColor = (tone: "neutral" | "warning" | "info"): string =>
  tone === "warning" ? "orange" : tone === "info" ? "blue" : "default";

const formatTime = (value: string | null): string =>
  value === null ? "-" : new Date(value).toLocaleString("zh-CN", { hour12: false });

/** The confidence metric named, never rendered as a bare success rate. */
function confidenceTypeLabel(advice: DecisionAdvice): string {
  if (advice.confidenceType === "laya_entropy_concentration") return "Laya 熵集中度";
  if (advice.confidenceType === "answer_confidence") return "答案自评分";
  return "无置信度";
}

export function DecisionAdvicePanel({
  list,
  loading,
  error,
  onRefresh,
  detail,
  detailLoading,
  detailError,
  onSelect,
  onSubmitFeedback,
  submittingFeedback,
  feedbackError,
  actor,
}: DecisionAdvicePanelProps) {
  const [feedbackChoice, setFeedbackChoice] = useState<DecisionFeedback["decision"]>("accepted");
  const [feedbackReason, setFeedbackReason] = useState("");

  const state = useMemo(
    () => (list === undefined ? { empty: true, reason: "" } : describeDecisionListState(list)),
    [list],
  );

  const selected = detail?.advice ?? null;

  if (loading && list === undefined) {
    return (
      <section className="decision-panel" aria-busy="true">
        <Skeleton active paragraph={{ rows: 4 }} />
      </section>
    );
  }

  if (error !== null && list === undefined) {
    return (
      <section className="decision-panel">
        <Empty description="无法加载辅助建议">
          <Space>
            <span className="decision-note">{error.message}</span>
            <Button type="primary" onClick={onRefresh}>
              重新加载
            </Button>
          </Space>
        </Empty>
      </section>
    );
  }

  return (
    <section className="decision-panel">
      <header className="decision-panel__head">
        <div>
          <h3>辅助决策（影子建议）</h3>
          <p className="decision-note">
            {list === undefined
              ? ""
              : `模式 ${decisionModeLabels[list.mode]} · 提供方 ${decisionProviderLabels[list.provider]}`}
          </p>
        </div>
        <Button onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      </header>

      <Alert
        type="info"
        showIcon
        title={SHADOW_DISCLAIMER}
        description="影子建议不能确认风险、判定误报或替代人工复核；风险确认请回到审查工作区。"
      />

      {state.empty ? (
        <Empty description={state.reason} />
      ) : (
        <div className="decision-body">
          <ul className="decision-list">
            {(list?.items ?? []).map((item) => (
              <li key={item.decisionId}>
                <button
                  type="button"
                  className={
                    selected?.decisionId === item.decisionId
                      ? "decision-list__item active"
                      : "decision-list__item"
                  }
                  aria-current={selected?.decisionId === item.decisionId}
                  onClick={() => onSelect(item.decisionId)}
                >
                  <Space size={6} wrap>
                    <Tag color={statusTone(item.status)}>{decisionStatusLabels[item.status]}</Tag>
                    <Tag>{decisionTaskTypeLabels[item.taskType]}</Tag>
                    <span className="decision-list__time">{formatTime(item.createdAt)}</span>
                  </Space>
                </button>
              </li>
            ))}
          </ul>

          <div className="decision-detail">
            {detailLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : detailError !== null ? (
              <Empty description={`无法加载建议详情：${detailError.message}`} />
            ) : selected === null ? (
              <Empty description="选择左侧一条建议查看详情" />
            ) : (
              <DecisionDetailBody
                advice={selected}
                feedback={detail?.feedback ?? []}
                feedbackChoice={feedbackChoice}
                feedbackReason={feedbackReason}
                onFeedbackChoice={setFeedbackChoice}
                onFeedbackReason={setFeedbackReason}
                onSubmit={() => {
                  onSubmitFeedback(selected.decisionId, feedbackChoice, feedbackReason);
                }}
                submitting={submittingFeedback}
                feedbackError={feedbackError}
                actor={actor}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DecisionDetailBody({
  advice,
  feedback,
  feedbackChoice,
  feedbackReason,
  onFeedbackChoice,
  onFeedbackReason,
  onSubmit,
  submitting,
  feedbackError,
  actor,
}: {
  advice: DecisionAdvice;
  feedback: DecisionFeedback[];
  feedbackChoice: DecisionFeedback["decision"];
  feedbackReason: string;
  onFeedbackChoice: (value: DecisionFeedback["decision"]) => void;
  onFeedbackReason: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  feedbackError: Error | null;
  actor: string;
}) {
  const answer = describeDecisionAnswer(advice);
  const probabilities = describeRawProbabilities(advice.rawProbabilities);
  const conflicts = describeDecisionConflicts(advice, getRuleCodeLabel);
  const evidence = describeDecisionEvidence(advice);
  const fallback = describeDecisionFallbackReason(advice.fallbackReason);
  const inFlight = DECISION_IN_FLIGHT_STATUSES[advice.status] === true;
  const confidence = describeDecisionConfidence(advice);
  const uncertainty = describeDecisionUncertainty(advice);

  return (
    <div className="decision-detail__body">
      <Descriptions
        size="small"
        column={2}
        items={[
          {
            key: "provider",
            label: "来源",
            children: describeDecisionProvider(advice),
          },
          {
            key: "task",
            label: "任务类型",
            children: decisionTaskTypeLabels[advice.taskType],
          },
          {
            key: "status",
            label: "状态",
            children: decisionStatusLabels[advice.status],
          },
          {
            key: "classification",
            label: "数据分级",
            children:
              decisionDataClassificationLabels[advice.dataClassification] ??
              advice.dataClassification,
          },
          {
            key: "latency",
            label: "耗时",
            children: advice.latencyMs === null ? "未记录" : `${advice.latencyMs} ms`,
          },
          {
            key: "trace",
            label: "Trace ID",
            children: advice.traceId,
          },
        ]}
      />

      <div className="decision-block">
        <h4>问题</h4>
        <p>
          问题编号 <span className="mono">{advice.questionKey}</span>
        </p>
        <p className="decision-note">
          问题文本与选项来自服务端受控目录，随请求冻结；此处只显示本次使用的编号与版本（
          {advice.questionVersion}）。
        </p>
      </div>

      <div className="decision-block">
        <h4>建议答案</h4>
        {inFlight ? (
          <p className="decision-note">该建议仍在执行，尚未产生答案。</p>
        ) : answer.text === null ? (
          <p className="decision-note">该次执行未产生答案。</p>
        ) : (
          <p className="decision-answer">
            {answer.text}
            {answer.kind === "score" && <span className="decision-note">（评分，非概率）</span>}
          </p>
        )}
        {probabilities.length > 0 && (
          <ul className="decision-probabilities">
            {probabilities.map((entry) => (
              <li key={entry.key}>
                {entry.key} <b>{entry.value}</b>
              </li>
            ))}
          </ul>
        )}
        {fallback !== null && (
          <Alert type="warning" showIcon title="未产出建议" description={fallback} />
        )}
      </div>

      <div className="decision-block">
        <h4>置信与校准</h4>
        <Space size={6} wrap>
          <Tag color={tagColor(confidence.tone)}>{confidence.label}</Tag>
          <Tag color={tagColor(uncertainty.tone)}>{uncertainty.label}</Tag>
          {advice.confidence !== null && advice.confidenceType !== "none" && (
            <Tooltip title={confidence.detail}>
              <span className="decision-confidence-value">
                {confidenceTypeLabel(advice)} {advice.confidence}
              </span>
            </Tooltip>
          )}
        </Space>
        <p className="decision-note">{confidence.detail}</p>
      </div>

      <div className="decision-block">
        <h4>同命题分歧（{conflicts.length}）</h4>
        {conflicts.length === 0 ? (
          <p className="decision-note">未发现与规则判断同命题的分歧。</p>
        ) : (
          conflicts.map((conflict) => (
            <div key={conflict.key} className="decision-conflict">
              <b>{conflict.headline}</b>
              <p>{conflict.detail}</p>
            </div>
          ))
        )}
      </div>

      <div className="decision-block">
        <h4>证据引用（{evidence.count}）</h4>
        {evidence.count === 0 ? (
          <p className="decision-note">该建议没有引用证据锚点。</p>
        ) : (
          <ul className="decision-evidence">
            {evidence.blocks.map((block) => (
              <li key={block.key}>{block.text}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="decision-block">
        <h4>人工复核提示</h4>
        <Tag color={advice.needsHumanReview ? "orange" : "default"}>
          {advice.needsHumanReview ? "建议人工复核" : "未要求人工复核"}
        </Tag>
        <p className="decision-note">该提示只作用于影子通道，不改变正式复核流程。</p>
      </div>

      <div className="decision-block">
        <h4>评估反馈</h4>
        <p className="decision-note">
          反馈仅用于评估影子通道质量，不改变审计结论、风险发现或人工复核记录。当前记录人：{actor}。
        </p>
        {!canSubmitDecisionFeedback(advice) ? (
          <p className="decision-note">该建议尚未结束，暂不可评估。</p>
        ) : (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Segmented
              options={[
                { value: "accepted", label: decisionFeedbackLabels.accepted },
                { value: "rejected", label: decisionFeedbackLabels.rejected },
                { value: "needs_review", label: decisionFeedbackLabels.needs_review },
              ]}
              value={feedbackChoice}
              onChange={(value) => onFeedbackChoice(value as DecisionFeedback["decision"])}
            />
            <label className="decision-feedback-label" htmlFor="decision-feedback-reason">
              理由（选填）
            </label>
            <textarea
              id="decision-feedback-reason"
              className="decision-feedback-reason"
              rows={2}
              maxLength={500}
              value={feedbackReason}
              onChange={(event) => onFeedbackReason(event.target.value)}
            />
            <Button type="primary" loading={submitting} onClick={onSubmit}>
              提交评估反馈
            </Button>
            {feedbackError !== null && (
              <Alert type="error" showIcon title={feedbackError.message} />
            )}
          </Space>
        )}
        {feedback.length > 0 && (
          <ul className="decision-feedback-list">
            {feedback.map((item) => (
              <li key={item.id}>
                <Space size={6} wrap>
                  <Tag>{decisionFeedbackLabels[item.decision]}</Tag>
                  <span>{item.actor}</span>
                  <span className="decision-note">{formatTime(item.createdAt)}</span>
                  {item.reason !== null && <span>{item.reason}</span>}
                </Space>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
