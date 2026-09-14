import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type {
  AuditSnapshot,
  FindingRevision,
  RemediationStatus,
  RuleAssessment,
} from "@contract-audit/audit/model";
import type { RevisionFindingDiff } from "@contract-audit/audit/revision-finding-diff";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export interface AuditReportRemediationRow {
  summary: string;
  severity: string;
  status: RemediationStatus;
  owner: string | null;
  closureHint: "implemented" | "open" | "unknown" | null;
}

export interface AuditReportRevisionDiff {
  fromVersion: number;
  toVersion: number;
  diff: RevisionFindingDiff;
}

export interface AuditReportInput {
  caseId: string;
  contractTitle: string;
  status: string;
  snapshot: AuditSnapshot | null;
  findings: FindingRevision[];
  remediations: AuditReportRemediationRow[];
  revisionDiffs: AuditReportRevisionDiff[];
}

const dispositionLabel = (disposition: RuleAssessment["disposition"]): string => {
  if (disposition === "COMPLIANT") return "符合";
  if (disposition === "POLICY_CONFLICT") return "违反";
  return "需复核";
};

const remediationStatusLabel = (status: RemediationStatus): string => {
  if (status === "pending") return "待整改";
  if (status === "in_progress") return "整改中";
  if (status === "awaiting_review") return "待复核";
  return "已关闭";
};

const closureHintLabel = (hint: AuditReportRemediationRow["closureHint"]): string => {
  if (hint === "implemented") return "新版本规则评估：已落实";
  if (hint === "open") return "新版本规则评估：未落实";
  if (hint === "unknown") return "新版本规则评估：无法判定";
  return "（尚无新版本对照）";
};

const formatDiffPins = (pins: RevisionFindingDiff["introduced"], empty: string): string => {
  if (pins.length === 0) return empty;
  return pins.map((pin) => `${pin.ruleCode} · ${pin.severity}`).join("；");
};

export async function buildAuditReportDocx(input: AuditReportInput): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: "合同审查报告", heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun(`案件编号：${input.caseId}`)] }),
    new Paragraph({ children: [new TextRun(`合同：${input.contractTitle}`)] }),
    new Paragraph({ children: [new TextRun(`状态：${input.status}`)] }),
    new Paragraph({ text: "规则覆盖面", heading: HeadingLevel.HEADING_1 }),
  ];

  if (input.snapshot) {
    for (const assessment of input.snapshot.ruleAssessments) {
      children.push(
        new Paragraph({
          children: [
            new TextRun(
              `${assessment.ruleCode} · ${dispositionLabel(assessment.disposition)} · ${assessment.basis}`,
            ),
          ],
        }),
      );
    }
    children.push(new Paragraph({ text: "发现与证据", heading: HeadingLevel.HEADING_1 }));
    for (const finding of input.findings) {
      const evidence = finding.proposal.evidenceIds
        .map((id) => input.snapshot?.evidence.find((item) => item.id === id))
        .filter((item) => item !== undefined);
      const quotes = evidence
        .map((item) =>
          item.location.kind === "DOCUMENT_SPAN" ? item.location.quotedText : item.location.kind,
        )
        .join("；");
      children.push(
        new Paragraph({
          text: getFindingTypeLabel(finding.proposal.findingType),
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ children: [new TextRun(`严重度：${finding.proposal.severity}`)] }),
        new Paragraph({ children: [new TextRun(`理由：${finding.proposal.rationale}`)] }),
        new Paragraph({ children: [new TextRun(`整改建议：${finding.proposal.remediation}`)] }),
        new Paragraph({ children: [new TextRun(`证据原文：${quotes || "（无引用）"}`)] }),
        new Paragraph({
          children: [
            new TextRun(
              finding.review
                ? `复核：${finding.review.decision}${finding.review.reason ? ` — ${finding.review.reason}` : ""}`
                : "复核：待处理",
            ),
          ],
        }),
      );
    }
  } else {
    children.push(new Paragraph({ children: [new TextRun("审计快照尚未生成。")] }));
  }

  children.push(new Paragraph({ text: "整改状态", heading: HeadingLevel.HEADING_1 }));
  if (input.remediations.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("无关联整改项。")] }));
  } else {
    for (const item of input.remediations) {
      children.push(
        new Paragraph({
          text: item.summary,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          children: [
            new TextRun(
              `${remediationStatusLabel(item.status)} · ${item.severity} · 责任人：${item.owner ?? "未指派"}`,
            ),
          ],
        }),
        new Paragraph({ children: [new TextRun(closureHintLabel(item.closureHint))] }),
      );
    }
  }

  if (input.revisionDiffs.length > 0) {
    children.push(new Paragraph({ text: "合同版本对比", heading: HeadingLevel.HEADING_1 }));
    for (const entry of input.revisionDiffs) {
      children.push(
        new Paragraph({
          text: `v${entry.fromVersion} → v${entry.toVersion}`,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          children: [new TextRun(`新增风险：${formatDiffPins(entry.diff.introduced, "无")}`)],
        }),
        new Paragraph({
          children: [new TextRun(`已消除：${formatDiffPins(entry.diff.resolved, "无")}`)],
        }),
        new Paragraph({
          children: [new TextRun(`遗留：${formatDiffPins(entry.diff.persisting, "无")}`)],
        }),
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
