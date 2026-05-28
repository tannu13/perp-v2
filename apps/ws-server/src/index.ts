interface WebSocketData {
  id: string;
  subscribedFeeds: Set<string>;
}

const server = Bun.serve<WebSocketData>({
  port: 3010,
  fetch(req, server) {
    const url = new URL(req.url);
    // Get the 'feeds' param (e.g., "stocks,news") and split into an array
    const feedsParam = url.searchParams.get("feeds");
    const initialFeeds = feedsParam ? feedsParam.split(",") : [];

    const success = server.upgrade(req, {
      data: {
        id: crypto.randomUUID(),
        // Pass the extracted feeds into the socket's data object
        subscribedFeeds: new Set(initialFeeds),
      },
    });

    if (success) return undefined;
    return new Response("Upgrade failed", { status: 400 });
  },
  websocket: {
    open(ws) {
      console.log("Connected to websocket server");

      const validFeeds = ["last-traded-price", "mark-price", "depth", "trades"];
      for (const feed of ws.data.subscribedFeeds) {
        if (validFeeds.includes(feed)) {
          ws.subscribe(`feed:${feed}`);
          ws.send(
            JSON.stringify({
              type: "system",
              message: `Auto-subscribed to ${feed}`,
            }),
          );
        }
      }
    },
    message(ws) {},
  },
});

setInterval(() => {
  const update = {
    feed: "last-traded-price",
    timestamp: Date.now(),
    headline: "Hello",
  };
  console.log("Running update interval");

  server.publish("feed:last-traded-price", JSON.stringify(update));
}, 5000);
