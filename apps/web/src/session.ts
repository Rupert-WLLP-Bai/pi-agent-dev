import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * The workspace access gate, as the browser sees it.
 *
 * The credential never enters this module's storage: `POST /api/session` sends
 * the passphrase in the request body and the API answers with an HttpOnly
 * cookie, so the token is unreachable from JavaScript by construction. Nothing
 * is written to `localStorage` and the passphrase is never placed in a URL.
 */

export interface SessionState {
  /** Whether this deployment demands a passphrase at all. */
  authenticationRequired: boolean;
  /** Whether the browser currently holds a valid session. */
  authenticated: boolean;
}

export interface SessionUnavailable {
  /** The session endpoint itself could not be read; the gate state is unknown. */
  reachable: false;
}

/**
 * Reads the gate state. A failure is reported rather than assumed open: an
 * unreachable session endpoint must not be read as "no gate", because that
 * would fire protected queries the server is going to refuse anyway.
 */
async function fetchSession(): Promise<SessionState> {
  const response = await fetch(`${window.location.origin}/api/session`, {
    credentials: "same-origin",
    headers: { "cache-control": "no-store" },
  });
  if (!response.ok) {
    throw new Error(`无法确认访问状态（HTTP ${response.status}）`);
  }
  const body = (await response.json()) as Partial<SessionState>;
  if (typeof body.authenticationRequired !== "boolean" || typeof body.authenticated !== "boolean") {
    throw new Error("访问状态响应格式不正确");
  }
  return { authenticationRequired: body.authenticationRequired, authenticated: body.authenticated };
}

export const sessionQueryKey = ["session"] as const;

/**
 * The gate state, polled while it is unresolved so a session revoked elsewhere
 * is noticed without a reload. Polling stops as soon as the answer is settled:
 * `authenticated` with no gate required, or a refused login.
 */
export function useSession() {
  const query = useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  return query;
}

export interface LoginResult {
  authenticated: boolean;
}

/**
 * Submits the passphrase. The response is only read for its status: the session
 * itself lives in the HttpOnly cookie, so a successful login is observable
 * through the refetched gate state rather than through a returned token.
 */
async function loginWithPassphrase(passphrase: string): Promise<LoginResult> {
  const response = await fetch(`${window.location.origin}/api/session`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ token: passphrase }),
  });
  if (response.status === 401) {
    throw new Error("访问口令不正确，请重新输入");
  }
  if (response.status === 429) {
    throw new Error("登录尝试过于频繁，请稍后再试");
  }
  if (!response.ok) {
    throw new Error(`登录失败（HTTP ${response.status}）`);
  }
  const body = (await response.json()) as Partial<LoginResult>;
  return { authenticated: body.authenticated === true };
}

/** Clears the HttpOnly session. The cookie itself is not readable here. */
async function logoutSession(): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/session`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "cache-control": "no-store" },
  });
  // 204 clears the cookie; anything else still leaves the local gate state
  // needing a refresh, so the caller refetches either way.
  if (!response.ok && response.status !== 204) {
    throw new Error(`退出登录失败（HTTP ${response.status}）`);
  }
}

/**
 * Login and logout for the gate shell. Both mutations end by invalidating the
 * session query so every protected query either resumes (login) or is withheld
 * (logout) on the next render.
 */
export function useSessionActions() {
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: loginWithPassphrase,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
  const logout = useMutation({
    mutationFn: logoutSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
  return { login, logout };
}

/**
 * Whether protected queries may run yet. The shell uses this to withhold every
 * data query until the gate answers; an unknown state (still loading, or the
 * endpoint itself failed) is treated as not-ready rather than as open.
 */
export function sessionAllowsQueries(session: SessionState | undefined): boolean {
  if (session === undefined) return false;
  return !session.authenticationRequired || session.authenticated;
}
