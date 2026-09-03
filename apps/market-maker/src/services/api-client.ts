/**
 * A cookie-jar HTTP client for `apps/backend`.
 *
 * The bot trades through the same REST surface the browser uses rather than
 * pushing onto `backend-to-engine-trade-comms` the way `apps/price-poller`
 * does. That is not laziness: the engine's `create_order` payload IS a Postgres
 * `orders` row keyed by the id Postgres generated, and `apps/db-writer` then
 * writes `fills` and `order_updates` that foreign-key back to it. A producer
 * minting its own ids would either violate those constraints or reimplement
 * `createOrder`. One HTTP hop buys full fidelity.
 *
 * A cookie jar, because `apps/backend/src/controllers/auth-controllers.ts`
 * writes the session token to an httpOnly cookie and never returns it in a
 * body. `readToken` in `utils/session-cookie.ts` would also accept an
 * `Authorization: Bearer` header, but nothing hands us a raw token to put
 * there, so capturing `set-cookie` is the only route in.
 *
 * `verifyOrigin` allows a request with no `Origin` header through explicitly —
 * non-browser clients omit it — so none of this needs a backend change.
 */

/** Both spellings the backend can use — see `SESSION_COOKIE`. */
const SESSION_COOKIE_NAMES = ["perp_session", "__Host-perp_session"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Credentials = {
  username: string;
  password: string;
  name: string;
};

/**
 * A concurrency gate.
 *
 * A full requote is up to `levels × 2` cancels followed by as many places, per
 * market. Fired at once that is thirty-odd sockets against a single-threaded
 * Express process for no benefit — the engine serialises them anyway, since
 * every one of these is a round trip through one Redis stream into one
 * in-memory matching engine. Six at a time keeps the pipeline full without
 * making the backend the bottleneck for the browser sitting next to it.
 */
const createGate = (limit: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
};

export const createApiClient = ({
  baseUrl,
  label,
  credentials,
  concurrency = 6,
}: {
  baseUrl: string;
  /** Appears in every log line — there are two of these clients. */
  label: string;
  credentials: Credentials;
  concurrency?: number;
}) => {
  const gate = createGate(concurrency);
  let cookie: string | null = null;
  let userId: string | null = null;
  /** Deduplicates concurrent sign-ins when several requests 401 together. */
  let pendingSignIn: Promise<void> | null = null;

  const captureCookie = (response: Response) => {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(
            (value): value is string => Boolean(value),
          );

    for (const entry of setCookies) {
      const pair = entry.split(";")[0]?.trim();
      const name = pair?.split("=")[0];
      if (pair && name && SESSION_COOKIE_NAMES.includes(name)) cookie = pair;
    }
  };

  const send = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers["cookie"] = cookie;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    captureCookie(response);
    return response;
  };

  const parse = async <T>(response: Response, path: string): Promise<T> => {
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      /**
       * The engine's own message, when there is one.
       *
       * `InvalidRequestError` carries strings like "User does not have
       * available margin" and "There are no matches available" straight
       * through, and those are the two the loops actually branch on. Losing
       * them to a generic "400 Bad Request" would make the bot unable to tell
       * "top up" from "give up".
       */
      const asObject = payload as { message?: string; error?: string } | null;
      const message =
        asObject?.message ??
        asObject?.error ??
        (typeof payload === "string" && payload ? payload : response.statusText);
      throw new ApiError(message, response.status, path);
    }

    return payload as T;
  };

  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    { allowRetry = true }: { allowRetry?: boolean } = {},
  ): Promise<T> =>
    gate(async () => {
      const response = await send(method, path, body);

      /**
       * One re-auth, then give up.
       *
       * The session is a seven-day JWT, so a 401 in practice means the process
       * has outlived it or the backend restarted with a different secret.
       * Retrying once covers both; retrying forever would turn a bad password
       * into an infinite sign-in loop against a service that is also serving
       * the demo.
       */
      if (response.status === 401 && allowRetry) {
        cookie = null;
        await ensureSession();
        return request<T>(method, path, body, { allowRetry: false });
      }

      return parse<T>(response, path);
    });

  const signIn = async () => {
    const response = await send("POST", "/signin", {
      username: credentials.username,
      password: credentials.password,
    });

    if (response.status === 200) {
      const body = await parse<{ userId: string }>(response, "/signin");
      userId = body.userId;
      return;
    }

    /**
     * Sign-up is the fallback, not the first move.
     *
     * Idempotent boot matters more here than anywhere else in the repo: this
     * process runs under `bun --watch`, so it re-boots on every file save, and
     * a boot that tried to sign up first would spend its life colliding with
     * the account it created a minute ago. Signing in first makes a restart
     * indistinguishable from a first run.
     */
    await response.text();
    const created = await send("POST", "/signup", credentials);
    const body = await parse<{ userId: string }>(created, "/signup");
    userId = body.userId;
    console.log(`[${label}] created account ${credentials.username}`);
  };

  const ensureSession = async () => {
    if (cookie && userId) return;
    if (!pendingSignIn) {
      pendingSignIn = signIn().finally(() => {
        pendingSignIn = null;
      });
    }
    await pendingSignIn;
  };

  return {
    label,
    ensureSession,
    get userId() {
      return userId;
    },
    get<T>(path: string) {
      return request<T>("GET", path);
    },
    post<T>(path: string, body?: unknown) {
      return request<T>("POST", path, body);
    },
    del<T>(path: string) {
      return request<T>("DELETE", path);
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
