/**
 * Surviving a Redis outage — the four backend services' shared policy.
 *
 * D19: `docker stop perps_redis` and the backend, the engine, ws-server and
 * db-writer all exited within a second on the same unhandled
 * `SocketClosedUnexpectedlyError`. Every one of them already had an
 * `.on("error")` handler, so that was never the hole. The hole was the stream
 * listener: `listenToIncomingEvents()` is a `while (true)` loop awaiting a
 * blocking `xReadGroup`, started as a floating promise from `index.ts`. When
 * the socket drops, the in-flight read rejects, the rejection escapes the loop,
 * and nothing is there to catch it — an unhandled rejection, and Bun ends the
 * process. The client underneath was reconnecting perfectly well.
 *
 * So the fix is in two halves and both are needed: a reconnect policy on the
 * socket, and a loop that treats a dropped connection as a pause rather than
 * as the end of the program.
 */

/**
 * Backoff for both the socket's reconnect and the listener's own retry:
 * 100 ms, 200 ms, 400 ms … capped at 3 s, and it never gives up.
 *
 * node-redis's default (`retries * 50`, capped at 500 ms) also never gives up,
 * but it is stated here because a service that reconnects on its own is a
 * decision, not a default worth inheriting silently — and the cap matters. A
 * Redis that is down for a minute should be polled ~20 times, not 120.
 */
export const reconnectDelayMs = (retries: number): number =>
  Math.min(100 * 2 ** Math.min(retries, 5), 3_000);

/**
 * Client options every service builds its clients from, so the fleet cannot
 * drift into having two reconnect policies.
 */
export const redisClientOptions = (url: string) => ({
  url,
  socket: { reconnectStrategy: reconnectDelayMs },
});

/**
 * The transport failed — as opposed to Redis answering, or our own code being
 * wrong.
 *
 * Matched on `constructor.name` rather than `instanceof`, for two reasons that
 * both apply here. node-redis's error classes set neither `name` nor `code`
 * (they only call `super(message)`), so `err.name` is the useless string
 * `"Error"` for every one of them. And ws-server is on `redis@6` while the
 * other five are on `redis@5`, so there are two copies of these classes in
 * `node_modules` and an `instanceof` against either one would answer `false`
 * for half the fleet. The names are identical across both versions — checked,
 * not assumed.
 */
const CONNECTION_ERROR_NAMES = new Set([
  "SocketClosedUnexpectedlyError",
  "ConnectionTimeoutError",
  "SocketTimeoutError",
  "ClientClosedError",
  "ClientOfflineError",
  "DisconnectsClientError",
  "ReconnectStrategyError",
]);

/** Raw socket failures, which arrive as plain `Error`s carrying a `code`. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);

export const isRedisConnectionError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;

  const name = (err as { constructor?: { name?: string } }).constructor?.name;
  if (name && CONNECTION_ERROR_NAMES.has(name)) return true;

  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code);
};

/**
 * Anything with node-redis's `on`. Typed loosely, and generically, for one
 * reason: `@repo/shared` depends on neither copy of `redis` (see the note on
 * `CONNECTION_ERROR_NAMES`), and `RedisClientType`'s `on` is a wall of
 * command-map overloads that no hand-written structural type will satisfy.
 * The generic keeps the caller's own client type intact on the way out.
 */
type RedisEventSource = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (event: any, listener: any) => unknown;
};

/**
 * The client's own error log, made survivable.
 *
 * Every service already had `.on("error", console.log)`, and while a dropped
 * Redis killed the process that was fine — it printed once and died. Now that
 * it lives, the same handler prints a full stack trace on every reconnect
 * attempt: measured at **56 KB in ten seconds**, which is about 20 MB an hour,
 * per client, for as long as the outage lasts. An outage should not also be a
 * disk-space incident.
 *
 * So: the first error of an outage is logged in full, the rest are counted,
 * and `ready` reports how many attempts it took to come back.
 */
