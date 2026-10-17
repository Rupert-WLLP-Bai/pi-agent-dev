import { Elysia } from "elysia";

export interface RequestAccessEvent {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

export interface RequestContextOptions {
  webOrigin?: string;
  onAccess?: (event: RequestAccessEvent) => void;
}

/** Correlate requests, reject foreign writes and record sanitized access events. */
export function createRequestContext(options: RequestContextOptions = {}) {
  const webOrigin = options.webOrigin ?? "http://localhost:5173";
  const onAccess =
    options.onAccess ??
    ((event) => console.info(JSON.stringify({ event: "api_access", ...event })));
  const requests = new WeakMap<Request, { requestId: string; started: number }>();

  return new Elysia({ name: "request-context" })
    .onRequest(({ request, set }) => {
      const incoming = request.headers.get("x-request-id")?.trim();
      const requestId =
        incoming && /^[a-zA-Z0-9_-]{1,128}$/u.test(incoming) ? incoming : crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
      requests.set(request, { requestId, started: performance.now() });
      const origin = request.headers.get("origin");
      if (
        origin &&
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.method !== "OPTIONS" &&
        origin !== new URL(request.url).origin &&
        origin !== webOrigin
      ) {
        set.status = 403;
        return { schemaVersion: 1, error: "origin_forbidden", requestId };
      }
    })
    .onAfterResponse({ as: "global" }, ({ request, responseValue, route, set }) => {
      const observation = requests.get(request);
      if (!observation) return;
      const event: RequestAccessEvent = {
        requestId: observation.requestId,
        method: request.method,
        route: route ?? "<unmatched>",
        status:
          responseValue instanceof Response
            ? responseValue.status
            : typeof set.status === "number"
              ? set.status
              : 200,
        durationMs: Math.max(0, Math.round(performance.now() - observation.started)),
      };
      try {
        onAccess(event);
      } catch {
        console.warn("ACCESS_LOG_WRITE_FAILED");
      }
    });
}
