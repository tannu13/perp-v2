import env from "./env";
import { createApp } from "./server";
import { setupComms } from "./services/backend-comms";

const comms = await setupComms();
await comms.handlePendingEntries();
comms.listenToIncomingEvents();

const app = createApp({ sendToEngine: comms.sendToEngineStream });

const server = app.listen(env.APP_PORT, () => {
  console.log(`Server started on ${env.APP_PORT}`);
  console.log(`CORS origins: ${env.CORS_ORIGINS.join(", ")}`);
});

/**
 * Graceful exit, in the order a rolling deploy needs it.
 *
 * Stop accepting connections first, then let in-flight requests finish before
 * the Redis listener goes away. Those requests are orders parked on
 * `sendToEngineStream`, waiting for a reply that arrives on the stream this
 * process is about to stop reading — tear the transport down first and a
 * filled order becomes a 503 in someone's browser.
 *
 * So the drain window clears ENGINE_TIMEOUT_MS, and is capped so that it stays
 * well inside kubernetes' 30-second default grace period: the process should
 * decide when it exits, not the SIGKILL that follows the grace period.
 */
let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;

  console.log(`[backend] ${signal} — draining`);

  await new Promise<void>((resolve) => {
    const forced = setTimeout(resolve, env.ENGINE_TIMEOUT_MS + 2_000);
    // Keep-alive sockets sitting idle hold `close` open on their own.
    server.closeIdleConnections?.();
    server.close(() => {
      clearTimeout(forced);
      resolve();
    });
  });

  await comms.shutdown();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
