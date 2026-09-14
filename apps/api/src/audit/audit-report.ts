import { getFindingTypeLabel } from "@contract-audit/audit/finding-labels";
import type { AuditSnapshot, FindingRevision, RuleAssessment } from "@contract-audit/audit/model";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export interface AuditReportInput {
  caseId: string;
  contractTitle: string;
  status: string;
  snapshot: AuditSnapshot | null;
  findings: FindingRevision[];
}

const dispositionLabel = (disposition: RuleAssessment["disposition"]): string => {
  if (disposition === "COMPLIANT") return "符合";
  if (disposition === "POLICY_CONFLICT") return "违反";
  return "需复核";
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

  const doc = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
