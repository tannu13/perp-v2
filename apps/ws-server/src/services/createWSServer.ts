export const createWSServer = () => {
  interface WebSocketData {
    id: string;
    marketId: string;
    subscribedFeeds: Set<string>;
  }

  const server = Bun.serve<WebSocketData>({
    port: 3010,
    fetch(req, server) {
      const url = new URL(req.url);
      const feedsParam = url.searchParams.get("feeds");
      const marketId = url.searchParams.get("market_id") ?? "";
      const initialFeeds = feedsParam ? feedsParam.split(",") : [];

      const success = server.upgrade(req, {
        data: {
          id: crypto.randomUUID(),
          marketId,
          subscribedFeeds: new Set(initialFeeds),
        },
      });

      if (success) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        console.log("Connected to websocket server");

        const validFeeds = [
          "last-traded-price",
          "mark-price",
          "depth",
          "trades",
        ];
        for (const feed of ws.data.subscribedFeeds) {
          if (validFeeds.includes(feed)) {
            ws.subscribe(`feed:${ws.data.marketId}:${feed}`);
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

  return server;
};
