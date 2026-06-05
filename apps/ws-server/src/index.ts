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
