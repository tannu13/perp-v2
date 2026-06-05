interface LastTradedPrice {
  price: number;
}

interface MarkPriceData {
  price: number;
}

interface DepthData {
  market: string;
  lastUpdateId: number;
  timestamp: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface TradeMessage {
  feed: "last-traded-price";
  marketId: string;
  data: LastTradedPrice;
}

interface MarkPriceMessage {
  feed: "mark-price";
  marketId: string;
  data: MarkPriceData;
}

interface DepthMessage {
  feed: "depth";
  marketId: string;
  data: DepthData;
}

type PerpExchangeMessage = TradeMessage | MarkPriceMessage | DepthMessage;

const ws = new WebSocket(
  "ws://localhost:3010?feeds=last-traded-price,mark-price,depth&market_id=e3289213-372c-44d2-8cc8-2a6eb55b11b1",
);
ws.onmessage = (event: MessageEvent) => {
  try {
    const message: PerpExchangeMessage = JSON.parse(event.data);
    const { feed, marketId, data } = message;

    switch (feed) {
      case "last-traded-price":
        handleLastTradedPrice(data, marketId);
        break;

      case "mark-price":
        handleMarkPrice(data, marketId);
        break;

      case "depth":
        handleOrderBookDepth(data, marketId);
        break;

      default: {
        // Exhaustive check protection
        const _exhaustiveCheck: never = feed;
        console.warn(`Unhandled feed type received: ${_exhaustiveCheck}`);
      }
    }
  } catch (error) {
    console.error("Failed to parse or process WebSocket message:", error);
  }
};

function handleLastTradedPrice(data: LastTradedPrice, marketId: string): void {
  console.log(`[${marketId}] Last Traded Price: ${data.price}`);
}

function handleMarkPrice(data: MarkPriceData, marketId: string): void {
  console.log(`[${marketId}] Mark Price updated to: $${data.price}`);
}

function handleOrderBookDepth(data: DepthData, marketId: string): void {
  const topBid = data.bids[0]?.[0] ?? 0;
  const topAsk = data.asks[0]?.[0] ?? 0;
  console.log(`[${marketId}] Order Book spread: $${topBid} - $${topAsk}`);
  console.log(data);
}
