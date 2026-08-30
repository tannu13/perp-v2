import { CreateOrderSchema, type TCreateOrderSchema } from "@repo/shared";
import { apiRequest } from "./http";
import { ApiError } from "./errors";
import {
  AuthResultSchema,
  SignoutResultSchema,
  BalancesSchema,
  CancelOrderResultSchema,
  ClosedPositionsSchema,
  CreateOrderResultSchema,
  FillsSchema,
  MarketDepthSchema,
  MarketListSchema,
  OnrampResultSchema,
  OpenPositionsSchema,
  OrdersSchema,
  WsTicketSchema,
} from "./schemas";

/**
 * One function per route. No component should ever hold a URL.
 *
 * Paths are the real ones: both routers mount at the ROOT of the backend, so it
 * is `/onramp` and `/equity/balances` — not `/order/onramp` and
 * `/order/equity/balances` as the `TODO(api)` comments in the terminal claim.
 * Those comments are wrong and the phases that touch those files remove them.
 */

type Opts = { signal?: AbortSignal };

/* ---------------------------------------------------------------- public -- */

/** Public since Phase 2. The market list renders before anyone signs in. */
export function getMarkets(opts: Opts = {}) {
  return apiRequest("/markets", {
    schema: MarketListSchema,
    auth: false,
    ...opts,
  }).then((r) => r.markets);
}

/** Public since Phase 2. Takes the market UUID, not the slug. */
export function getDepth(marketId: string, opts: Opts = {}) {
  return apiRequest(`/depth?marketId=${encodeURIComponent(marketId)}`, {
    schema: MarketDepthSchema,
    auth: false,
    ...opts,
  });
}

/* ------------------------------------------------------------------ auth -- */

export function signup(
  input: { username: string; password: string; name: string },
  opts: Opts = {},
) {
  return apiRequest("/signup", {
    method: "POST",
    body: input,
    schema: AuthResultSchema,
    auth: false,
    ...opts,
  });
}

export function signin(
  input: { username: string; password: string },
  opts: Opts = {},
) {
  return apiRequest("/signin", {
    method: "POST",
    body: input,
    schema: AuthResultSchema,
    auth: false,
    ...opts,
  });
}

/** Clears the session cookie. All a sign-out can be: the JWT has no revocation. */
export function signout(opts: Opts = {}) {
  return apiRequest("/signout", {
    method: "POST",
    schema: SignoutResultSchema,
    auth: false,
    ...opts,
  });
}

/**
 * Who the cookie says we are.
 *
 * Exists because the client cannot read its own httpOnly cookie: identity has
 * to be asked for rather than decoded. Also the session probe on boot — a 401
 * here means "not signed in".
 */
export function me(opts: Opts = {}) {
  return apiRequest("/me", {
    schema: AuthResultSchema,
    // A 401 here is "not signed in", not "signed out" — see the option's note.
    notifyAuthFailure: false,
    ...opts,
  });
}

/**
 * A credential for the private WebSocket channel (Phase 13).
 *
 * The session token is httpOnly on the API host, so JavaScript cannot read it,
 * and a WebSocket handshake carries no custom headers — the credential has to
 * go in the URL. What goes there is a sixty-second, `typ: "ws"` ticket the API
 * itself refuses, so a copy of it in a proxy log opens nothing a minute later.
 *
 * POST despite reading nothing: it mints a credential, and a GET would be
 * cacheable, prefetchable, and in browser history with its body.
 */
export function getWsTicket(opts: Opts = {}) {
  return apiRequest("/ws-ticket", {
    method: "POST",
    schema: WsTicketSchema,
    ...opts,
  });
}

/* --------------------------------------------------------------- account -- */

export function getBalances(opts: Opts = {}) {
  return apiRequest("/equity/balances", {
    schema: BalancesSchema,
    ...opts,
  }).then((r) => r.balances);
}

