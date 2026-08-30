import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * The private channel's transport, driven by a fake socket.
 *
 * `user-feed-core.test.ts` owns the reducers; this file owns the four things
 * only the provider can get wrong, and every one of them is a way for an
 * account to end up looking at state that is quietly false:
 *
 *   1. **The credential.** A ticket is fetched per attempt and put in the URL —
 *      and the session cookie must never be.
 *   2. **Snapshot before events.** On every (re)connect the subscribers'
 *      `resync` runs to completion before a single buffered event is
 *      delivered. This is the ordering §7.3 requires and the reason a
 *      reconnect cannot leave a row patched from a baseline that was thrown
 *      away.
 *   3. **Exactly one socket.** StrictMode double-mounts effects in dev, so the
 *      invariant is how many are OPEN, never how many were constructed.
 *   4. **Nothing at all while anonymous.** No ticket request, no socket.
 *
 * `fetch` and `WebSocket` are stubbed rather than modules mocked: bun's
 * `mock.module` is process-global and two suites disagreeing about one module
 * is how a run becomes order-dependent.
 */

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  static get open() {
    return FakeSocket.instances.filter((s) => !s.closed);
  }

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  accept() {
    this.onopen?.();
  }

  /** One engine reply's worth of events for this account. */
  push(events: unknown[]) {
    this.onmessage?.({ data: JSON.stringify({ feed: "user", data: { events } }) });
  }

  send(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop() {
    this.closed = true;
    this.onerror?.();
    this.onclose?.();
  }
}

let session: { userId: string; username: string } | null = {
  userId: "u-1",
  username: "alice",
};
let ticketCalls = 0;
let ticketFails = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/me")) {
    return session ? json(session) : json({ code: "TOKEN_MISSING" }, 401);
  }
  if (url.endsWith("/ws-ticket")) {
    ticketCalls++;
    if (ticketFails) return json({ code: "INTERNAL_SERVER_ERROR" }, 500);
    return json({ ticket: `t-${ticketCalls}`, expiresIn: 60 });
  }
  return json({}, 404);
}) as unknown as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.WebSocket = FakeSocket as any;

const { SessionProvider } = await import("./auth/session-provider");
const { UserFeedProvider, useUserFeedStatus, useUserFeedSubscription } =
  await import("./user-feed");
const { reducePositionEntries } = await import("./user-feed-core");

beforeEach(() => {
  FakeSocket.instances = [];
  ticketCalls = 0;
  ticketFails = false;
  session = { userId: "u-1", username: "alice" };
});

afterEach(() => {
  received = [];
  resyncs = 0;
  resyncOrder = [];
});

let received: unknown[][] = [];
let resyncs = 0;
/** Interleaving of resyncs and deliveries, so the ORDER is provable. */
let resyncOrder: string[] = [];
let resyncGate: (() => void) | null = null;

/** A subscriber that records what it is told, and can stall its resync. */
function Subscriber({ stall = false }: { stall?: boolean }) {
  const status = useUserFeedStatus();
  useUserFeedSubscription({
    resync: async () => {
      resyncs++;
      resyncOrder.push("resync");
      if (!stall) return;
      await new Promise<void>((resolve) => {
        resyncGate = resolve;
      });
      resyncOrder.push("resync-done");
    },
    onEvents: (events) => {
      resyncOrder.push("events");
      received.push(events);
    },
  });
  return <span data-testid="status">{status}</span>;
}

const renderFeed = (props?: { stall?: boolean }) =>
  render(
    <SessionProvider>
      <UserFeedProvider>
        <Subscriber {...props} />
      </UserFeedProvider>
    </SessionProvider>,
  );

const drive = (fn: () => void) =>
  act(async () => {
    fn();
  });

const balance = { type: "balance", available: "100", locked: "0" };

