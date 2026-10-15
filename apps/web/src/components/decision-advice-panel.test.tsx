import { expect, test } from "bun:test";
import type { DecisionAdvice } from "@contract-audit/audit/decision";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeDecisionConfidence,
  describeDecisionFallbackReason,
  describeDecisionListState,
  describeDecisionUncertainty,
  SHADOW_DISCLAIMER,
} from "../decision-presentation";
import { DecisionAdvicePanel } from "./decision-advice-panel";

/**
 * The S1 contract example, reproduced here because the shared fixture lives
 * outside `apps/web` and the package's tests must stay self-contained. It is a
 * clearly-labelled offline example (provider `fake`), never a live provider
 * response, and the values are identical to `tests/fixtures/decision/contract.ts`.
 */
const advice: DecisionAdvice = {
  decisionId: "00000000-0000-4000-8000-000000000005",
  auditCaseId: "00000000-0000-4000-8000-000000000001",
  snapshotId: "00000000-0000-4000-8000-000000000002",
  agentRunId: "00000000-0000-4000-8000-000000000003",
  contractDocumentHash: "0".repeat(64),
  schemaVersion: 1,
  mode: "shadow",
  status: "SUCCEEDED",
  provider: "fake",
  modelVersion: "contract-example-v1",
  taskType: "review_routing",
  questionKey: "advance-review",
  questionVersion: "contract-example-v1",
  policyVersion: "contract-example-v1",
  redactionVersion: "contract-example-v1",
  answer: { type: "noul", noul: 1 },
  rawProbabilities: null,
  rawScore: 1,
  confidence: null,
  confidenceType: "none",
  calibrated: false,
  calibrationVersion: null,
  thresholdPolicyVersion: null,
  threshold: null,
  uncertainty: "uncalibrated",
  ruleConflicts: [],
  needsHumanReview: true,
  evidenceRefs: [],
  latencyMs: null,
  inputHash: "1".repeat(64),
  dataClassification: "SYNTHETIC",
  traceId: "contract-example-trace",
  fallbackReason: null,
  createdAt: "2026-10-15T00:00:00.000Z",
  completedAt: "2026-10-15T00:00:00.000Z",
};

/**
 * Behaviour tests for the shadow-advice panel, rendered against the S1 contract
 * example above — a clearly-labelled offline example, never a live provider
 * response. These prove the rendering rules the contract mandates: no
 * fabricated confidence, no shadow-as-formal-risk, and explicit empty/off states.
 */

test("the panel always states that a shadow advice cannot change the audit outcome", () => {
  const html = renderToStaticMarkup(
    <DecisionAdvicePanel
      list={{ mode: "shadow", provider: "fake", items: [advice] }}
      loading={false}
      error={null}
      onRefresh={() => undefined}
      detail={{ advice, feedback: [] }}
      detailLoading={false}
      detailError={null}
      onSelect={() => undefined}
      onSubmitFeedback={() => undefined}
      submittingFeedback={false}
      feedbackError={null}
      actor="我"
    />,
  );
  expect(html).toContain(SHADOW_DISCLAIMER);
  expect(html).toContain("影子建议不能确认风险");
});

test("an uncalibrated advice never renders a percentage as accuracy", () => {
  const confidence = describeDecisionConfidence(advice);
  expect(confidence.label).toBe("未经校准");
  expect(confidence.detail).toContain("不能作为准确率");
  expect(confidence.hasThreshold).toBe(false);

  const uncertainty = describeDecisionUncertainty(advice);
  expect(uncertainty.label).toBe("未经校准");
});

test("a null confidence and null latency stay absent rather than becoming zero", () => {
  const html = renderToStaticMarkup(
    <DecisionAdvicePanel
      list={{ mode: "shadow", provider: "fake", items: [advice] }}
      loading={false}
      error={null}
      onRefresh={() => undefined}
      detail={{ advice, feedback: [] }}
      detailLoading={false}
      detailError={null}
      onSelect={() => undefined}
      onSubmitFeedback={() => undefined}
      submittingFeedback={false}
      feedbackError={null}
      actor="我"
    />,
  );
  // A missing latency reads as "not recorded", never as a zero duration.
  expect(html).toContain("未记录");
  expect(html).not.toContain("0 ms");
  // No confidence figure is rendered at all: the fixture carries none, so any
  // percentage in the panel's visible text would be fabricated. Tags and
  // attributes are stripped first, because Ant Design's own inline styles
  // legitimately contain "%" in calc() expressions.
  const body = html.slice(html.indexOf("decision-detail__body"));
  const visibleText = body.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ");
  expect(visibleText).not.toContain("%");
});

test("a mode-off list explains itself instead of rendering an empty panel", () => {
  const state = describeDecisionListState({ mode: "off", provider: "disabled", items: [] });
  expect(state.empty).toBe(true);
  expect(state.reason).toContain("影子模式未开启");
});

test("an enabled-but-empty list is distinguished from a disabled one", () => {
  const disabled = describeDecisionListState({ mode: "off", provider: "disabled", items: [] });
  const empty = describeDecisionListState({ mode: "shadow", provider: "fake", items: [] });
  expect(disabled.reason).not.toBe(empty.reason);
  expect(empty.reason).toContain("暂无影子建议记录");
});

test("a known failure reason is translated, an unknown one is shown verbatim", () => {
  expect(describeDecisionFallbackReason("provider_timeout")).toContain("超时");
  expect(describeDecisionFallbackReason("MODEL_DATA_OUTBOUND_FORBIDDEN")).toBe(
    "MODEL_DATA_OUTBOUND_FORBIDDEN",
  );
  expect(describeDecisionFallbackReason(null)).toBeNull();
});

test("an in-flight advice shows no answer and no feedback control", () => {
  const pending = { ...advice, status: "PENDING" as const, answer: null };
  const html = renderToStaticMarkup(
    <DecisionAdvicePanel
      list={{ mode: "shadow", provider: "fake", items: [pending] }}
      loading={false}
      error={null}
      onRefresh={() => undefined}
      detail={{ advice: pending, feedback: [] }}
      detailLoading={false}
      detailError={null}
      onSelect={() => undefined}
      onSubmitFeedback={() => undefined}
      submittingFeedback={false}
      feedbackError={null}
      actor="我"
    />,
  );
  expect(html).toContain("该建议仍在执行，尚未产生答案");
  expect(html).not.toContain("提交评估反馈");
});

test("the offline Fake provider is labelled as a demo, not as a live model", () => {
  const html = renderToStaticMarkup(
    <DecisionAdvicePanel
      list={{ mode: "shadow", provider: "fake", items: [advice] }}
      loading={false}
      error={null}
      onRefresh={() => undefined}
      detail={{ advice, feedback: [] }}
      detailLoading={false}
      detailError={null}
      onSelect={() => undefined}
      onSubmitFeedback={() => undefined}
      submittingFeedback={false}
      feedbackError={null}
      actor="我"
    />,
  );
  expect(html).toContain("离线演示（Fake）");
});
