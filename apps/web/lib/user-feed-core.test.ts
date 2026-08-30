import { describe, expect, it } from "bun:test";
import {
  groupFills,
  isResting,
  MAX_SEEN_FILLS,
  parseUserFrame,
  reduceOpenOrders,
  reducePositionEntries,
  rememberFills,
  supersedes,
  type UserEvent,
  type UserOrder,
} from "./user-feed-core";

/**
 * The private channel's reducers.
 *
 * Almost every assertion below is about an event that is OUT OF DATE, because
 * that is the only interesting thing about this module. The reconnect
 * discipline replays buffered events over a fresh REST snapshot on purpose
 * (§7.3), so "apply an event the snapshot already contains" is the normal
 * path, not an edge case — and after Phase 13 there is no refetch left to
 * paper over a reducer that gets it wrong.
 */

const MARKET = "e3289213-372c-44d2-8cc8-2a6eb55b11b1";

const order = (over: Partial<UserOrder> = {}): UserOrder => ({
  id: "o-1",
  marketId: MARKET,
  positionType: "LONG",
  orderType: "limit",
  status: "open",
  qty: "5",
  filledQty: "0",
  price: "100",
  slippage: 0,
  initialMargin: "500",
  createdAt: "2026-08-30T00:00:00.000Z",
  ...over,
});

const frame = (events: unknown[]) =>
  JSON.stringify({ feed: "user", data: { events } });

const fillEvent = (over: Record<string, unknown> = {}): UserEvent =>
  ({
    type: "fill",
    fillId: "f-1",
    orderId: "o-1",
    marketId: MARKET,
    side: "LONG",
    role: "maker",
    price: "100",
    qty: "1",
    ts: 1_756_000_000_000,
    ...over,
  }) as UserEvent;

/* ------------------------------------------------------------- parsing -- */

describe("parseUserFrame", () => {
  it("returns the batch a message carried", () => {
    const events = parseUserFrame(
      frame([
        { type: "balance", available: "100", locked: "0" },
        { type: "position", marketId: MARKET, position: null },
      ]),
    );
    expect(events).toHaveLength(2);
    expect(events![0]!.type).toBe("balance");
  });

  it("drops the subscription acknowledgement", () => {
    // ws-server sends `{ type: "system" }` on open. It is not an event and must
    // not reach a reducer.
    expect(parseUserFrame(JSON.stringify({ type: "system", message: "hi" }))).toBeNull();
  });

  it("drops a public feed frame", () => {
    // The two sockets are separate, so this should be unreachable — but the
    // cost of the check is one comparison and the cost of being wrong is a
    // depth payload handed to the orders reducer.
    expect(
      parseUserFrame(JSON.stringify({ feed: "depth", marketId: MARKET, data: {} })),
    ).toBeNull();
  });

  it("returns null for malformed input rather than throwing", () => {
    // A frame that threw would take down the socket that carries the only
    // notice an account gets that its order filled.
    expect(parseUserFrame("not json")).toBeNull();
    expect(parseUserFrame("null")).toBeNull();
    expect(parseUserFrame(JSON.stringify({ feed: "user" }))).toBeNull();
  });

  it("keeps the events it understands and drops the ones it does not", () => {
    // A newer engine emitting a sixth event type must not cost this client the
    // five it already handles.
    const events = parseUserFrame(
      frame([
        { type: "something.new", whatever: 1 },
        { type: "balance", available: "7", locked: "0" },
        { type: "balance", available: "not-a-string-field" },
      ]),
    );
    expect(events).toHaveLength(1);
    expect(events![0]).toEqual({ type: "balance", available: "7", locked: "0" });
  });
});

/* ------------------------------------------------------------ ordering -- */

describe("supersedes", () => {
  it("accepts an update that fills more of the order", () => {
    expect(
      supersedes(
        { status: "open", filledQty: "0" },
        { status: "partially_filled", filledQty: "2" },
      ),
    ).toBe(true);
  });

  it("accepts a status-only transition at the same filled quantity", () => {
    // Cancelling a resting order that has never traded.
    expect(
      supersedes({ status: "open", filledQty: "0" }, { status: "cancelled", filledQty: "0" }),
    ).toBe(true);
  });

  it("REFUSES an update that would un-fill an order", () => {
    // The event that predates the snapshot. A buffered `partially_filled: 2`
    // replayed after a snapshot already saw `filled: 5` would put the row back
    // on the Open-orders table, and nothing would take it off again.
    expect(
      supersedes(
        { status: "partially_filled", filledQty: "5" },
        { status: "partially_filled", filledQty: "2" },
      ),
    ).toBe(false);
  });

  it("REFUSES anything at all once the order is terminal", () => {
    // `filled` and `cancelled` are the end of an order's life.
    expect(
      supersedes({ status: "filled", filledQty: "5" }, { status: "open", filledQty: "5" }),
    ).toBe(false);
    expect(
      supersedes({ status: "cancelled", filledQty: "0" }, { status: "open", filledQty: "0" }),
    ).toBe(false);
  });
});