describe("UserFeedProvider", () => {
  it("fetches a ticket and puts it in the URL — never the session", async () => {
    // The whole of D1 in one assertion. The session token is httpOnly on the
    // API host so JavaScript cannot read it, and a WebSocket handshake carries
    // no custom headers, so the credential has to go in the URL — which is why
    // what goes there is a sixty-second, single-purpose ticket the REST API
    // itself refuses.
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    const url = FakeSocket.instances[0]!.url;
    expect(url).toContain("ticket=t-1");
    expect(ticketCalls).toBe(1);
    // No market and no feeds: nothing on this channel is market-scoped.
    expect(url).not.toContain("market_id");
    expect(url).not.toContain("feeds=");
  });

  it("opens NOTHING while nobody is signed in", async () => {
    // An anonymous visitor on the landing page. A socket here would be a
    // guaranteed 401 and a reconnect loop behind it.
    session = null;
    renderFeed();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("idle"));
    expect(FakeSocket.instances).toHaveLength(0);
    expect(ticketCalls).toBe(0);
  });

  it("resynchronises on open, before delivering anything", async () => {
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());

    await waitFor(() => expect(resyncs).toBe(1));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("live"));
  });

  it("BUFFERS events that arrive while the snapshot is in flight, then drains them", async () => {
    // The race this ordering exists for: a fill landing between the socket
    // opening and `GET /orders/open` answering. Applied early it would be
    // overwritten by the snapshot; dropped it would be lost outright.
    renderFeed({ stall: true });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() => FakeSocket.instances[0]!.push([balance]));
    // Still stalled inside `resync`: nothing may have been delivered yet.
    expect(received).toHaveLength(0);
    expect(screen.getByTestId("status").textContent).toBe("syncing");

    await act(async () => {
      resyncGate?.();
    });

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual([balance]);
    expect(resyncOrder).toEqual(["resync", "resync-done", "events"]);
  });

  it("delivers the whole batch one engine reply produced, as one call", async () => {
    // The batch boundary. A sweep is several fills against one order, and a
    // subscriber that saw them separately could not collapse them.
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() =>
      FakeSocket.instances[0]!.push([
        { type: "position", marketId: "m-1", position: null },
        balance,
      ]),
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
  });

  it("ignores the subscription acknowledgement", async () => {
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() =>
      FakeSocket.instances[0]!.send({ type: "system", message: "Subscribed to user" }),
    );
    expect(received).toHaveLength(0);
  });

  it("survives a malformed frame without dropping the socket", async () => {
    // This connection carries the only notice an account gets that its resting
    // order filled. A parse error must not cost it.
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    await drive(() => socket.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() => socket.onmessage?.({ data: "{{{" }));
    expect(FakeSocket.open).toHaveLength(1);

    await drive(() => socket.push([balance]));
    expect(received).toHaveLength(1);
  });

  it("re-tickets and re-synchronises on every reconnect", async () => {
    // A ticket lives sixty seconds, so one cached at the first attempt would
    // be long dead by the time a backoff reached its cap — and a reconnect
    // storm after a ws-server restart is exactly when this path runs most.
    //
    // The resync is the other half: a reconnect that resumed applying events
    // without a fresh snapshot would be patching rows against a baseline whose
    // missing events nobody kept.
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() => FakeSocket.instances[0]!.drop());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("reconnecting"));

    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1));
    expect(ticketCalls).toBeGreaterThan(1);
    expect(FakeSocket.instances.at(-1)!.url).toContain(`ticket=t-${ticketCalls}`);

    await drive(() => FakeSocket.instances.at(-1)!.accept());
    await waitFor(() => expect(resyncs).toBe(2));
  });

  it("retries when the ticket request fails, without opening a socket", async () => {
    // The API being down, or the session having expired mid-session. Either
    // way there is nothing to connect with, and a socket opened anyway would
    // be refused at the upgrade.
    ticketFails = true;
    renderFeed();
    await waitFor(() => expect(ticketCalls).toBeGreaterThan(0));
    expect(FakeSocket.instances).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("reconnecting"),
    );
  });

  it("holds exactly ONE open socket, and takes it with it on unmount", async () => {
    // StrictMode double-mounts effects in dev, so the invariant is how many
    // are open — never how many were constructed.
    const view = renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    expect(FakeSocket.open).toHaveLength(1);

    view.unmount();
    expect(FakeSocket.open).toHaveLength(0);
  });

  it("stops delivering to a subscriber that has unmounted", async () => {
    const view = renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    await drive(() => socket.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    view.rerender(
      <SessionProvider>
        <UserFeedProvider>
          <span data-testid="status">gone</span>
        </UserFeedProvider>
      </SessionProvider>,
    );

    await drive(() => socket.push([balance]));
    expect(received).toHaveLength(0);
  });
});

describe("a closed position reaches the table with nothing refetched", () => {
  it("removes the row on a `position: null` event", async () => {
    // The half of the close that `positions.test.tsx` deliberately cannot
    // assert: it mounts no channel, so the row correctly stays there. This is
    // the event that takes it away, applied by the same reducer the provider
    // uses.
    const entries = [{ marketId: "m-1" }, { marketId: "m-2" }];
    const events: unknown[] = [];

    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(resyncs).toBe(1));

    await drive(() =>
      FakeSocket.instances[0]!.push([
        { type: "position", marketId: "m-1", position: null },
      ]),
    );

    for (const batch of received) events.push(...(batch as unknown[]));
    const next = events.reduce(
      (rows, event) =>
        reducePositionEntries(rows as { marketId: string }[], event as never, {
          marketIdOf: (e) => e.marketId,
          toEntry: (p) => ({ marketId: p.marketId }),
        }),
      entries as { marketId: string }[],
    );
    expect(next).toEqual([{ marketId: "m-2" }]);
  });
});
