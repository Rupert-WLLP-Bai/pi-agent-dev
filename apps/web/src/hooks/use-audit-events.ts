import { useEffect, useState } from "react";
import { getAuditEventsUrl } from "../api";

export type AuditConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export function useAuditEvents(
  id: string,
  onEvent: () => void,
  enabled: boolean,
): AuditConnectionState {
  const [state, setState] = useState<AuditConnectionState>("connecting");

  useEffect(() => {
    if (!enabled) return;

    setState("connecting");
    const events = new EventSource(getAuditEventsUrl(id));
    events.onopen = () => setState("connected");
    events.onmessage = () => onEvent();
    events.onerror = () => setState("reconnecting");
    return () => events.close();
  }, [enabled, id, onEvent]);

  return enabled ? state : "closed";
}
