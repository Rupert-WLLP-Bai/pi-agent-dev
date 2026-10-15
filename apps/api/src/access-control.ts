import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";

const SESSION_COOKIE = "audit_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_SESSIONS = 256;

export interface AccessEvent {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  authenticated: boolean;
}

export interface AccessControlOptions {
  token?: string;
  secureCookies?: boolean;
  webOrigin?: string;
  now?: () => number;
  onAccess?: (event: AccessEvent) => void;
}

/** One workspace access gate; sessions are revoked on logout or process restart. */
export function createAccessControl(options: AccessControlOptions = {}) {
  const token = options.token ?? process.env.API_ACCESS_TOKEN?.trim() ?? "";
  const environment = process.env.APP_ENV ?? "development";
  if (
    (token && (token.length < 32 || token.length > 512 || /\s/u.test(token))) ||
    ((environment === "demo" || environment === "production") && !token)
  ) {
    throw new Error("API_ACCESS_TOKEN_REQUIRED_MINIMUM_32_CHARACTERS");
  }
  const required = token.length > 0;
  const tokenHash = createHash("sha256").update(token).digest();
  const secureCookies = options.secureCookies ?? environment === "production";
  const webOrigin = options.webOrigin ?? "http://localhost:5173";
  const now = options.now ?? Date.now;
  const onAccess =
    options.onAccess ??
    ((event) => console.info(JSON.stringify({ event: "api_access", ...event })));
  const sessions = new Map<string, number>();
  const requests = new WeakMap<
    Request,
    { requestId: string; started: number; authenticated: boolean; sessionHash: string | null }
  >();

  return new Elysia({ name: "workspace-access" })
    .onRequest(({ request, set }) => {
      const incoming = request.headers.get("x-request-id")?.trim();
      const requestId =
        incoming && /^[a-zA-Z0-9_-]{1,128}$/u.test(incoming) ? incoming : crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
      let authenticated = !required;
      let sessionHash: string | null = null;
      const authorization = request.headers.get("authorization");
      if (required && authorization?.startsWith("Bearer ")) {
        const supplied = createHash("sha256").update(authorization.slice(7)).digest();
        authenticated = timingSafeEqual(tokenHash, supplied);
      }
      const cookie = request.headers
        .get("cookie")
        ?.split(";")
        .find((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
      const session = cookie?.trim().slice(SESSION_COOKIE.length + 1);
      if (required && session && /^[a-f0-9]{64}$/u.test(session)) {
        sessionHash = createHash("sha256").update(session).digest("hex");
        const expiresAt = sessions.get(sessionHash);
        if (expiresAt !== undefined && expiresAt > now()) authenticated = true;
        else sessions.delete(sessionHash);
      }
      requests.set(request, { requestId, started: performance.now(), authenticated, sessionHash });

      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (
        origin &&
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.method !== "OPTIONS" &&
        origin !== url.origin &&
        origin !== webOrigin
      ) {
        set.status = 403;
        return { schemaVersion: 1, error: "origin_forbidden", requestId };
      }
      if (
        required &&
        !authenticated &&
        request.method !== "OPTIONS" &&
        url.pathname !== "/api/health" &&
        url.pathname !== "/api/session"
      ) {
        set.status = 401;
        set.headers["cache-control"] = "no-store";
        return { schemaVersion: 1, error: "authentication_required", requestId };
      }
    })
    .onAfterResponse({ as: "global" }, ({ request, responseValue, route, set }) => {
      const observation = requests.get(request);
      if (!observation) return;
      const event: AccessEvent = {
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
        authenticated: observation.authenticated,
      };
      // Logging runs after the response and never includes bodies, headers, query values or IDs.
      try {
        onAccess(event);
      } catch {
        console.warn("ACCESS_LOG_WRITE_FAILED");
      }
    })
    .get("/api/session", ({ request, set }) => {
      set.headers["cache-control"] = "no-store";
      return {
        authenticationRequired: required,
        authenticated: requests.get(request)?.authenticated ?? !required,
      };
    })
    .post(
      "/api/session",
      ({ body, request, set }) => {
        set.headers["cache-control"] = "no-store";
        if (!required) return { authenticated: true };
        const supplied = createHash("sha256").update(body.token).digest();
        if (!timingSafeEqual(tokenHash, supplied)) {
          set.status = 401;
          return {
            schemaVersion: 1,
            error: "invalid_access_token",
            requestId: set.headers["x-request-id"],
          };
        }
        const timestamp = now();
        for (const [key, expiresAt] of sessions) {
          if (expiresAt <= timestamp) sessions.delete(key);
        }
        if (sessions.size >= MAX_SESSIONS) {
          set.status = 429;
          return {
            schemaVersion: 1,
            error: "session_limit_reached",
            requestId: set.headers["x-request-id"],
          };
        }
        const session = randomBytes(32).toString("hex");
        sessions.set(
          createHash("sha256").update(session).digest("hex"),
          timestamp + SESSION_SECONDS * 1000,
        );
        set.headers["set-cookie"] =
          `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureCookies ? "; Secure" : ""}`;
        const observation = requests.get(request);
        if (observation) observation.authenticated = true;
        return { authenticated: true };
      },
      { body: t.Object({ token: t.String({ minLength: 1, maxLength: 512 }) }) },
    )
    .delete("/api/session", ({ request, set }) => {
      const sessionHash = requests.get(request)?.sessionHash;
      if (sessionHash) sessions.delete(sessionHash);
      set.headers["set-cookie"] =
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? "; Secure" : ""}`;
      set.headers["cache-control"] = "no-store";
      set.status = 204;
      return null;
    });
}