describe("isResting", () => {
  it("means exactly what GET /orders/open means", () => {
    // The equivalence is what lets the REST snapshot and the push stream be
    // the same list.
    expect(["open", "partially_filled"].every(isResting)).toBe(true);
    expect(["pending", "filled", "cancelled"].some(isResting)).toBe(false);
  });
});

/* -------------------------------------------------------- open orders -- */

type Row = { id: string; status: any; filledQty: string; slug: string };

const toRow = (o: UserOrder): Row | null =>
  o.marketId === MARKET
    ? { id: o.id, status: o.status, filledQty: o.filledQty, slug: "SOL-USD" }
    : null;

describe("reduceOpenOrders", () => {
  it("inserts a resting order the account just placed", () => {
    const rows = reduceOpenOrders(
      [],
      { type: "order.new", order: order(), origin: "user" },
      toRow,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("o-1");
  });

  it("does NOT insert an order that never rested", () => {
    // A market order that filled instantly is created and finished in the same
    // engine reply. It belongs in history, not on this table.
    const rows = reduceOpenOrders(
      [],
      {
        type: "order.new",
        order: order({ status: "filled", filledQty: "5" }),
        origin: "user",
      },
      toRow,
    );
    expect(rows).toEqual([]);
  });

  it("ignores an order in a market this build does not know", () => {
    // The table renders a slug; inventing one for an unknown UUID would be
    // worse than not showing the row.
    const rows = reduceOpenOrders(
      [],
      { type: "order.new", order: order({ marketId: "unknown" }), origin: "user" },
      toRow,
    );
    expect(rows).toEqual([]);
  });

  it("does not double a row when a batch is redelivered", () => {
    const first = reduceOpenOrders(
      [],
      { type: "order.new", order: order(), origin: "user" },
      toRow,
    );
    const second = reduceOpenOrders(
      first,
      { type: "order.new", order: order(), origin: "user" },
      toRow,
    );
    expect(second).toHaveLength(1);
  });

  it("patches a resting row when it is partially filled", () => {
    const rows = reduceOpenOrders(
      [{ id: "o-1", status: "open", filledQty: "0", slug: "SOL-USD" }],
      {
        type: "order.update",
        orderId: "o-1",
        marketId: MARKET,
        status: "partially_filled",
        filledQty: "2",
      },
      toRow,
    );
    expect(rows[0]!.status).toBe("partially_filled");
    expect(rows[0]!.filledQty).toBe("2");
  });

  it("REMOVES a row that reached a terminal state", () => {
    // The maker case this whole phase is for: somebody else's order filled
    // ours, and the row has to leave without anyone asking.
    const rows = reduceOpenOrders(
      [{ id: "o-1", status: "open", filledQty: "0", slug: "SOL-USD" }],
      {
        type: "order.update",
        orderId: "o-1",
        marketId: MARKET,
        status: "filled",
        filledQty: "5",
      },
      toRow,
    );
    expect(rows).toEqual([]);
  });

  it("IGNORES an update for an order it does not hold", () => {
    // Ordinary and frequent: an order that filled instantly never rested, so
    // its update is about a row that was never on this list. Inserting one
    // from an update would produce a row of blanks — the update carries no
    // price, quantity or side.
    const rows = reduceOpenOrders(
      [],
      {
        type: "order.update",
        orderId: "ghost",
        marketId: MARKET,
        status: "filled",
        filledQty: "5",
      },
      toRow,
    );
    expect(rows).toEqual([]);
  });

  it("drops an update that predates what it holds", () => {
    const held = [{ id: "o-1", status: "partially_filled" as const, filledQty: "4", slug: "SOL-USD" }];
    const rows = reduceOpenOrders(
      held,
      {
        type: "order.update",
        orderId: "o-1",
        marketId: MARKET,
        status: "partially_filled",
        filledQty: "1",
      },
      toRow,
    );
    // Same array identity: nothing was applied, so nothing re-renders.
    expect(rows).toBe(held as never);
  });

  it("applies a whole batch in order — created, then finished, leaves nothing", () => {
    // One engine reply can both create an order and end it. The net effect on
    // this list is nothing, which only comes out right if the batch is folded
    // rather than applied out of order.
    const batch: UserEvent[] = [
      { type: "order.new", order: order(), origin: "user" },
      {
        type: "order.update",
        orderId: "o-1",
        marketId: MARKET,
        status: "filled",
        filledQty: "5",
      },
    ];
    let rows: Row[] = [];
    for (const event of batch) rows = reduceOpenOrders(rows, event, toRow);
    expect(rows).toEqual([]);
  });

  it("leaves the list alone for events it is not the owner of", () => {
    const held: Row[] = [{ id: "o-1", status: "open", filledQty: "0", slug: "SOL-USD" }];
    for (const event of [
      fillEvent(),
      { type: "balance", available: "1", locked: "0" } as UserEvent,
      { type: "position", marketId: MARKET, position: null } as UserEvent,
    ]) {
      expect(reduceOpenOrders(held, event, toRow)).toBe(held as never);
    }
  });
});

/* ---------------------------------------------------------- positions -- */

type Entry = { marketId: string; qty: string };
const marketIdOf = (e: Entry) => e.marketId;
const toEntry = (p: { marketId: string; qty: string }): Entry | null =>
  p.marketId === MARKET ? { marketId: p.marketId, qty: p.qty } : null;

const position = (over: Record<string, unknown> = {}) => ({
  marketId: MARKET,
  type: "LONG" as const,
  qty: "3",
  margin: "300",
  averagePrice: "100",
  liquidationPrice: "1",
  ...over,
});

describe("reducePositionEntries", () => {
  it("inserts a position the account has just opened", () => {
    const entries = reducePositionEntries(
      [] as Entry[],
      { type: "position", marketId: MARKET, position: position() },
      { marketIdOf, toEntry },
    );
    expect(entries).toEqual([{ marketId: MARKET, qty: "3" }]);
  });

  it("replaces rather than merges — the event is absolute", () => {
    // Netting, the weighted average price and the liquidation price are all
    // engine arithmetic. Anything this file did with the old row would be a
    // second risk model.
    const entries = reducePositionEntries(
      [{ marketId: MARKET, qty: "3" }],
      { type: "position", marketId: MARKET, position: position({ qty: "8" }) },
      { marketIdOf, toEntry },
    );
    expect(entries).toEqual([{ marketId: MARKET, qty: "8" }]);
  });

  it("REMOVES the row on a null position", () => {
    // What makes a close, a netting-to-flat and a liquidation all take the row
    // off screen with nothing refetched.
    const entries = reducePositionEntries(
      [{ marketId: MARKET, qty: "3" }],
      { type: "position", marketId: MARKET, position: null },
      { marketIdOf, toEntry },
    );
    expect(entries).toEqual([]);
  });

  it("ignores a market this build does not know", () => {
    const held = [{ marketId: MARKET, qty: "3" }];
    const entries = reducePositionEntries(
      held,
      {
        type: "position",
        marketId: "unknown",
        position: position({ marketId: "unknown" }),
      },
      { marketIdOf, toEntry },
    );
    expect(entries).toBe(held);
  });
});

/* -------------------------------------------------------------- fills -- */

describe("groupFills", () => {
  it("collapses a sweep into one group at the weighted average price", () => {
    // Three levels, one trade. Three toasts would be noise, and each would
    // state a price that is only part of what was paid.
    const groups = groupFills([
      fillEvent({ fillId: "f-1", price: "100", qty: "1" }),
      fillEvent({ fillId: "f-2", price: "102", qty: "1" }),
      fillEvent({ fillId: "f-3", price: "104", qty: "2" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.qty).toBe("4");
    // (100 + 102 + 208) / 4
    expect(Number(groups[0]!.price)).toBeCloseTo(102.5, 8);
    expect(groups[0]!.fillIds).toEqual(["f-1", "f-2", "f-3"]);
  });

  it("keeps fills against different orders apart", () => {
    // A liquidation sweep can fill this account's resting order at the same
    // moment it closes their position. Two orders, two toasts.
    const groups = groupFills([
      fillEvent({ fillId: "f-1", orderId: "o-1" }),
      fillEvent({ fillId: "f-2", orderId: "o-2" }),
    ]);
    expect(groups.map((g) => g.orderId).sort()).toEqual(["o-1", "o-2"]);
  });

  it("applies a duplicate fill id once", () => {
    const groups = groupFills([
      fillEvent({ fillId: "f-1", qty: "1" }),
      fillEvent({ fillId: "f-1", qty: "1" }),
    ]);
    expect(groups[0]!.qty).toBe("1");
    expect(groups[0]!.fillIds).toEqual(["f-1"]);
  });

  it("skips a fill already announced", () => {
    // A row is idempotent; a toast is not. The reconnect drain replays events
    // the snapshot may already cover.
    const groups = groupFills([fillEvent({ fillId: "f-1" })], new Set(["f-1"]));
    expect(groups).toEqual([]);
  });

  it("ignores a fill with an unusable price or quantity", () => {
    expect(groupFills([fillEvent({ qty: "0" })])).toEqual([]);
    expect(groupFills([fillEvent({ price: "" })])).toEqual([]);
  });
});

describe("rememberFills", () => {
  it("remembers what it was given", () => {
    expect([...rememberFills(new Set(["a"]), ["b"])]).toEqual(["a", "b"]);
  });

  it("forgets the oldest rather than growing without bound", () => {
    // A session left open all day would otherwise carry one entry per fill
    // forever. Forgetting an id from thousands of trades ago costs at most a
    // repeated toast.
    const ids = Array.from({ length: MAX_SEEN_FILLS + 10 }, (_, i) => `f-${i}`);
    const seen = rememberFills(new Set(), ids);
    expect(seen.size).toBe(MAX_SEEN_FILLS);
    expect(seen.has("f-0")).toBe(false);
    expect(seen.has(`f-${MAX_SEEN_FILLS + 9}`)).toBe(true);
  });
});
