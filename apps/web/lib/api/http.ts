import type { ZodType } from "zod";
import { ApiError, CLIENT_ERROR_CODES, toApiError } from "./errors";

/**
 * The single way `apps/web` talks to `apps/backend`.
 *
 * Every response is parsed against a schema rather than cast, because the two
 * sides do not currently agree on types: money arrives as strings from the
 * Postgres-backed routes and as JavaScript numbers from the engine-backed ones
 * (§3.2). Parsing is where that gets normalised, so nothing above this module
 * ever sees a float where it expected a string.
 *
 * ONE TRANSPORT (decision D1, revised): the browser calls the backend directly.
 *
 * There is no proxy. The session is an httpOnly cookie the backend sets on its
 * own host, and the browser attaches it because the two are the same SITE even
 * though they are different origins:
 *
 *   app.example.com  ──fetch(credentials:"include")──▶  api.example.com
 *
 * `SameSite=Lax` is scoped to the registrable domain, so it does not block that
 * request; CORS with `credentials: true` lets the response be read. Page
 * JavaScript still never sees a token, and there is no extra hop.
 */

const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const isBrowser = () => typeof window !== "undefined";

/** Default client-side deadline. Longer than the backend's 5s engine timeout. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Bearer seam, for server-side callers only.
 *
 * In the browser this is unused and must stay that way: a token reachable from
 * page JavaScript is exactly what the cookie design exists to prevent. Server
 * Components have no cookie jar, and today only fetch public data.
 */
export type TokenGetter = () => string | null;

let getAuthToken: TokenGetter = () => null;

export function setAuthTokenGetter(getter: TokenGetter) {
  getAuthToken = getter;
}

/**
 * Called when the server says the session is gone.
 *
 * Registered once by `SessionProvider`. Kept at module scope so that every
 * in-flight request shares one handler and a screen full of parallel fetches
 * produces a single sign-out, not one per table.
 */
export type AuthFailureHandler = (route?: string) => void;

let onAuthFailure: AuthFailureHandler | null = null;
let authFailureInFlight = false;

export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  onAuthFailure = handler;
}

/**
 * The session scope: one signal every authenticated request is linked to.
 *
 * Phase 14. A terminal has five tables, a balance read and a ws-ticket in
 * flight at once, and when the session expires the server answers all of them
 * with a 401. The interceptor above collapses the *reporting* into one toast
 * and one redirect — but each request still resolves on its own, and each
 * provider still catches its own failure. Aborting the scope means the ones
 * that had not answered yet never do: they reject with `CANCELLED`, which
 * every provider treats as "nothing to say" (`ApiError.isSilent`).
 *
 * It is replaced rather than reused after an abort, because the very next
 * thing a signed-out user does is sign in again — on a permanently aborted
 * controller that request would never leave.
 */
let sessionScope = new AbortController();

export function abortSessionRequests() {
  sessionScope.abort();
  sessionScope = new AbortController();
}

/** Test seam: lets a suite assert the de-duplication and then reset it. */
export function resetAuthFailureLatch() {
  authFailureInFlight = false;
}

function notifyAuthFailureHandler(route?: string) {
  if (authFailureInFlight) return;
  authFailureInFlight = true;
  try {
    onAuthFailure?.(route);
    // After the handler, not before: the handler is what turns this into the
    // one toast and the one redirect, and it must run even if a listener on an
    // aborted request throws on its way out.
    abortSessionRequests();
  } finally {
    // Released on the next tick so the burst of concurrent 401s that share a
    // screen collapses into one, while a later, genuinely new failure still
    // reports. A permanent latch would swallow the second expiry of a session.
    queueMicrotask(() => {
      authFailureInFlight = false;
    });
  }
}

