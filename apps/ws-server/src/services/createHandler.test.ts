import { describe, expect, it } from "bun:test";
import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { createHandler } from "./createHandler";

/**
 * What reaches a subscriber, and — more importantly — what does not.
 *
 * ws-server is the only process in the stack that speaks to an unauthenticated
 * socket. Everything it publishes is public to anyone who can open a
 * connection, so the assertions below are as much about absence as presence:
 * a print must carry no account and no order id, whatever the engine reply it
 * was derived from happened to contain.
 */

const MARKET = "e3289213-372c-44d2-8cc8-2a6eb55b11b1";

type Published = { topic: string; message: string };

/**
 * The handler only ever calls `publish`, so a two-field stub is the whole
 * surface. Cast at the boundary rather than typed as a partial `Bun.Server`:
 * pretending to implement that interface would be a bigger lie than the cast.
 */
function harness() {
  const published: Published[] = [];
  const server = {
    publish: (topic: string, message: string) => {
      published.push({ topic, message });
      return 1;
    },
  } as unknown as Parameters<typeof createHandler>[0];

  const handler = createHandler(server);

  /** Everything published to one feed, parsed. */
  const on = (feed: string) =>
    published
      .filter((p) => p.topic === `feed:${MARKET}:${feed}`)
      .map((p) => JSON.parse(p.message) as { feed: string; marketId: string; data: any });

  return { handler, published, on };
}

const depth = {
  market: MARKET,
  lastUpdateId: 7,
  timestamp: 1_756_000_000_000,
  bids: [["100", "5"]] as [string, string][],
  asks: [["101", "5"]] as [string, string][],
};

const reply = (
  wsServer: Record<string, unknown> | null,
  wsUser?: Record<string, unknown[]>,
): TEngineResponseSchema =>
  ({
    correlationId: "c-1",
    ok: true,
    data: {
      backend: null,
      ...(wsServer ? { wsServer } : {}),
      ...(wsUser ? { wsUser } : {}),
    },
    error: "",
  }) as unknown as TEngineResponseSchema;

const trade = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  price: "100",
  qty: "1",
  side: "buy",
  ts: 1_756_000_000_000,
  ...over,
});

