import type { AuditCase } from "@contract-audit/audit/model";
import { getAuditDisplayState } from "../audit-presentation";

export function AuditStateBadge({ auditCase }: { auditCase: AuditCase }) {
  const { label, tone } = getAuditDisplayState(auditCase);
  return (
    <span className={`audit-state-badge audit-state-badge--${tone}`}>
      <span aria-hidden="true" className="audit-state-badge__dot" />
      {label}
    </span>
  );
}
