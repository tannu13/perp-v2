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

/** Test seam: lets a suite assert the de-duplication and then reset it. */
export function resetAuthFailureLatch() {
  authFailureInFlight = false;
}

function notifyAuthFailureHandler(route?: string) {
  if (authFailureInFlight) return;
  authFailureInFlight = true;
  try {
    onAuthFailure?.(route);
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
  } catch (err) {
    // A timeout and a dead network both surface as AbortError/TypeError here;
    // only the deadline we set distinguishes them.
    const aborted = controller.signal.aborted;
    throw new ApiError({
      status: 0,
      code: aborted ? CLIENT_ERROR_CODES.TIMEOUT : CLIENT_ERROR_CODES.NETWORK,
      message: aborted
        ? "The request took too long. Check your connection and try again."
        : "Could not reach the server. Check your connection and try again.",
      route: path,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  const payload = await readJson(response);

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
