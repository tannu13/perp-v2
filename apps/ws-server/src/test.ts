const ws = new WebSocket(
  "ws://localhost:3010?feeds=last-traded-price,mark-price&market_id=e3289213-372c-44d2-8cc8-2a6eb55b11b1",
);

ws.onmessage = (event) => {
  console.log("Received data:", JSON.parse(event.data));
};

// Once connected, subscribe to the stocks and news feeds
ws.onopen = () => {
  // Subscribe to stocks
  // ws.send(JSON.stringify({ action: "subscribe", feed: "stocks" }));
  // Subscribe to news
  // ws.send(JSON.stringify({ action: "subscribe", feed: "news" }));
};
