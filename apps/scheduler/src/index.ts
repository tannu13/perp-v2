import { createHandler } from "./services/createHandler";
import { createScheduler } from "./services/createScheduler";
import { setupComms } from "./services/setupComms";

const comms = await setupComms();
const handler = createHandler(comms.sendToEngineStream);

await createScheduler(comms.rediClient, handler);
