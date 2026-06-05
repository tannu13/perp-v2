import type { TSendToResponseStream } from "./setupComms";

type BinanceEvent = {
  stream: string; // stream name
  data: {
    e: string; // event type
    E: number; // event time
    s: string; // symbol
    c: string; // close - this is needed
    o: string; // open
    h: string; // high
    l: string; // low
    v: string; // volume
    q: string; // volume traded denominated in the quote asset
  };
};

const BINANCE_WS_URI =
  "wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/solusdt@miniTicker/ethusdt@miniTicker";
const INTERVAL = 1000;
let socket: WebSocket | null = null;
export const createPoller = (sendUpdates: TSendToResponseStream) => {
  const binanceMessages: Record<"BTC" | "SOL" | "ETH", string | null> = {
    BTC: null,
    ETH: null,
    SOL: null,
  };

  const connect = () => {
    socket = new WebSocket(BINANCE_WS_URI);

    socket.addEventListener("open", (event) => {
      console.log("Connected to server!");
      resetPushingEvents();
    });

    socket.addEventListener("message", (event) => {
      const parsedData = JSON.parse(event.data);
      if (parsedData.data.s === "SOLUSDT") {
        binanceMessages["SOL"] = parsedData.data.c;
      } else if (parsedData.data.s === "BTCUSDT") {
        binanceMessages["BTC"] = parsedData.data.c;
      } else if (parsedData.data.s === "ETHUSDT") {
        binanceMessages["ETH"] = parsedData.data.c;
      }
    });

    socket.addEventListener("error", (error) => {
      console.error("WebSocket Error:", error);
    });

    socket.addEventListener("close", (event) => {
      console.log("Connection closed:", event.reason);
      socket = null;
      clearInterval(intervalId);
      binanceMessages["SOL"] = null;
      binanceMessages["BTC"] = null;
      binanceMessages["ETH"] = null;
      setTimeout(() => {
        resetPushingEvents();
        connect();
      }, 5000);
    });
  };

  let intervalId: NodeJS.Timeout;
  const resetPushingEvents = () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
    intervalId = setInterval(() => {
      const lastPriceForSOL = binanceMessages.SOL;
      const lastPriceForBTC = binanceMessages.BTC;
      const lastPriceForETH = binanceMessages.ETH;

      binanceMessages.SOL = null;
      binanceMessages.BTC = null;
      binanceMessages.ETH = null;

      sendUpdates("spot_price_update", {
        SOL: lastPriceForSOL,
      });
      sendUpdates("spot_price_update", {
        BTC: lastPriceForBTC,
      });
      sendUpdates("spot_price_update", {
        ETH: lastPriceForETH,
      });
    }, INTERVAL);
  };

  return { connect };
};
