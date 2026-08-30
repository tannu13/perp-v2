import env from "../env";
import type { WebSocketData } from "../types";
import { userTopic, verifyTicket } from "./verify-ticket";

export const ValidFeeds = [
  "last-traded-price",
  "mark-price",
  "depth",
  "trades",
];
export const createWSServer = () => {
  const server = Bun.serve<WebSocketData>({
    port: env.WS_SERVER_PORT,
    fetch(req, server) {
      const url = new URL(req.url);
      const feedsParam = url.searchParams.get("feeds");
      const marketId = url.searchParams.get("market_id") ?? "";
      const initialFeeds = feedsParam ? feedsParam.split(",") : [];

      /**
       * Identity, if any, is settled HERE — at the upgrade, once, from a
       * verified ticket. There is no client→server protocol on this socket
       * (`message(ws)` is still empty), so there is nothing a connection can
       * say afterwards to change who it is. That is the property that makes
       * the private topic safe: `user:{id}` is subscribed from a value this
       * process derived from a signature, never from a parameter.
       *
       * No ticket at all is fine and is the common case — every public feed
       * here is public by construction. A ticket that is present and does not
       * verify is refused outright rather than silently downgraded to
       * anonymous: a client that sent one is asking for the private channel,
       * and quietly giving it a public socket would leave it waiting forever
       * for events that are never coming.
       */
      const ticket = url.searchParams.get("ticket");
      let userId: string | null = null;
      if (ticket) {
        const result = verifyTicket(ticket);
        if (!result.ok) {
          return new Response(`Unauthorized: ticket ${result.reason}`, {
            status: 401,
          });
        }
        userId = result.userId;
      }

      const success = server.upgrade(req, {
        data: {
          id: crypto.randomUUID(),
          marketId,
          subscribedFeeds: new Set(initialFeeds),
          userId,
        },
      });

      if (success) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        for (const feed of ws.data.subscribedFeeds) {
          if (ValidFeeds.includes(feed)) {
            ws.subscribe(`feed:${ws.data.marketId}:${feed}`);
            ws.send(
              JSON.stringify({
                type: "system",
                message: `Auto-subscribed to ${feed}`,
              }),
            );
          }
        }

        /**
         * The private topic. Subscribed from `ws.data.userId`, which exists
         * only if a ticket verified — so this line cannot subscribe anyone to
         * anyone else's events however the URL was written.
         *
         * The acknowledgement is sent so the client knows the channel is live
         * rather than merely connected: its reconnect discipline is snapshot →
         * drain, and it needs a moment at which to start the snapshot.
         */
        if (ws.data.userId) {
          ws.subscribe(userTopic(ws.data.userId));
          ws.send(JSON.stringify({ type: "system", message: "Subscribed to user" }));
        }
      },
      message(ws) {},
    },
  });

  return server;
};