export const attachRedisLogging = <T extends RedisEventSource>(
  client: T,
  label: string,
): T => {
  let errors = 0;

  client.on("error", (err: unknown) => {
    errors += 1;
    if (errors === 1) {
      console.error(
        `[${label}] redis error:`,
        err instanceof Error ? err.message : err,
      );
    }
  });

  client.on("ready", () => {
    if (errors > 0) {
      console.log(
        `[${label}] redis connection restored after ${errors} failed attempt(s)`,
      );
      errors = 0;
    }
  });

  return client;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one stream listener forever.
 *
 * `step` reads and processes **one batch** and returns; the loop is here. A
 * connection failure is swallowed, logged once per outage rather than once per
 * retry, and retried on the backoff above — by which time the client has
 * usually reconnected itself and the next `xReadGroup` simply works.
 *
 * Anything that is *not* a connection failure still propagates, deliberately.
 * db-writer throws on a real database write failure and it should keep dying
 * on one: the entry is unacknowledged, so a restart redelivers it, and that is
 * the at-least-once guarantee doing its job. Turning every error into a
 * `continue` would silently drop fills.
 */
export const runStreamLoop = async (
  label: string,
  step: () => Promise<void>,
): Promise<never> => {
  let outage = 0;

  while (true) {
    try {
      await step();

      if (outage > 0) {
        console.log(`[${label}] redis is back — resuming the stream`);
        outage = 0;
      }
    } catch (err) {
      if (!isRedisConnectionError(err)) throw err;

      outage += 1;
      if (outage === 1) {
        console.warn(
          `[${label}] lost redis — pausing until it returns:`,
          err instanceof Error ? err.message : err,
        );
      }
      await sleep(reconnectDelayMs(outage));
    }
  }
};

/**
 * How many entries the comms streams keep.
 *
 * Every `xAdd` in this repo used to be unbounded, and Redis streams do not
 * expire: after a few hours of a market maker quoting three books,
 * `engine-to-backend-trade-comms` held 157,453 entries and **450 MB**, against
 * 75 MB on the request side. The asymmetry is the payload — an engine reply
 * carries a full 20-level depth snapshot for both sides, 2,861 bytes measured
 * per entry versus 475 on the way in. That is roughly 5 GB a day at the bot's
 * steady rate, on an instance whose `maxmemory` is 0 and whose eviction policy
 * is `noeviction`. It is not a slow bill, it is an OOM that takes the exchange
 * down with it.
 *
 * MAXLEN rather than MINID, deliberately. MINID would give an exact *time*
 * window and let memory float with the message rate; MAXLEN gives an exact
 * *memory* ceiling and lets the window float. The failure being defended
 * against is running out of RAM, so the ceiling is the quantity that has to be
 * the hard one.
 *
 * At the measured 3.34 KB per request/response pair, 60,000 entries caps the
 * two streams together near 200 MB, which at the bot's ~17 round trips a second
 * is about an hour of replay. That hour is the real constant: it is how long
 * `apps/db-writer` may be down before its backlog is trimmed away and those
 * fills are lost for good. Raise it if a deploy can take longer than that.
 *
 * `~` because exact trimming walks the stream on every write; approximate
 * trimming drops whole radix nodes and is what makes this free enough to put on
 * the hot path.
 *
 * One shared value, not a field in each app's env schema, and that is the point
 * rather than a shortcut: three different producers write to
 * `backend-to-engine-trade-comms`, MAXLEN applies per write, and so the
 * smallest cap among them silently wins. Four independently configurable
 * numbers for one stream is a way to be surprised, not a feature.
 */
const DEFAULT_STREAM_MAXLEN = 60_000;

const streamMaxLen = ((): number => {
  const raw = process.env.STREAM_MAXLEN;
  if (raw === undefined) return DEFAULT_STREAM_MAXLEN;

  const parsed = Number(raw);
  // A cap this low would trim a backlog faster than a restarting consumer can
  // read it, which is data loss dressed up as configuration.
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    console.warn(
      `[redis] ignoring STREAM_MAXLEN=${raw} — must be a number >= 1000; ` +
        `using ${DEFAULT_STREAM_MAXLEN}`,
    );
    return DEFAULT_STREAM_MAXLEN;
  }
  return Math.floor(parsed);
})();

/**
 * Spread into the options argument of every `xAdd` that writes to a comms
 * stream, so the bound is applied by the write itself and there is no separate
 * trimming job to forget to deploy.
 */
export const streamTrim = {
  TRIM: {
    strategy: "MAXLEN",
    strategyModifier: "~",
    threshold: streamMaxLen,
  },
} as const satisfies {
  TRIM: {
    strategy: "MAXLEN" | "MINID";
    strategyModifier: "=" | "~";
    threshold: number;
  };
};