describe("createHandler", () => {
  it("publishes one message per print, not one per engine reply", async () => {
    // A market order that sweeps two levels is two trades at two prices.
    // Collapsing them would report the sweep as a single trade at whichever
    // price happened to be first.
    const h = harness();
    await h.handler(
      reply({
        depth,
        lastTradedPrice: "101",
        indexPrice: "200",
        trades: [
          trade({ id: "t1", price: "101" }),
          trade({ id: "t2", price: "102" }),
        ],
      }),
    );

    const prints = h.on("trades");
    expect(prints).toHaveLength(2);
    expect(prints.map((p) => p.data.price)).toEqual(["101", "102"]);
    expect(prints[0]!.feed).toBe("trades");
    expect(prints[0]!.marketId).toBe(MARKET);
  });

  it("carries the aggressor's side", async () => {
    const h = harness();
    await h.handler(
      reply({
        depth,
        lastTradedPrice: "101",
        indexPrice: "200",
        trades: [trade({ side: "sell" })],
      }),
    );

    expect(h.on("trades")[0]!.data.side).toBe("sell");
  });

  it("publishes nothing identifying — no account and no order", async () => {
    const h = harness();
    await h.handler(
      reply({
        depth,
        lastTradedPrice: "101",
        indexPrice: "200",
        trades: [trade()],
      }),
    );

    const data = h.on("trades")[0]!.data;
    expect(Object.keys(data).sort()).toEqual(["id", "price", "qty", "side", "ts"]);

    // The whole broadcast, not just the print: a uuid leaking into any topic on
    // this socket is the same disclosure.
    const everything = h.published.map((p) => p.message).join(" ");
    for (const forbidden of ["makerId", "takerId", "makerOrderId", "takerOrderId", "userId"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("publishes no trades topic at all when the reply produced none", async () => {
    // The common case by a wide margin: the price poller's ~1 Hz sweep produces
    // a depth broadcast per market and almost never a fill.
    const h = harness();
    await h.handler(reply({ depth, lastTradedPrice: "101", indexPrice: "200", trades: [] }));

    expect(h.on("trades")).toHaveLength(0);
    expect(h.on("depth")).toHaveLength(1);
  });

  it("tolerates a reply from an engine that does not send the field", async () => {
    // `trades` is optional on the wire so a rolling deploy cannot drop depth
    // frames while the two processes disagree about the payload.
    const h = harness();
    await h.handler(reply({ depth, lastTradedPrice: "101", indexPrice: "200" }));

    expect(h.on("trades")).toHaveLength(0);
    expect(h.on("depth")).toHaveLength(1);
  });

  it("publishes the index price the engine now keeps up to date", async () => {
    const h = harness();
    await h.handler(reply({ depth, lastTradedPrice: "101", indexPrice: "212.5" }));

    expect(h.on("mark-price")[0]!.data.price).toBe("212.5");
  });

  it("ignores a reply with no wsServer payload", async () => {
    const h = harness();
    await h.handler(reply(null));
    expect(h.published).toHaveLength(0);
  });
});

/**
 * The private channel's fan-out (Phase 13).
 *
 * The public assertions above are about what must NOT be on a topic anyone can
 * subscribe to. These are the mirror image: an account's events must reach that
 * account's topic and no other, and the isolation has to be a property of the
 * topic each message is published to rather than of anything a client is
 * trusted to filter.
 */
describe("createHandler — the user channel", () => {
  const fill = (over: Record<string, unknown> = {}) => ({
    type: "fill",
    fillId: "f-1",
    orderId: "o-1",
    marketId: MARKET,
    side: "LONG",
    role: "taker",
    price: "100",
    qty: "1",
    ts: 1_756_000_000_000,
    ...over,
  });

  /** Everything published to one user's topic, parsed. */
  const forUser = (h: ReturnType<typeof harness>, userId: string) =>
    h.published
      .filter((p) => p.topic === `user:${userId}`)
      .map((p) => JSON.parse(p.message) as { feed: string; data: { events: any[] } });

  it("publishes one message per user, to that user's own topic", async () => {
    const h = harness();
    await h.handler(
      reply(null, {
        "user-a": [fill({ role: "taker", side: "LONG" })],
        "user-b": [fill({ role: "maker", side: "SHORT", orderId: "o-2" })],
      }),
    );

    expect(h.published.map((p) => p.topic).sort()).toEqual([
      "user:user-a",
      "user:user-b",
    ]);
    expect(forUser(h, "user-a")[0]!.data.events[0].role).toBe("taker");
    expect(forUser(h, "user-b")[0]!.data.events[0].role).toBe("maker");
  });

  it("a trade between two accounts shows each of them only its own side", async () => {
    // The maker/taker case the whole phase exists for. One trade, two events,
    // opposite sides — and neither message may mention the other account.
    const h = harness();
    await h.handler(
      reply(null, {
        maker: [fill({ role: "maker", side: "SHORT", orderId: "m-1" })],
        taker: [fill({ role: "taker", side: "LONG", orderId: "t-1" })],
      }),
    );

    expect(forUser(h, "maker")[0]!.data.events[0].side).toBe("SHORT");
    expect(forUser(h, "taker")[0]!.data.events[0].side).toBe("LONG");

    expect(h.published.find((p) => p.topic === "user:maker")!.message).not.toContain("taker");
    expect(h.published.find((p) => p.topic === "user:taker")!.message).not.toContain("maker");
  });

  it("keeps one engine reply as ONE message per user", async () => {
    // A sweep across three levels is three fills against one order. Published
    // separately they would raise three toasts for one trade; the batch
    // boundary is what lets the client aggregate them.
    const h = harness();
    await h.handler(
      reply(null, {
        "user-a": [fill({ fillId: "f-1" }), fill({ fillId: "f-2" }), fill({ fillId: "f-3" })],
      }),
    );

    const messages = forUser(h, "user-a");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.data.events).toHaveLength(3);
  });

  it("publishes nothing for a user whose event list is empty", async () => {
    const h = harness();
    await h.handler(reply(null, { "user-a": [] }));
    expect(h.published).toHaveLength(0);
  });

  it("relays what the engine addressed without inspecting it", async () => {
    // ws-server derives no ownership: §6.14 proposed it and the engine does it
    // instead, because a fill row names two accounts and records no side. This
    // asserts the consequence — an event shape this file has never heard of is
    // still delivered intact to the right topic.
    const h = harness();
    await h.handler(
      reply(null, { "user-a": [{ type: "something.new", whatever: 1 } as never] }),
    );

    expect(forUser(h, "user-a")[0]!.data.events[0]).toEqual({
      type: "something.new",
      whatever: 1,
    });
  });

  it("publishes the user batch BEFORE the public feeds", async () => {
    // Both describe the same trade. Crossed on the wire, a maker could watch
    // their own level vanish from the ladder a frame before being told what
    // filled it.
    const h = harness();
    await h.handler(
      reply({ depth, lastTradedPrice: "101", indexPrice: "200", trades: [trade()] }, {
        "user-a": [fill()],
      }),
    );

    expect(h.published[0]!.topic).toBe("user:user-a");
  });

  it("ignores a reply with no wsUser block", async () => {
    // Every reply from an engine that predates this field, and most replies
    // from one that does not: a depth-only tick concerns nobody in particular.
    const h = harness();
    await h.handler(reply({ depth, lastTradedPrice: "101", indexPrice: "200" }));
    expect(h.published.some((p) => p.topic.startsWith("user:"))).toBe(false);
  });
});
