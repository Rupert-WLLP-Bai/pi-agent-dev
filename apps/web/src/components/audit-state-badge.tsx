import { getAuditDisplayState } from "../audit-presentation";

export function AuditStateBadge({ auditCase }: { auditCase: { status: string; stage: string } }) {
  const { label, tone } = getAuditDisplayState(auditCase);
  return (
    <span className={`audit-state-badge audit-state-badge--${tone}`}>
      <span aria-hidden="true" className="audit-state-badge__dot" />
      {label}
    </span>
  );
}
