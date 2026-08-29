import type {
  InsertFillRecord,
  SelectOrderRecord,
  TOrderStatusesEnum,
} from "@repo/db/schema";
import { MARKETS } from "@repo/db/markets";

export type TPositionType = "LONG" | "SHORT";
export type TOrderType = "market" | "limit";

type StringNumberFields = "qty" | "filledQty" | "price" | "initialMargin";

type Numberified<T> = {
  [K in keyof T]: K extends StringNumberFields ? number : T[K];
};

export type OrderRecordNumberified = Numberified<SelectOrderRecord>;
export type FillRecordNumberified = Numberified<InsertFillRecord>;
type UserId = string;
type OrderId = string;
type MarketId = string;

export type TPosition = {
  marketId: MarketId;
  type: TPositionType;
  qty: number;
  margin: number;
  liquidationPrice: number;
  pnL?: number;
  averagePrice: number;
};
export type TClosedPosition = {
  exitType: "MANUAL" | "LIQUIDATED";
} & TPosition;

type TCollateral = {
  available: number;
  locked: number;
};

export type TUser = {
  userId: UserId;
  collateral: TCollateral;
  positions: TPosition[];
  closedPositions: TClosedPosition[];
};
export type TUsers = Map<UserId, TUser>;
const users: TUsers = new Map();
/*
new Map([
  [
    "be064682-faac-490c-9c35-a71c9ad180be",
    {
      userId: "be064682-faac-490c-9c35-a71c9ad180be",
      collateral: {
        available: 1950,
        locked: 50,
      },
      closedPositions: [],
      positions: [
        {
          marketId: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
          type: "SHORT",
          qty: 5,
          margin: 0,
          averagePrice: 105,
          liquidationPrice: 105,
          pnL: 0,
        },
      ],
    },
  ],
  [
    "e4d48786-8cb1-4767-99f1-d35bea2b2356",
    {
      userId: "e4d48786-8cb1-4767-99f1-d35bea2b2356",
      collateral: {
        available: 1950,
        locked: 50,
      },
      closedPositions: [],
      positions: [
        {
          marketId: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
          type: "SHORT",
          qty: 5,
          margin: 50,
          averagePrice: 100,
          liquidationPrice: 109.9,
          pnL: -25,
        },
      ],
    },
  ],
  [
    "ec9638aa-bded-4ef6-963c-d0025cf10503",
    {
      userId: "ec9638aa-bded-4ef6-963c-d0025cf10503",
      collateral: {
        available: 1950,
        locked: 50,
      },
      closedPositions: [],
      positions: [
        {
          marketId: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
          type: "LONG",
          qty: 5,
          margin: 0,
          averagePrice: 100,
          liquidationPrice: 100,
          pnL: 25,
        },
      ],
    },
  ],
  [
    "a13f4673-ada6-422a-b25d-4e4dd049220d",
    {
      userId: "a13f4673-ada6-422a-b25d-4e4dd049220d",
      collateral: {
        available: 1950,
        locked: 50,
      },
      closedPositions: [],
      positions: [
        {
          marketId: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
          type: "LONG",
          qty: 5,
          margin: 50,
          averagePrice: 105,
          liquidationPrice: 95.1,
          pnL: 0,
        },
      ],
    },
  ],
]);
*/
// in-memory store but needs more data in them so that user orders aren't needed
export type TOpenOrder = {
  userId: UserId;
  qty: number;
  filledQty: number;
  orderId: OrderId;
  status: TOrderStatusesEnum;
  margin: number;
  marketId: MarketId;
  positionType: TPositionType;
  createdAt: Date;
};
// in-memory store
export type TBid = {
  availableQty: number;
  openOrders: TOpenOrder[];
};
// in-memory store
export type TOrderbook = {
  bids: Record<string, TBid>;
  asks: Record<string, TBid>;
  lastTradedPrice: number;
  indexPrice: number;
  allowedLeverage: number;
};
type TOrderbooks = Record<MarketId, TOrderbook>;

// td:: can be moved to db
export type TFill = {
  maker: number;
  taker: number;
  market: string;
  qty: number;
  price: number;
  long: number;
  short: number;
};
const fills: TFill[] = [
  {
    maker: 1,
    taker: 2,
    market: "SOL",
    qty: 10,
    price: 90,
    long: 1,
    short: 2,
  },
  {
    maker: 1,
    taker: 2,
    market: "ETH",
    qty: 1,
    price: 1900,
    long: 2,
    short: 1,
  },
];

export type TStore = {
  orderbooks: TOrderbooks;
  users: TUsers;
  fills: TFill[];
  totalSystemDeposits: number;
  supportedAssets: Record<TSupportedAssets, string>;
  lastUpdateId: number;
};

/**
 * Market identity and risk limits come from `@repo/db/markets`, which is also
 * what seeds the `markets` table and what `GET /markets` serves to the browser.
 *
 * All three used to keep their own copy. The UUIDs drifting apart meant orders
 * 404ing and WebSocket topics nothing published to; the leverage caps drifting
 * apart meant the order ticket offering 20x on ETH while the engine refused
 * anything above 3x — a rejection the user only discovered after confirming.
 * Reading one constant is what makes that a compile-time impossibility rather
 * than a documentation promise.
 *
 * Only the seed prices are genuinely engine-local: they are the opening state
 * of an empty orderbook, not a property of the market.
 */
const SUPPORTED_ASSETS = {
  SOL: {
    asset: MARKETS.SOL.id,
    lastTradedPrice: 90,
    indexPrice: 85,
    allowedLeverage: MARKETS.SOL.maxLeverage,
  },
  ETH: {
    asset: MARKETS.ETH.id,
    lastTradedPrice: 1900,
    indexPrice: 1850,
    allowedLeverage: MARKETS.ETH.maxLeverage,
  },
  BTC: {
    asset: MARKETS.BTC.id,
    lastTradedPrice: 5000,
    indexPrice: 4930,
    allowedLeverage: MARKETS.BTC.maxLeverage,
  },
} as const;
export type TSupportedAssets = keyof typeof SUPPORTED_ASSETS;

export function createExchangeStore(backupStore?: TStore | null): TStore {
  if (backupStore) {
    return backupStore;
  }
  const orderbooks: TOrderbooks = {};
  Object.entries(SUPPORTED_ASSETS).forEach(([asset, obj]) => {
    orderbooks[obj.asset] = {
      bids: {},
      asks: {},
      lastTradedPrice: obj.lastTradedPrice,
      indexPrice: obj.indexPrice,
      allowedLeverage: obj.allowedLeverage,
    };
  });
  const supportedAssets: Record<keyof typeof SUPPORTED_ASSETS, string> = {
    SOL: SUPPORTED_ASSETS["SOL"].asset,
    ETH: SUPPORTED_ASSETS["ETH"].asset,
    BTC: SUPPORTED_ASSETS["BTC"].asset,
  };
  return {
    users,
    orderbooks,
    fills: [],
    totalSystemDeposits: 0,
    supportedAssets,
    lastUpdateId: 0,
  };
}