function resolveUrl(path: string) {
  return `${BACKEND_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export type RequestOptions<T> = {
  method?: "GET" | "POST" | "DELETE";
  /** Sent as JSON. Omit for GET and DELETE. */
  body?: unknown;
  /** Every response is validated. There is no unchecked path on purpose. */
  schema: ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Set false for endpoints that must work signed out (markets, depth). */
  auth?: boolean;
  /**
   * Whether a 401 here means "your session ended".
   *
   * Almost always yes. The exception is the session PROBE: `GET /me` on boot
   * answers 401 for anyone who is simply not signed in, and treating that as an
   * expiry redirected anonymous visitors off `/signup` and `/` to the sign-in
   * page mid-interaction.
   */
  notifyAuthFailure?: boolean;
};

/**
 * Classifies a request that never produced an answer.
 *
 * Three ways to get here and they are not interchangeable. A timeout, a dead
 * network and a deliberate abandonment all surface as an AbortError or a
 * TypeError; only which signal fired tells them apart, and the session scope
 * has to be checked FIRST — its abort also aborts the per-request controller,
 * so `controller.signal.aborted` is true for all three.
 */
function transportError(
  path: string,
  controller: AbortController,
  scope: AbortController | null,
): ApiError {
  if (scope?.signal.aborted) {
    return new ApiError({
      status: 0,
      code: CLIENT_ERROR_CODES.CANCELLED,
      message: "The request was cancelled because the session ended.",
      route: path,
    });
  }
  const aborted = controller.signal.aborted;
  return new ApiError({
    status: 0,
    code: aborted ? CLIENT_ERROR_CODES.TIMEOUT : CLIENT_ERROR_CODES.NETWORK,
    message: aborted
      ? "The request took too long. Check your connection and try again."
      : "Could not reach the server. Check your connection and try again.",
    route: path,
  });
}

export async function apiRequest<T>(
  path: string,
  {
    method = "GET",
    body,
    schema,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    auth = true,
    notifyAuthFailure = true,
  }: RequestOptions<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // An externally supplied signal (a component unmounting, a market switch)
  // must still cancel the request, so both are honoured.
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  /**
   * The session scope, captured now.
   *
   * Captured rather than read at rejection time because `abortSessionRequests`
   * REPLACES the controller: by the time this request's `catch` runs, the
   * module-level one is a fresh, un-aborted instance and the reason for the
   * abort would have been lost.
   *
   * Only authenticated requests join it. `GET /markets` and `GET /depth` work
   * signed out and must keep working while somebody signs in again — the
   * ladder is what prices the order they will place.
   */
  const scope = auth ? sessionScope : null;
  const onScopeAbort = () => controller.abort();
  scope?.signal.addEventListener("abort", onScopeAbort);

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";

  // Only ever populated server-side; in the browser the proxy supplies the
  // token from the httpOnly cookie and this getter stays empty by design.
  if (auth && !isBrowser()) {
    const token = getAuthToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Cross-origin but same-site: without this the browser withholds the
      // session cookie and every authenticated call 401s. Harmless
      // server-side, where there is no cookie jar to send.
      credentials: "include",
    });
  } catch {
    throw transportError(path, controller, scope);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
    scope?.signal.removeEventListener("abort", onScopeAbort);
  }

  /**
   * The body is a second place the request can be abandoned: `fetch` resolves
   * once the headers are in, and an abort between then and the last byte
   * rejects here rather than above. Before Phase 14 that rejection escaped as
   * a raw `AbortError` — not an `ApiError` at all, so nothing downstream could
   * classify it.
   */
  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch {
    throw transportError(path, controller, scope);
  }

  if (!response.ok) {
    const error = toApiError(response.status, payload, path);

    /**
     * One sign-out per burst, not one per request.
     *
     * A public route is exempt: `GET /markets` cannot fail for auth reasons,
     * and letting an unrelated 401 there bounce a signed-in user would be a
     * redirect loop waiting to happen.
     */
    if (auth && notifyAuthFailure && error.isAuthFailure) {
      notifyAuthFailureHandler(path);
    }

    throw error;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Not a user-facing condition: the server sent a 2xx whose shape we do not
    // recognise, which means a contract has drifted. Loud on purpose.
    throw new ApiError({
      status: response.status,
      code: CLIENT_ERROR_CODES.SCHEMA,
      message: `Unexpected response shape from ${path}: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
      route: path,
    });
  }

  return parsed.data;
}

/** Returns undefined for an empty or non-JSON body rather than throwing. */
async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
