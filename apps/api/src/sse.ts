import type { AuditCase } from "@contract-audit/audit/model";
import type { AuditEvent, AuditEventHandler } from "@contract-audit/audit/ports";

export class AuditEventBroker {
  private subscribers = new Map<string, Set<AuditEventHandler>>();

  subscribe(auditCaseId: string, handler: AuditEventHandler): () => void {
    let handlers = this.subscribers.get(auditCaseId);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(auditCaseId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) this.subscribers.delete(auditCaseId);
    };
  }

  publish(event: AuditEvent): void {
    const handlers = this.subscribers.get(event.auditCaseId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // A failing subscriber must not prevent other subscribers from receiving events.
      }
    }
  }
}

export function sseResponse(
  broker: AuditEventBroker,
  auditCaseId: string,
  getCase: () => Promise<AuditCase | null>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const close = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    try {
      controller.close();
    } catch {
      // Already closed (e.g. the client disconnected first).
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;
      try {
        const snapshot = await getCase();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "snapshot", auditCaseId, snapshot })}\n\n`));
        unsubscribe = broker.subscribe(auditCaseId, (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Ignore writes after the client has disconnected.
          }
        });
      } catch (error) {
        controller.error(error);
        return;
      }
      signal?.addEventListener("abort", close, { once: true });
    },
    cancel() {
      signal?.removeEventListener("abort", close);
      unsubscribe?.();
      unsubscribe = undefined;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
