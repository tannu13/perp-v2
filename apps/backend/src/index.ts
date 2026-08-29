import env from "./env";
import { createApp } from "./server";
import { setupComms } from "./services/backend-comms";

const comms = await setupComms();
await comms.handlePendingEntries();
comms.listenToIncomingEvents();

const app = createApp({ sendToEngine: comms.sendToEngineStream });

app.listen(env.APP_PORT, () => {
  console.log(`Server started on ${env.APP_PORT}`);
  console.log(`CORS origins: ${env.CORS_ORIGINS.join(", ")}`);
});
