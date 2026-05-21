export type TPositionType = "LONG" | "SHORT";
export type TOrderType = "market" | "limit";
export type TOrderStatus = "open" | "partially_filled" | "filled" | "cancelled";

export type TPosition = {
  market: string;
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

export type TOrder = {
  orderId: number;
  market: string;
  type: TPositionType;
  qty: number;
  margin: number;
  orderType: TOrderType;
  price: number;
  status: TOrderStatus;
};
export type TUser = {
  userId: number;
  username: string;
  password: string;
  collateral: TCollateral;
  positions: TPosition[];
  orders: TOrder[];
};
const users: TUser[] = [
  {
    userId: 1,
    username: "harkirat",
    password: "123123",
    // in-memory store
    collateral: {
      available: 2000,
      locked: 1000,
    },
    // in-memory store
    positions: [
      {
        market: "SOL",
        type: "LONG",
        qty: 10,
        margin: 500,
        liquidationPrice: 80,
        averagePrice: 90,
      },
      {
        market: "ETH",
        type: "SHORT",
        qty: 1,
        margin: 500,
        liquidationPrice: 2000,
        averagePrice: 1900,
      },
    ],
    // save to db
    orders: [
      {
        orderId: 1,
        market: "SOL",
        type: "LONG",
        qty: 10,
        margin: 500,
        orderType: "limit",
        price: 90,
        status: "filled",
      },
      {
        orderId: 2,
        market: "ETH",
        type: "SHORT",
        qty: 10,
        margin: 500,
        orderType: "limit",
        price: 1900,
        status: "filled",
      },
      {
        orderId: 3,
        market: "BTC",
        type: "LONG",
        qty: 10,
        margin: 500,
        orderType: "limit",
        price: 1900,
        status: "cancelled",
      },
    ],
  },
  {
    userId: 2,
    username: "raman",
    password: "123123",
    // in-memory store
    collateral: {
      available: 2000,
      locked: 2000,
    },
    // in-memory store
    positions: [
      {
        market: "SOL",
        type: "SHORT",
        qty: 10,
        margin: 1000,
        liquidationPrice: 80,
        pnL: 200,
        averagePrice: 90,
      },
      {
        market: "ETH",
        type: "LONG",
        qty: 1,
        margin: 1000,
        liquidationPrice: 2000,
        pnL: -100,
        averagePrice: 1900,
      },
    ],
    // save to db
    orders: [
      {
        orderId: 10,
        market: "SOL",
        type: "SHORT",
        qty: 10,
        margin: 500,
        orderType: "market",
        price: 90,
        status: "filled",
      },
      {
        orderId: 11,
        market: "ETH",
        type: "LONG",
        qty: 10,
        margin: 500,
        orderType: "market",
        price: 1900,
        status: "filled",
      },
      {
        orderId: 12,
        market: "ZEC",
        type: "LONG",
        qty: 10,
        margin: 500,
        orderType: "limit",
        price: 1900,
        status: "open",
      },
    ],
  },
];

// in-memory store but needs more data in them so that user orders aren't needed
export type TOpenOrder = {
  userId: number;
  qty: number;
  filledQty: number;
  orderId: number;
  createdAt: Date;
};
// in-memory store
type TBid = {
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
  users: TUser[];
  fills: TFill[];
  totalSystemDeposits: number;
  lastUserId: number;
  lastOrderId: number;
};

const SUPPORTED_ASSETS = {
  SOL: {
    asset: "SOL",
    lastTradedPrice: 90,
    indexPrice: 85,
    allowedLeverage: 30,
  },
  ETH: {
    asset: "ETH",
    lastTradedPrice: 1900,
    indexPrice: 1850,
    allowedLeverage: 3,
  },
  BTC: {
    asset: "BTC",
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
  const users: TUser[] = [];
  return {
    orderbooks,
    users: [
      {
        userId: 1,
        username: "tuser1",
        password:
          "$2b$10$0sYC6b1Rhd96R0fhNxGte.k7csXKUTnG4EWoV/F6yit0ZdB0R1Cdi",
        collateral: {
          available: 10000,
          locked: 0,
        },
        orders: [],
        positions: [],
      },
      {
        userId: 2,
        username: "tuser2",
        password:
          "$2b$10$UMWWSKrdbHw0Cory4VGYMuxi2obssA1e2SoOlefGUBBnuREGnvl5y",
        collateral: {
          available: 10000,
          locked: 0,
        },
        orders: [],
        positions: [],
      },
      {
        userId: 3,
        username: "tuser3",
        password:
          "$2b$10$.otorzN4C7zIxhS7AL1gnOx8C1B8izsWq/XGzdT62vcNdh3iS7AWS",
        collateral: {
          available: 10000,
          locked: 0,
        },
        orders: [],
        positions: [],
      },
      {
        userId: 4,
        username: "tuser4",
        password:
          "$2b$10$LkVSdxMsg/vPgeeyIyUQS.GaxqZ6vyF8oIDhdETVS047F6CnAtXvy",
        collateral: {
          available: 10000,
          locked: 0,
        },
        orders: [],
        positions: [],
      },
    ],
    fills: [],
    totalSystemDeposits: 0,
    lastUserId: 4,
    lastOrderId: 0,
  };
}
