import type {
  SendToResponseStreamArgs,
  TSendToResponseStream,
} from "./setupComms";

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
export const createPoller = (sendUpdates: TSendToResponseStream) => {
  const binanceMessages: Record<"BTC" | "SOL" | "ETH", string | null> = {
    BTC: null,
    ETH: null,
    SOL: null,
  };

  const socket = new WebSocket(BINANCE_WS_URI);

  // 2. Connection opened
  socket.addEventListener("open", (event) => {
    console.log("Connected to server!");
    // socket.send("Hello Server!"); // Send a message
  });

  // 3. Listen for messages
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

  // 4. Handle errors
  socket.addEventListener("error", (error) => {
    console.error("WebSocket Error:", error);
  });

  // 5. Handle connection close
  socket.addEventListener("close", (event) => {
    console.log("Connection closed:", event.reason);
  });

  const intervalId = setInterval(() => {
    console.log("================================================");

    const lastPriceForSOL = binanceMessages.SOL;
    console.log("lastPriceForSOL", lastPriceForSOL);

    const lastPriceForBTC = binanceMessages.BTC;
    console.log("lastPriceForBTC", lastPriceForBTC);

    const lastPriceForETH = binanceMessages.ETH;
    console.log("lastPriceForETH", lastPriceForETH);

    binanceMessages.SOL = null;
    binanceMessages.BTC = null;
    binanceMessages.ETH = null;

    sendUpdates("spot_price_update", {
      SOL: lastPriceForSOL,
      BTC: lastPriceForBTC,
      ETH: lastPriceForETH,
    });
    console.log("================================================");
  }, INTERVAL);
};
