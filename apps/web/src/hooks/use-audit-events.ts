import { useEffect, useState } from "react";
import { getAuditEventsUrl } from "../api";

export type AuditConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

/**
 * Subscribe to the audit-case SSE stream. The callback receives the parsed
 * event payload so callers can filter — e.g. a trace viewer refetches on
 * `agent.trace` but a case-detail viewer does not, and vice-versa for
 * `finding.proposed`.
 */
export function useAuditEvents(
  id: string,
  onEvent: (event: { type: string }) => void,
  enabled: boolean,
): AuditConnectionState {
  const [state, setState] = useState<AuditConnectionState>("connecting");

  useEffect(() => {
    if (!enabled) return;

    setState("connecting");
    const events = new EventSource(getAuditEventsUrl(id));
    events.onopen = () => setState("connected");
    events.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as { type: string };
        onEvent(parsed);
      } catch {
        // The snapshot frame and malformed payloads are not trace events;
        // a no-op keeps the connection alive without spurious refetches.
      }
    };
    events.onerror = () => setState("reconnecting");
    return () => events.close();
  }, [enabled, id, onEvent]);

  return enabled ? state : "closed";
}
