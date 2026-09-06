import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { createWSServer } from "./services/createWSServer";
import { setupComms } from "./services/setup-comms";
import { createHandler } from "./services/createHandler";

const server = createWSServer();
const handler = createHandler(server);

const comms = await setupComms({
  responseHandler: handler,
});

comms.listenToIncomingEvents();

/**
 * Graceful exit, in the order a rolling deploy needs it.
 *
 * `stop(true)` closes live sockets rather than waiting on them: these are
 * WebSockets, so "wait for in-flight work to finish" means waiting for clients
 * to go home, which they will not do. Browsers reconnect to whichever replica
 * the load balancer offers next, so cutting them is the fast path, not the
 * rude one.
 *
 * Then the per-process consumer group goes back to Redis — see
 * `setup-comms.ts`. Doing it after the server stops means nothing is still
 * publishing to sockets while its feed is being torn down.
 */
let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;

  console.log(`[ws-server] ${signal} — shutting down`);
  server.stop(true);
  await comms.shutdown();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
