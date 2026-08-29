import { afterEach, describe, expect, it } from "bun:test";
import {
  cancelOrder,
  createOrder,
  getBalances,
  getDepth,
  getMarkets,
  getOpenPositions,
  onramp,
} from "./endpoints";
import { ApiError } from "./errors";
import { MARKETS, marketFromDto } from "../markets";

const realFetch = globalThis.fetch;

type Captured = { url: string; init: RequestInit };
let last: Captured = { url: "", init: {} };

function respondWith(status: number, body: unknown) {
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    last = { url: String(input), init };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const marketDto = {
  id: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
  slug: "SOL-USD",
  base: "SOL",
  quote: "USD",
  priceDecimals: 2,
  sizeDecimals: 2,
  tickSize: "0.01",
  maxLeverage: 30,
  binanceSymbol: "SOLUSDT",
  imageUrl: null,
};

describe("route paths", () => {
  it("uses the real paths, not the ones the TODO comments claim", async () => {
    // The terminal's `TODO(api)` comments say `/order/onramp` and
    // `/order/equity/balances`. Both routers mount at the root, so both are
    // wrong; getting this right is why endpoints live in one module.
    respondWith(200, { balances: { available: 1, locked: 0 } });
    await getBalances();
    expect(last.url).toEndWith("/equity/balances");

    respondWith(200, { userId: "u", available: 500 });
    await onramp("500");
    expect(last.url).toEndWith("/onramp");
  });

  it("encodes ids into the path", async () => {
    respondWith(200, { positions: [] });
    await getOpenPositions("a/b");
    expect(last.url).toEndWith("/positions/open/a%2Fb");
  });

  it("puts the market id in the depth query string", async () => {
    respondWith(200, {
      market: marketDto.id,
      lastUpdateId: 1,
      timestamp: 2,
      bids: [],
      asks: [],
    });
    await getDepth(marketDto.id);
    expect(last.url).toContain(`/depth?marketId=${marketDto.id}`);
  });

  it("uses DELETE to cancel", async () => {
    respondWith(200, {
      order: {
        id: "o",
        userId: "u",
        marketId: "m",
        positionType: "LONG",
        orderType: "limit",
        status: "cancelled",
        qty: "1",
        filledQty: "0",
        price: "95",
        slippage: 0,
        initialMargin: "95",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      cancelledQty: 1,
      balances: { releasedMargin: 95, available: 100, locked: 0 },
    });

    const result = await cancelOrder("o");
    expect(last.init.method).toBe("DELETE");
    // Engine numbers, normalised on the way in.
    expect(result.cancelledQty).toBe("1");
    expect(result.balances.releasedMargin).toBe("95");
  });
});

describe("getMarkets", () => {
  it("unwraps the envelope to a plain array", async () => {
    respondWith(200, { markets: [marketDto] });
    const markets = await getMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]!.slug).toBe("SOL-USD");
  });

  it("rejects a market with null metadata rather than rendering it", async () => {
    // What an unseeded database would produce. A null tick size must never
    // reach a NumericInput's step.
    respondWith(200, { markets: [{ ...marketDto, tickSize: null }] });
    const err = (await getMarkets().catch((e) => e)) as ApiError;
    expect(err.code).toBe("SCHEMA");
  });
});

describe("createOrder", () => {
  const validLimit = {
    orderType: "limit",
    price: 95,
    slippage: 0,
    qty: 1,
    equity: 95,
    type: "LONG",
    market: "SOL-USD",
  } as const;

  it("sends a well-formed limit order", async () => {
    respondWith(200, {
      orderId: "o",
      status: "open",
      filledQty: 0,
      totalPrice: 0,
      averagePrice: 0,
      fills: [],
    });

    const result = await createOrder({ ...validLimit });
    expect(JSON.parse(String(last.init.body))).toMatchObject({
      orderType: "limit",
      slippage: 0,
      market: "SOL-USD",
    });
    expect(result.filledQty).toBe("0");
  });

  it("refuses a malformed payload before it reaches the network", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    // A limit order may not carry slippage — CreateOrderSchema is a
    // discriminated union and the client validates with the server's own copy.
    const err = (await createOrder({
      ...validLimit,
      slippage: 1,
    } as never).catch((e) => e)) as ApiError;

    expect(called).toBe(false);
    // Reported exactly like a server rejection, so the ticket has one branch.
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(err.fieldErrors ?? {})).toContain("slippage");
  });
});

describe("the static market list stays in step with the seed", () => {
  it("matches what GET /markets serves", async () => {
    // `MARKETS` still backs the terminal's client components until their phases
    // land. It previously held invented UUIDs (00000000-…-0001) and leverage
    // caps of 10/20/20 against the engine's 30/3/8 — a socket subscribed to a
    // topic nothing published to, and a slider offering rejected orders.
    respondWith(200, {
      markets: [
        marketDto,
        {
          ...marketDto,
          id: "e59931c4-c54a-435f-8c57-382fa60fca58",
          slug: "BTC-USD",
          base: "BTC",
          priceDecimals: 1,
          sizeDecimals: 4,
          tickSize: "0.1",
          maxLeverage: 8,
          binanceSymbol: "BTCUSDT",
        },
        {
          ...marketDto,
          id: "13931aa2-9054-4e34-ac0f-4a8afad48226",
          slug: "ETH-USD",
          base: "ETH",
          priceDecimals: 2,
          sizeDecimals: 3,
          tickSize: "0.01",
          maxLeverage: 3,
          binanceSymbol: "ETHUSDT",
        },
      ],
    });

    const served = (await getMarkets()).map(marketFromDto);

    for (const market of served) {
      const fallback = MARKETS.find((m) => m.slug === market.slug);
      expect(fallback).toBeDefined();
      expect(fallback).toEqual(market);
    }
    expect(MARKETS).toHaveLength(served.length);
  });
});
