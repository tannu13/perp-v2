const ws = new WebSocket(
  "ws://localhost:3010?feeds=last-traded-price,mark-price",
);

ws.onmessage = (event) => {
  console.log("Received data:", JSON.parse(event.data));
};

// Once connected, subscribe to the stocks and news feeds
ws.onopen = () => {
  // Subscribe to stocks
  ws.send(JSON.stringify({ action: "subscribe", feed: "stocks" }));

  // Subscribe to news
  ws.send(JSON.stringify({ action: "subscribe", feed: "news" }));
};
