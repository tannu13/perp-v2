import type { InsertFillRecord, SelectOrderRecord } from "@repo/db/schema";

export type TPositionType = "LONG" | "SHORT";
export type TOrderType = "market" | "limit";
export type TOrderStatus = "open" | "partially_filled" | "filled" | "cancelled";

type StringNumberFields = "qty" | "filledQty" | "price" | "initialMargin";

type Numberified<T> = {
  [K in keyof T]: K extends StringNumberFields ? number : T[K];
};

export type OrderRecordNumberified = Numberified<SelectOrderRecord>;
export type FillRecordNumberified = Numberified<InsertFillRecord>;

export type TPosition = {
  marketId: string;
  type: TPositionType;
  qty: number;
  margin: number;
  liquidationPrice: number;
  pnL?: number;
  averagePrice: number;
};

type TCollateral = {
  available: number;
  locked: number;
};

// export type TOrder = {
//   orderId: number;
//   market: string;
//   type: TPositionType;
//   qty: number;
//   margin: number;
//   orderType: TOrderType;
//   price: number;
//   status: TOrderStatus;
// };
export type TUser = {
  userId: string;
  collateral: TCollateral;
  positions: TPosition[];
  closedPositions: TPosition[];
};
export type TUsers = Map<string, TUser>;
const users: TUsers = new Map([
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

// in-memory store but needs more data in them so that user orders aren't needed
export type TOpenOrder = {
  userId: string;
  qty: number;
  filledQty: number;
  orderId: string;
  status: TOrderStatus;
  margin: number;
  marketId: string;
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
type TOrderbooks = Record<string, TOrderbook>;

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
  lastUserId: number;
  lastOrderId: number;
};

const SUPPORTED_ASSETS = {
  SOL: {
    asset: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
    lastTradedPrice: 90,
    indexPrice: 85,
    allowedLeverage: 30,
  },
  ETH: {
    asset: "13931aa2-9054-4e34-ac0f-4a8afad48226",
    lastTradedPrice: 1900,
    indexPrice: 1850,
    allowedLeverage: 3,
  },
  BTC: {
    asset: "e59931c4-c54a-435f-8c57-382fa60fca58",
    lastTradedPrice: 5000,
    indexPrice: 4930,
    allowedLeverage: 8,
  },
};

export function createExchangeStore(): TStore {
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
  return {
    users,
    orderbooks,
    fills: [],
    totalSystemDeposits: 0,
    lastUserId: 4,
    lastOrderId: 0,
  };
}