/**
 * The one place a money value is sent as a NUMBER rather than a string.
 * `OnRampSchema` on the server is `z.coerce.number().positive()`, so the parse
 * happens here, once, at the boundary — not in the dialog.
 */
export function onramp(amount: string | number, opts: Opts = {}) {
  return apiRequest("/onramp", {
    method: "POST",
    body: { amount: typeof amount === "string" ? Number(amount) : amount },
    schema: OnrampResultSchema,
    ...opts,
  });
}

/* ---------------------------------------------------------------- orders -- */

/**
 * Validates against `CreateOrderSchema` from `@repo/shared` before sending —
 * the same object the server validates with. A malformed ticket fails here,
 * with the field named, rather than as a 400 round trip.
 *
 * A local failure is reported as the SAME `ApiError` / `VALIDATION_FAILED`
 * shape the server produces, so the order form has one branch to write rather
 * than two. `async` matters: `schema.parse` throws synchronously, and a
 * function that sometimes throws before returning its promise is a trap for
 * every caller using `.catch()`.
 */
export async function createOrder(
  payload: TCreateOrderSchema,
  opts: Opts = {},
) {
  const validated = CreateOrderSchema.safeParse(payload);
  if (!validated.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of validated.error.issues) {
      const field = issue.path.join(".") || "(root)";
      fieldErrors[field] ??= issue.message;
    }
    throw new ApiError({
      status: 0,
      code: "VALIDATION_FAILED",
      message: "Invalid order",
      fieldErrors,
      route: "/order",
    });
  }

  return apiRequest("/order", {
    method: "POST",
    body: validated.data,
    schema: CreateOrderResultSchema,
    ...opts,
  });
}

export function cancelOrder(orderId: string, opts: Opts = {}) {
  return apiRequest(`/order/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    schema: CancelOrderResultSchema,
    ...opts,
  });
}

/** Resting orders for one market. Every order route is market-scoped (G10). */
export function getOpenOrders(marketId: string, opts: Opts = {}) {
  return apiRequest(`/orders/open/${encodeURIComponent(marketId)}`, {
    schema: OrdersSchema,
    ...opts,
  }).then((r) => r.orders);
}

/** Every order for one market, terminal states included. */
export function getOrders(marketId: string, opts: Opts = {}) {
  return apiRequest(`/orders/${encodeURIComponent(marketId)}`, {
    schema: OrdersSchema,
    ...opts,
  }).then((r) => r.orders);
}

/* ------------------------------------------------------------- positions -- */

export function getOpenPositions(marketId: string, opts: Opts = {}) {
  return apiRequest(`/positions/open/${encodeURIComponent(marketId)}`, {
    schema: OpenPositionsSchema,
    ...opts,
  }).then((r) => r.positions);
}

export function getClosedPositions(marketId: string, opts: Opts = {}) {
  return apiRequest(`/positions/closed/${encodeURIComponent(marketId)}`, {
    schema: ClosedPositionsSchema,
    ...opts,
  }).then((r) => r.closedPositions);
}

/* ----------------------------------------------------------------- fills -- */

/**
 * The account's fills, newest first, with the side the account was on.
 *
 * Every parameter is optional and the route still defaults to account-wide, but
 * it is no longer unbounded (G11): the server caps `limit` at 500 and answers
 * with a `nextCursor` to pass back as `before`.
 *
 * Returns the envelope rather than just the rows, unlike the other list
 * endpoints — the cursor is the half the caller cannot reconstruct.
 */
export function getFills(
  params: { marketId?: string; limit?: number; before?: string } = {},
  opts: Opts = {},
) {
  const query = new URLSearchParams();
  if (params.marketId) query.set("marketId", params.marketId);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.before) query.set("before", params.before);

  const search = query.toString();
  return apiRequest(`/fills${search ? `?${search}` : ""}`, {
    schema: FillsSchema,
    ...opts,
  });
}
